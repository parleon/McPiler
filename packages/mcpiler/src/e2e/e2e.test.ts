import { execSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runMcpAdapter } from '../adapters/mcp.js';
import { emit } from '../emitter/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgDir = path.resolve(__dirname, '../..');
const runtimeDir = path.resolve(pkgDir, '../runtime-mcp');
const scratchRoot = path.join(pkgDir, '.e2e-artifacts');
const fakeServerPath = path.join(pkgDir, 'dist/e2e/fake-server.js');

function runCommand(command: string, cwd: string): string {
  try {
    return execSync(command, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? String(error.stdout ?? '') : '';
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr ?? '') : '';
    throw new Error([`Command failed: ${command}`, stdout.trim(), stderr.trim()].filter(Boolean).join('\n\n'));
  }
}

async function makeOutDir(name: string): Promise<string> {
  await mkdir(scratchRoot, { recursive: true });
  const outDir = path.join(scratchRoot, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(outDir, { recursive: true });
  return outDir;
}

async function loadIr() {
  return runMcpAdapter({
    command: 'node',
    args: [fakeServerPath],
  });
}

async function emitPackage(outDir: string) {
  const { ir, warnings } = await loadIr();
  await emit(ir, {
    packageName: 'fake-client',
    adapter: 'mcp',
    loose: false,
    outDir,
    config: { command: 'node', args: [fakeServerPath] },
    warnings,
  });

  return { ir, warnings };
}

function installGeneratedPackage(outDir: string): void {
  try {
    runCommand('npm install --no-audit --no-fund', outDir);
  } catch {
    // The generated package depends on a local workspace package; linking it below is the important step.
  }

  runCommand(`npm link ${runtimeDir}`, outDir);
}

beforeAll(() => {
  runCommand('npm run build', runtimeDir);
  runCommand('npm run build', pkgDir);
}, 30_000);

afterAll(async () => {
  await rm(scratchRoot, { recursive: true, force: true });
});

describe('McPiler E2E', () => {
  it('e2e-01: adapter returns 4 operations with correct names and types', async () => {
    const { ir, warnings } = await loadIr();

    expect(ir.operations).toHaveLength(4);

    const names = ir.operations.map((operation) => operation.name);
    expect(names).toContain('echo');
    expect(names).toContain('get-weather');
    expect(names).toContain('add');
    expect(names).toContain('do-something-complex');

    const weather = ir.operations.find((operation) => operation.name === 'get-weather');
    expect(weather?.outputSchema).toBeDefined();
    expect(weather?.outputSchema?.properties?.temperature).toBeDefined();

    const echo = ir.operations.find((operation) => operation.name === 'echo');
    expect(echo?.outputSchema).toBeUndefined();

    expect(warnings).toHaveLength(0);
  }, 15_000);

  it('e2e-02: emit generates all 5 package files', async () => {
    const outDir = await makeOutDir('emit');

    try {
      await emitPackage(outDir);

      for (const file of ['src/client.ts', 'src/types.ts', 'package.json', 'tsconfig.json', 'README.md']) {
        const content = await readFile(path.join(outDir, file), 'utf8');
        expect(content.length).toBeGreaterThan(0);
      }

      const client = await readFile(path.join(outDir, 'src/client.ts'), 'utf8');
      expect(client).toContain('export class FakeClient');
      expect(client).toContain('async echo(');
      expect(client).toContain('async getWeather(');
      expect(client).toContain('async add(');
      expect(client).toContain('async doSomethingComplex(');
      expect(client).toContain('result.structured as GetWeatherOutput');
      expect(client).toContain('result.content as Array<');

      const types = await readFile(path.join(outDir, 'src/types.ts'), 'utf8');
      expect(types).toContain('interface EchoInput');
      expect(types).toContain('interface GetWeatherInput');
      expect(types).toContain('interface GetWeatherOutput');
      expect(types).toContain('interface DoSomethingComplexInput');
      expect(types).toContain('temperature: number');
      expect(types).toContain('conditions: string');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('e2e-03: generated package passes tsc --noEmit', async () => {
    const outDir = await makeOutDir('typecheck');

    try {
      await emitPackage(outDir);
      installGeneratedPackage(outDir);
      runCommand('npx tsc --noEmit', outDir);
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 60_000);

  it('e2e-04: generated client compiles and methods return correct values', async () => {
    const outDir = await makeOutDir('runtime');

    try {
      await emitPackage(outDir);
      installGeneratedPackage(outDir);
      runCommand('npm run build', outDir);

      const scriptPath = path.join(outDir, 'test-runner.mjs');
      const clientModuleUrl = pathToFileURL(path.join(outDir, 'dist/client.js')).href;
      const testScript = `
const { FakeClient } = await import(${JSON.stringify(clientModuleUrl)});
const client = new FakeClient();
try {
  const echoResult = await client.echo({ message: 'hello' });
  if (!Array.isArray(echoResult)) throw new Error('echo should return array');
  if (echoResult[0]?.type !== 'text' || echoResult[0]?.text !== 'hello') {
    throw new Error('echo should return the echoed message');
  }

  const weather = await client.getWeather({ city: 'NYC' });
  if (weather.temperature !== 22) throw new Error('temperature should be 22, got ' + weather.temperature);
  if (weather.conditions !== 'sunny') throw new Error('conditions should be sunny');

  const sum = await client.add({ a: 3, b: 4 });
  if (!Array.isArray(sum)) throw new Error('add should return array');
  if (sum[0]?.type !== 'text' || sum[0]?.text !== '7') {
    throw new Error('add should return the sum');
  }

  const complex = await client.doSomethingComplex({});
  if (!Array.isArray(complex)) throw new Error('doSomethingComplex should return array');
  if (complex[0]?.type !== 'text' || complex[0]?.text !== 'done') {
    throw new Error('doSomethingComplex should return done');
  }

  console.log('ALL_CHECKS_PASSED');
} finally {
  await client[Symbol.asyncDispose]();
}
`;

      await writeFile(scriptPath, testScript, 'utf8');
      const output = runCommand(`node ${JSON.stringify(scriptPath)}`, outDir);
      expect(output.trim()).toContain('ALL_CHECKS_PASSED');
    } finally {
      await rm(outDir, { recursive: true, force: true });
    }
  }, 60_000);
});
