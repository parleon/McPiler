import { readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { IR } from '../ir.js';
import { emit } from './index.js';

const createdDirs: string[] = [];

async function makeOutDir(name: string): Promise<string> {
  const outDir = path.join(os.tmpdir(), `mcpiler-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  createdDirs.push(outDir);
  return outDir;
}

async function readGeneratedFile(outDir: string, filePath: string): Promise<string> {
  return readFile(path.join(outDir, filePath), 'utf8');
}

const weatherIr: IR = {
  operations: [
    {
      name: 'get_weather',
      description: 'Get current weather information for a location.',
      inputSchema: {
        type: 'object',
        properties: {
          location: { type: 'string' },
        },
        required: ['location'],
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
      name: 'run_query',
      description: 'Run a database query.',
      inputSchema: {
        type: 'object',
        properties: {
          sql: { type: 'string' },
        },
        required: ['sql'],
      },
    },
  ],
};

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('emit', () => {
  it('e-01: generates class with correct PascalCase name', async () => {
    const outDir = await makeOutDir('class-name');

    await emit(weatherIr, {
      packageName: 'weather-client',
      adapter: 'mcp',
      loose: false,
      outDir,
      config: { command: 'weather-server' },
    });

    const client = await readGeneratedFile(outDir, 'src/client.ts');
    expect(client).toContain('export class WeatherClient {');
  });

  it('e-02: generates one method per operation', async () => {
    const outDir = await makeOutDir('methods');

    await emit(weatherIr, {
      packageName: 'weather-client',
      adapter: 'mcp',
      loose: false,
      outDir,
      config: { command: 'weather-server' },
    });

    const client = await readGeneratedFile(outDir, 'src/client.ts');
    expect(client).toContain('async getWeather(input: GetWeatherInput): Promise<GetWeatherOutput>');
    expect(client).toContain(
      'async runQuery(input: RunQueryInput): Promise<Array<TextContent | ImageContent | AudioContent | unknown>>',
    );
  });

  it('e-04: input type generated from inputSchema', async () => {
    const outDir = await makeOutDir('input-type');

    await emit(weatherIr, {
      packageName: 'weather-client',
      adapter: 'mcp',
      loose: false,
      outDir,
      config: { command: 'weather-server' },
    });

    const types = await readGeneratedFile(outDir, 'src/types.ts');
    expect(types).toContain('export interface GetWeatherInput {');
    expect(types).toContain('location: string;');
  });

  it('e-05: output type from outputSchema (strict)', async () => {
    const outDir = await makeOutDir('strict-output');

    await emit(weatherIr, {
      packageName: 'weather-client',
      adapter: 'mcp',
      loose: false,
      outDir,
      config: { command: 'weather-server' },
    });

    const client = await readGeneratedFile(outDir, 'src/client.ts');
    const types = await readGeneratedFile(outDir, 'src/types.ts');

    expect(client).toContain('async getWeather(input: GetWeatherInput): Promise<GetWeatherOutput>');
    expect(client).toContain('return result.structured as GetWeatherOutput;');
    expect(types).toContain('export interface GetWeatherOutput {');
  });

  it('e-06: content union return type when no outputSchema (strict)', async () => {
    const outDir = await makeOutDir('strict-untyped');

    await emit(weatherIr, {
      packageName: 'weather-client',
      adapter: 'mcp',
      loose: false,
      outDir,
      config: { command: 'weather-server' },
    });

    const client = await readGeneratedFile(outDir, 'src/client.ts');
    expect(client).toContain('import type { TextContent, ImageContent, AudioContent } from \x27@mcpiler/runtime-mcp\x27;');
    expect(client).toContain('return result.content as Array<TextContent | ImageContent | AudioContent | unknown>;');
  });

  it('e-07: string return type when no outputSchema (loose) with @remarks JSDoc', async () => {
    const outDir = await makeOutDir('loose');

    await emit(weatherIr, {
      packageName: 'weather-client',
      adapter: 'mcp',
      loose: true,
      outDir,
      config: { command: 'weather-server' },
    });

    const client = await readGeneratedFile(outDir, 'src/client.ts');
    expect(client).toContain('async runQuery(input: RunQueryInput): Promise<string>');
    expect(client).toContain('@remarks No outputSchema declared — output coerced to string. Type accuracy not guaranteed.');
    expect(client).toContain('const first = result.content[0];');
  });

  it('e-08: JSDoc description on method', async () => {
    const outDir = await makeOutDir('jsdoc');

    await emit(weatherIr, {
      packageName: 'weather-client',
      adapter: 'mcp',
      loose: false,
      outDir,
      config: { command: 'weather-server' },
    });

    const client = await readGeneratedFile(outDir, 'src/client.ts');
    expect(client).toContain('/**\n   * Get current weather information for a location.\n   */\n  async getWeather');
  });

  it('e-09: generated package.json has correct name and runtime dep', async () => {
    const outDir = await makeOutDir('package-json');

    await emit(weatherIr, {
      packageName: '@scope/weather-client',
      adapter: 'mcp',
      loose: false,
      outDir,
      config: { command: 'weather-server' },
    });

    const packageJson = JSON.parse(await readGeneratedFile(outDir, 'package.json')) as {
      name: string;
      dependencies: Record<string, string>;
    };

    expect(packageJson.name).toBe('@scope/weather-client');
    expect(packageJson.dependencies['@mcpiler/runtime-mcp']).toBe('*');
  });

  it('e-10: generated tsconfig.json has ESNext.Disposable in lib', async () => {
    const outDir = await makeOutDir('tsconfig');

    await emit(weatherIr, {
      packageName: 'weather-client',
      adapter: 'mcp',
      loose: false,
      outDir,
      config: { command: 'weather-server' },
    });

    const tsconfig = JSON.parse(await readGeneratedFile(outDir, 'tsconfig.json')) as {
      compilerOptions: { lib: string[] };
    };

    expect(tsconfig.compilerOptions.lib).toContain('ESNext.Disposable');
  });

  it('e-12: zero operations → valid empty client class', async () => {
    const outDir = await makeOutDir('empty');

    await emit(
      { operations: [] },
      {
        packageName: 'weather-client',
        adapter: 'mcp',
        loose: false,
        outDir,
        config: { command: 'weather-server' },
      },
    );

    const client = await readGeneratedFile(outDir, 'src/client.ts');
    const types = await readGeneratedFile(outDir, 'src/types.ts');

    expect(client).toContain('export class WeatherClient {');
    expect(client).not.toContain('async getWeather(');
    expect(types).toBe('// AUTO-GENERATED by McPiler — do not edit manually\n');
  });

  it('e-19: operation with no description → no JSDoc block', async () => {
    const outDir = await makeOutDir('no-description');

    await emit(
      {
        operations: [
          {
            name: 'ping',
            inputSchema: { type: 'object' },
            outputSchema: { type: 'string' },
          },
        ],
      },
      {
        packageName: 'weather-client',
        adapter: 'mcp',
        loose: false,
        outDir,
        config: { command: 'weather-server' },
      },
    );

    const client = await readGeneratedFile(outDir, 'src/client.ts');
    expect(client).toContain('async ping(input: PingInput): Promise<PingOutput>');
    expect(client).not.toContain('/**\n   *\n   */\n  async ping');
    expect(client).not.toContain('/**\n  async ping');
  });
});
