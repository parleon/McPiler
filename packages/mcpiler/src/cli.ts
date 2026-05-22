#!/usr/bin/env node

import { Command } from 'commander';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { runMcpAdapter, type McpAdapterConfig } from './adapters/mcp.js';
import { emit } from './emitter/index.js';
import type { IR } from './ir.js';

interface CliOptions {
  name: string;
  out: string;
  config: string;
  adapter: string;
  loose: boolean;
}

async function loadConfig(configArg: string): Promise<unknown> {
  const trimmed = configArg.trim();
  if (trimmed.startsWith('{')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error(`Invalid JSON in --config: ${trimmed.slice(0, 80)}...`);
    }
  }

  const resolved = path.resolve(configArg);
  let content: string;
  try {
    content = await readFile(resolved, 'utf8');
  } catch {
    throw new Error(`Could not read config file: ${resolved}`);
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`Config file is not valid JSON: ${resolved}`);
  }
}

async function runAdapter(adapter: string, config: unknown): Promise<{ ir: IR; warnings: string[] }> {
  switch (adapter) {
    case 'mcp':
      return runMcpAdapter(config as McpAdapterConfig);
    default:
      throw new Error(`Unknown adapter: "${adapter}". Supported: mcp`);
  }
}

async function run(options: CliOptions): Promise<void> {
  const config = await loadConfig(options.config);

  console.log(`⚙️  Introspecting ${options.adapter} server...`);
  const { ir, warnings } = await runAdapter(options.adapter, config);

  const opCount = ir.operations.length;
  console.log(`   Found ${opCount} operation${opCount === 1 ? '' : 's'}`);

  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(`⚠️  ${warning}`);
    }
  }

  const outDir = path.resolve(options.out);
  console.log(`📦 Generating package "${options.name}" → ${outDir}`);

  await emit(ir, {
    packageName: options.name,
    adapter: options.adapter,
    loose: options.loose,
    outDir,
    config,
    warnings,
  });

  console.log('✅ Done! Install with:');
  console.log(`   cd ${outDir} && npm install`);
  console.log('   npm link');
  console.log('   # then in your project:');
  console.log(`   npm link ${options.name}`);
}

const program = new Command();

program
  .name('McPile')
  .description('Generate a typed npm package from an API source')
  .requiredOption('--name <name>', 'npm package name for the generated package')
  .requiredOption('--out <dir>', 'output directory')
  .requiredOption('--config <config>', 'adapter config as JSON string or path to JSON file')
  .option('--adapter <adapter>', 'source adapter', 'mcp')
  .option('--loose', 'coerce untyped outputs to string (less accurate types)', false)
  .action(run);

program.parseAsync().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`\n❌ Error: ${message}`);
  process.exit(1);
});
