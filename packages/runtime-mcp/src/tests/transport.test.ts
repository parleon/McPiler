import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  callTool: vi.fn(),
  close: vi.fn<() => Promise<void>>(),
  Client: vi.fn(),
  StdioClientTransport: vi.fn(),
  StreamableHTTPClientTransport: vi.fn(),
}));

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: sdkMocks.Client,
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: sdkMocks.StdioClientTransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: sdkMocks.StreamableHTTPClientTransport,
}));

import { AdapterError, McpTransport, OperationError } from '../index.js';

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((innerResolve, innerReject) => {
    resolve = innerResolve;
    reject = innerReject;
  });
  return { promise, resolve, reject };
};

describe('McpTransport', () => {
  beforeEach(() => {
    sdkMocks.connect.mockReset().mockResolvedValue(undefined);
    sdkMocks.callTool.mockReset();
    sdkMocks.close.mockReset().mockResolvedValue(undefined);
    sdkMocks.Client.mockReset().mockImplementation(() => ({
      connect: sdkMocks.connect,
      callTool: sdkMocks.callTool,
      close: sdkMocks.close,
    }));
    sdkMocks.StdioClientTransport.mockReset().mockImplementation(() => ({}));
    sdkMocks.StreamableHTTPClientTransport.mockReset().mockImplementation(() => ({}));
  });

  it('r-01: call() invokes correct tool and returns deserialized result', async () => {
    sdkMocks.callTool.mockResolvedValue({
      structuredContent: { value: 42 },
      content: [{ type: 'text', text: 'ok' }],
    });

    const transport = new McpTransport({ command: 'node', args: ['server.js'] });
    await transport.connect();

    await expect(transport.call('sum', { a: 20, b: 22 })).resolves.toEqual({
      structured: { value: 42 },
      content: [{ type: 'text', text: 'ok' }],
    });
    expect(sdkMocks.callTool).toHaveBeenCalledWith({
      name: 'sum',
      arguments: { a: 20, b: 22 },
    });
  });

  it('r-02: concurrent calls on same connection all resolve correctly', async () => {
    const first = deferred<{ structuredContent: undefined; content: Array<{ type: 'text'; text: string }> }>();
    const second = deferred<{ structuredContent: undefined; content: Array<{ type: 'text'; text: string }> }>();
    const third = deferred<{ structuredContent: undefined; content: Array<{ type: 'text'; text: string }> }>();

    sdkMocks.callTool
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise);

    const transport = new McpTransport({ command: 'node', args: ['server.js'] });
    await transport.connect();

    const calls = [
      transport.call('one', { index: 1 }),
      transport.call('two', { index: 2 }),
      transport.call('three', { index: 3 }),
    ];

    first.resolve({ structuredContent: undefined, content: [{ type: 'text', text: 'first' }] });
    second.resolve({ structuredContent: undefined, content: [{ type: 'text', text: 'second' }] });
    third.resolve({ structuredContent: undefined, content: [{ type: 'text', text: 'third' }] });

    await expect(Promise.all(calls)).resolves.toEqual([
      { structured: undefined, content: [{ type: 'text', text: 'first' }] },
      { structured: undefined, content: [{ type: 'text', text: 'second' }] },
      { structured: undefined, content: [{ type: 'text', text: 'third' }] },
    ]);
  });

  it('r-03: disconnect() tears down cleanly', async () => {
    const transport = new McpTransport({ command: 'node', args: ['server.js'] });
    await transport.connect();

    await expect(transport.disconnect()).resolves.toBeUndefined();
    await expect(transport.disconnect()).resolves.toBeUndefined();
    await expect(transport.call('sum', {})).rejects.toThrow(AdapterError);
    expect(sdkMocks.close).toHaveBeenCalledTimes(1);
  });

  it('r-04: call() with isError:true throws OperationError', async () => {
    sdkMocks.callTool.mockResolvedValue({
      isError: true,
      content: [{ type: 'text', text: 'tool failed' }],
    });

    const transport = new McpTransport({ command: 'node' });
    await transport.connect();

    await expect(transport.call('broken', {})).rejects.toThrowError(new OperationError('tool failed'));
  });

  it('r-05: JSON-RPC error response throws AdapterError', async () => {
    sdkMocks.callTool.mockRejectedValue(new Error('JSON-RPC error -32603'));

    const transport = new McpTransport({ command: 'node' });
    await transport.connect();

    await expect(transport.call('broken', {})).rejects.toThrowError(
      new AdapterError('Protocol error calling "broken": JSON-RPC error -32603'),
    );
  });

  it('r-06: server crashes mid-call: throws AdapterError', async () => {
    sdkMocks.callTool.mockRejectedValue(new Error('Connection closed'));

    const transport = new McpTransport({ command: 'node' });
    await transport.connect();

    await expect(transport.call('broken', {})).rejects.toThrowError(
      new AdapterError('Protocol error calling "broken": Connection closed'),
    );
  });

  it('r-07: kill() after disconnect() is a no-op', async () => {
    const transport = new McpTransport({ command: 'node' });
    await transport.connect();
    await transport.disconnect();

    expect(() => transport.kill()).not.toThrow();
    expect(sdkMocks.close).toHaveBeenCalledTimes(1);
  });
});
