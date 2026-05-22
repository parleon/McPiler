import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { IR, JSONSchema } from '../ir.js';

export interface McpAdapterConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

function isAbsoluteCommand(command: string): boolean {
  return command.startsWith('/') || /^[A-Za-z]:[\\/]/.test(command);
}

function isRelativeCommand(command: string): boolean {
  return command.startsWith('.');
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createUrl(url: string): URL {
  return new (globalThis as typeof globalThis & { URL: new (value: string) => URL }).URL(url);
}

export async function runMcpAdapter(config: McpAdapterConfig): Promise<{ ir: IR; warnings: string[] }> {
  if (!config.command && !config.url) {
    throw new Error('Invalid MCP adapter config: expected either command or url');
  }

  const warnings: string[] = [];

  if (config.command) {
    if (isAbsoluteCommand(config.command)) {
      warnings.push('command is an absolute path and may not be portable');
    } else if (isRelativeCommand(config.command)) {
      warnings.push('command is a relative path and may not work on other machines');
    }
  }

  const client = new Client({ name: 'mcpiler', version: '0.1.0' });
  let pendingError: unknown;

  try {
    const transport = config.url
      ? new StreamableHTTPClientTransport(createUrl(config.url))
      : new StdioClientTransport({
          command: config.command!,
          args: config.args,
          env: config.env,
        });

    try {
      await client.connect(transport);
    } catch (error) {
      throw new Error(`Failed to connect to MCP server: ${getErrorMessage(error)}`);
    }

    const capabilities = client.getServerCapabilities();
    if (capabilities?.tools?.listChanged === true) {
      warnings.push(
        'Server declares tools may change at runtime. Generated types may become stale — consider regenerating periodically.',
      );
    }

    const tools = [] as Awaited<ReturnType<typeof client.listTools>>['tools'];
    let cursor: string | undefined;

    try {
      do {
        const page = await client.listTools(cursor ? { cursor } : {});
        tools.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);
    } catch (error) {
      throw new Error(`Failed to list tools: ${getErrorMessage(error)}`);
    }

    const ir: IR = {
      operations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema as JSONSchema,
        outputSchema: tool.outputSchema as JSONSchema | undefined,
      })),
    };

    return { ir, warnings };
  } catch (error) {
    pendingError = error;
    throw error;
  } finally {
    try {
      await client.close();
    } catch (closeError) {
      if (pendingError === undefined) {
        throw closeError;
      }
    }
  }
}
