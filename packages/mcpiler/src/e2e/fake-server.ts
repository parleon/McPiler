#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const tools = [
  {
    name: 'echo',
    description: 'Echoes the message back',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
      required: ['message'],
    },
  },
  {
    name: 'get-weather',
    description: 'Returns weather for a city',
    inputSchema: {
      type: 'object',
      properties: {
        city: { type: 'string' },
      },
      required: ['city'],
    },
    outputSchema: {
      type: 'object',
      properties: {
        temperature: { type: 'number' },
        conditions: { type: 'string' },
      },
      required: ['temperature', 'conditions'],
    },
  },
  {
    name: 'add',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number' },
        b: { type: 'number' },
      },
      required: ['a', 'b'],
    },
  },
  {
    name: 'do-something-complex',
    description: 'Does something complex',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'string' },
      },
      required: [],
    },
  },
] as const;

const server = new Server({ name: 'fake-server', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const input = (args ?? {}) as Record<string, unknown>;

  switch (name) {
    case 'echo':
      return { content: [{ type: 'text', text: String(input.message) }] };
    case 'get-weather':
      return {
        content: [{ type: 'text', text: 'weather data' }],
        structuredContent: { temperature: 22, conditions: 'sunny' },
      };
    case 'add': {
      const { a, b } = input as { a: number; b: number };
      return { content: [{ type: 'text', text: String(a + b) }] };
    }
    case 'do-something-complex':
      return { content: [{ type: 'text', text: 'done' }] };
    default:
      return { content: [{ type: 'text', text: 'unknown' }], isError: true };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
