import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpAdapterConfig } from './mcp.js';
import { runMcpAdapter } from './mcp.js';

interface MockTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}

interface MockPage {
  tools: MockTool[];
  nextCursor?: string;
}

const state = vi.hoisted(() => {
  const connect = vi.fn();
  const listTools = vi.fn();
  const getServerCapabilities = vi.fn();
  const close = vi.fn();
  const clientConstructorArgs: Array<Record<string, string>> = [];
  const stdioTransportArgs: Array<Record<string, unknown>> = [];
  const httpTransportArgs: URL[] = [];

  return {
    connect,
    listTools,
    getServerCapabilities,
    close,
    clientConstructorArgs,
    stdioTransportArgs,
    httpTransportArgs,
  };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation((config: Record<string, string>) => {
    state.clientConstructorArgs.push(config);

    return {
      connect: state.connect,
      listTools: state.listTools,
      getServerCapabilities: state.getServerCapabilities,
      close: state.close,
    };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation((config: Record<string, unknown>) => {
    state.stdioTransportArgs.push(config);
    return { kind: 'stdio', config };
  }),
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: vi.fn().mockImplementation((url: URL) => {
    state.httpTransportArgs.push(url);
    return { kind: 'http', url };
  }),
}));

function makeConfig(config: Partial<McpAdapterConfig>): McpAdapterConfig {
  return config;
}

function setPages(...pages: MockPage[]): void {
  state.listTools.mockImplementation(async (request?: { cursor?: string }) => {
    if (!request?.cursor) {
      return pages[0] ?? { tools: [] };
    }

    const page = pages.find((candidate) => candidate.nextCursor === request.cursor);
    if (page) {
      return page;
    }

    const currentIndex = pages.findIndex((candidate, index) => index > 0 && pages[index - 1]?.nextCursor === request.cursor);
    if (currentIndex >= 0) {
      return pages[currentIndex];
    }

    throw new Error(`Unexpected cursor: ${request.cursor}`);
  });
}

describe('runMcpAdapter', () => {
  beforeEach(() => {
    state.connect.mockResolvedValue(undefined);
    state.listTools.mockResolvedValue({ tools: [] });
    state.getServerCapabilities.mockReturnValue(undefined);
    state.close.mockResolvedValue(undefined);
    state.clientConstructorArgs.length = 0;
    state.stdioTransportArgs.length = 0;
    state.httpTransportArgs.length = 0;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('a-01: stdio config connects and returns correct IR', async () => {
    const tool = {
      name: 'sum',
      description: 'Add numbers',
      inputSchema: { type: 'object', properties: { a: { type: 'number' } } },
    };
    state.listTools.mockResolvedValue({ tools: [tool] });

    const result = await runMcpAdapter(makeConfig({ command: 'mcp-server', args: ['--flag'], env: { A: '1' } }));

    expect(result).toEqual({
      ir: {
        operations: [
          {
            name: 'sum',
            description: 'Add numbers',
            inputSchema: tool.inputSchema,
            outputSchema: undefined,
          },
        ],
      },
      warnings: [],
    });
    expect(state.stdioTransportArgs).toEqual([
      { command: 'mcp-server', args: ['--flag'], env: { A: '1' } },
    ]);
    expect(state.httpTransportArgs).toEqual([]);
    expect(state.connect).toHaveBeenCalledTimes(1);
    expect(state.clientConstructorArgs).toEqual([{ name: 'mcpiler', version: '0.1.0' }]);
  });

  it('a-02: HTTP config connects and returns correct IR', async () => {
    const tool = {
      name: 'echo',
      inputSchema: { type: 'object' },
    };
    state.listTools.mockResolvedValue({ tools: [tool] });

    const result = await runMcpAdapter(makeConfig({ url: 'https://example.com/mcp' }));

    expect(result.ir.operations).toEqual([
      {
        name: 'echo',
        description: undefined,
        inputSchema: { type: 'object' },
        outputSchema: undefined,
      },
    ]);
    expect(state.httpTransportArgs).toHaveLength(1);
    expect(state.httpTransportArgs[0]?.toString()).toBe('https://example.com/mcp');
    expect(state.stdioTransportArgs).toEqual([]);
  });

  it('a-03: multi-page tools/list paginates all pages', async () => {
    state.listTools.mockImplementation(async (request?: { cursor?: string }) => {
      if (!request?.cursor) {
        return {
          tools: [{ name: 'first', inputSchema: { type: 'object' } }],
          nextCursor: 'page-2',
        } satisfies MockPage;
      }

      if (request.cursor === 'page-2') {
        return {
          tools: [{ name: 'second', inputSchema: { type: 'object' } }],
        } satisfies MockPage;
      }

      throw new Error(`Unexpected cursor: ${request.cursor}`);
    });

    const result = await runMcpAdapter(makeConfig({ command: 'mcp-server' }));

    expect(result.ir.operations.map((operation) => operation.name)).toEqual(['first', 'second']);
    expect(state.listTools).toHaveBeenNthCalledWith(1, {});
    expect(state.listTools).toHaveBeenNthCalledWith(2, { cursor: 'page-2' });
  });

  it('a-04: tool with outputSchema maps correctly', async () => {
    state.listTools.mockResolvedValue({
      tools: [
        {
          name: 'report',
          inputSchema: { type: 'object' },
          outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
        },
      ],
    });

    const result = await runMcpAdapter(makeConfig({ command: 'mcp-server' }));

    expect(result.ir.operations[0]?.outputSchema).toEqual({
      type: 'object',
      properties: { ok: { type: 'boolean' } },
    });
  });

  it('a-05: tool without outputSchema has undefined outputSchema in IR', async () => {
    state.listTools.mockResolvedValue({
      tools: [{ name: 'ping', inputSchema: { type: 'object' } }],
    });

    const result = await runMcpAdapter(makeConfig({ command: 'mcp-server' }));

    expect(result.ir.operations[0]).toHaveProperty('outputSchema', undefined);
  });

  it('a-06: empty tools list returns empty IR with no warnings', async () => {
    state.listTools.mockResolvedValue({ tools: [] });

    const result = await runMcpAdapter(makeConfig({ command: 'mcp-server' }));

    expect(result).toEqual({ ir: { operations: [] }, warnings: [] });
  });

  it('a-07: listChanged:true adds warning to result', async () => {
    state.getServerCapabilities.mockReturnValue({ tools: { listChanged: true } });

    const result = await runMcpAdapter(makeConfig({ command: 'mcp-server' }));

    expect(result.warnings).toContain(
      'Server declares tools may change at runtime. Generated types may become stale — consider regenerating periodically.',
    );
  });

  it('a-08: connection failure throws descriptive error', async () => {
    state.connect.mockRejectedValue(new Error('socket refused'));

    await expect(runMcpAdapter(makeConfig({ command: 'mcp-server' }))).rejects.toThrow(
      'Failed to connect to MCP server: socket refused',
    );
  });

  it('adds a portability warning for an absolute path command', async () => {
    const result = await runMcpAdapter(makeConfig({ command: '/usr/local/bin/server' }));

    expect(result.warnings).toContain('command is an absolute path and may not be portable');
  });

  it('adds a portability warning for a relative path command', async () => {
    const result = await runMcpAdapter(makeConfig({ command: './server.js' }));

    expect(result.warnings).toContain('command is a relative path and may not work on other machines');
  });

  it('always closes the client even when listing tools fails', async () => {
    state.listTools.mockRejectedValue(new Error('boom'));

    await expect(runMcpAdapter(makeConfig({ command: 'mcp-server' }))).rejects.toThrow(
      'Failed to list tools: boom',
    );
    expect(state.close).toHaveBeenCalledTimes(1);
  });

  it('throws a clear error when config is invalid', async () => {
    await expect(runMcpAdapter(makeConfig({}))).rejects.toThrow(
      'Invalid MCP adapter config: expected either command or url',
    );
  });
});
