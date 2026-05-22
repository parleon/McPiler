import { URL } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { AdapterError, OperationError } from './errors.js';
import type { CallResult, ContentItem, StdioConfig, HttpConfig, TransportConfig } from './types.js';

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disposed';

type SdkTransport = StdioClientTransport | StreamableHTTPClientTransport;

const isStdioConfig = (config: TransportConfig): config is StdioConfig => 'command' in config;

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const isTextContent = (content: unknown): content is Extract<ContentItem, { type: 'text' }> =>
  typeof content === 'object' &&
  content !== null &&
  'type' in content &&
  content.type === 'text' &&
  'text' in content &&
  typeof content.text === 'string';

const getOperationErrorMessage = (content: unknown[]): string => {
  const message = content.filter(isTextContent).map((item) => item.text).join('\n').trim();
  return message || 'MCP operation failed';
};

export class McpTransport {
  #state: ConnectionState = 'disconnected';
  #client: Client | undefined;
  #sdkTransport: SdkTransport | undefined;
  #connectPromise: Promise<void> | undefined;

  constructor(private readonly config: TransportConfig) {}

  connect(): Promise<void> {
    if (this.#state === 'disposed') {
      throw new AdapterError('Transport has been disposed');
    }

    if ((this.#state === 'connecting' || this.#state === 'connected') && this.#connectPromise) {
      return this.#connectPromise;
    }

    this.#state = 'connecting';
    this.#connectPromise = (async () => {
      const sdkTransport = isStdioConfig(this.config)
        ? new StdioClientTransport({
            command: this.config.command,
            args: this.config.args,
            env: this.config.env,
          })
        : new StreamableHTTPClientTransport(new URL(this.config.url));
      const client = new Client({ name: 'mcpiler', version: '0.1.0' });

      this.#sdkTransport = sdkTransport;
      this.#client = client;

      try {
        await client.connect(sdkTransport);

        if (this.#state === 'disposed') {
          client.close().catch(() => {});
          return;
        }

        this.#state = 'connected';
      } catch (error) {
        this.#client = undefined;
        this.#sdkTransport = undefined;
        this.#connectPromise = undefined;

        if (this.#state !== 'disposed') {
          this.#state = 'disconnected';
        }

        throw new AdapterError(`Failed to connect: ${getErrorMessage(error)}`);
      }
    })();

    return this.#connectPromise;
  }

  async disconnect(): Promise<void> {
    if (this.#state === 'disposed') {
      return;
    }

    this.#state = 'disposed';

    const client = this.#client;

    this.#client = undefined;
    this.#sdkTransport = undefined;
    this.#connectPromise = undefined;

    try {
      await client?.close();
    } catch {
      // Swallow disconnect errors during teardown.
    }
  }

  async call(tool: string, input: unknown): Promise<CallResult> {
    if (this.#state === 'disposed') {
      throw new AdapterError('Transport has been disposed');
    }

    if (this.#state !== 'connected' || !this.#client) {
      throw new AdapterError('Transport is not connected; ensure connect() has resolved');
    }

    try {
      const result = await this.#client.callTool({
        name: tool,
        arguments: input as Record<string, unknown>,
      });

      if (result.isError === true) {
        throw new OperationError(getOperationErrorMessage(result.content as unknown[]));
      }

      return {
        structured: result.structuredContent,
        content: result.content as Array<ContentItem | unknown>,
      };
    } catch (error) {
      if (error instanceof OperationError) {
        throw error;
      }

      throw new AdapterError(`Protocol error calling "${tool}": ${getErrorMessage(error)}`);
    }
  }

  kill(): void {
    if (this.#state === 'disposed') {
      return;
    }

    this.#state = 'disposed';
    this.#connectPromise = undefined;

    this.#client?.close().catch(() => {});

    this.#client = undefined;
    this.#sdkTransport = undefined;
  }
}
