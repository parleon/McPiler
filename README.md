# McPiler

Translate MCP servers into typed npm packages that can be invoked programmatically.

Point McPiler at an MCP server and it emits a fully typed SDK — each tool becomes a plain async method with TypeScript types derived from the server's own schemas. The consumer never knows they're talking to MCP.

```ts
// Before McPiler: raw MCP protocol, subprocess management, untyped arrays
// After McPiler:
await using client = new WeatherClient();
const result = await client.getWeather({ city: 'Chicago' });
// result: { temperature: number; conditions: string }  ← generated from outputSchema
```

---

## Quick Start

### 1. Install

```bash
# From the repo root
npm install
npm run build

# Make the CLI available globally
cd packages/mcpiler && npm link
```

### 2. Generate a typed package

```bash
McPile \
  --adapter mcp \
  --config '{"command":"npx","args":["-y","@your/mcp-server"]}' \
  --name your-client \
  --out ./generated/your-client
```

Or with a config file:

```bash
# server.json
{ "command": "npx", "args": ["-y", "@your/mcp-server"] }

McPile --adapter mcp --config ./server.json --name your-client --out ./generated/your-client
```

### 3. Link and use

```bash
# In the generated package
cd ./generated/your-client
npm install
npm link @mcpiler/runtime-mcp   # link the local runtime
npm link                        # register your-client globally

# In your project
npm link your-client
```

```ts
import { YourClient } from 'your-client';

await using client = new YourClient();
const result = await client.someMethod({ input: 'value' });
```

> **`await using`** requires TypeScript 5.2+ and `"lib": ["ESNext.Disposable"]` in your tsconfig. If your environment doesn't support it yet, call `await client[Symbol.asyncDispose]()` explicitly in a `finally` block.

---

## CLI Reference

```
McPile --adapter <adapter> --config <source-config> --name <package-name> --out <output-dir> [--loose]
```

| Flag | Required | Description |
|------|----------|-------------|
| `--name` | ✓ | npm package name for the generated package |
| `--out` | ✓ | Output directory |
| `--config` | ✓ | Inline JSON string or path to a JSON file — adapter config |
| `--adapter` | | Source adapter. Default: `mcp` |
| `--loose` | | Coerce untyped outputs to `string`. Default (strict) uses an accurate content union type |

### MCP adapter config shape

| Field | Description |
|-------|-------------|
| `command` | Binary to spawn (e.g. `npx`, `node`) |
| `args` | Arguments array |
| `env` | Optional extra environment variables |
| `url` | HTTP/SSE transport URL (alternative to `command`) |

---

## Architecture

Three stages with a clean IR boundary:

```
[Source Adapter]  →  [Normalized IR]  →  [Code Emitter]
```

- **Source Adapter** (`packages/mcpiler/src/adapters/`) — connects to a source, introspects it, produces the IR. MCP is the first supported adapter.
- **Normalized IR** (`packages/mcpiler/src/ir.ts`) — a protocol-agnostic representation of callable operations. The contract between adapters and the emitter.
- **Code Emitter** (`packages/mcpiler/src/emitter/`) — consumes the IR and generates the typed npm package. No knowledge of any source protocol.

Adding a new adapter (OpenAPI, gRPC, GraphQL) only requires producing valid IR — the emitter is untouched.

### Generated package structure

```
<name>/
  src/
    client.ts   — Client class with one async method per operation, AsyncDisposable
    types.ts    — TypeScript interfaces generated from JSON Schemas
  package.json
  tsconfig.json
  README.md     — Auto-generated per-method docs
```

### Return type tiers

| Condition | Return type |
|-----------|-------------|
| `outputSchema` present | Generated interface (e.g. `GetWeatherOutput`) |
| No `outputSchema`, strict (default) | `Array<TextContent \| ImageContent \| AudioContent \| unknown>` |
| No `outputSchema`, `--loose` | `string` with JSDoc `@remarks` warning |

### Session lifecycle

Connection is initiated eagerly in the constructor and stored as an internal promise (`#ready`). Every method awaits it before executing — the first call blocks only for connection time, subsequent calls pass through immediately.

```ts
const client = new WeatherClient();
// connection is already being established...

const result = await client.getWeather({ city: 'NYC' }); // waits for #ready then calls
```

Cleanup is handled via `AsyncDisposable`. A `process.on('exit')` backstop kills stdio subprocesses on hard exits.

### Error handling

Both MCP error modes normalize to thrown JS errors — MCP types never leak to the consumer:

| Condition | Thrown |
|-----------|--------|
| Protocol error (JSON-RPC, connection failure) | `AdapterError` |
| Execution error (tool returned `isError: true`) | `OperationError` |

Both are exported from `@mcpiler/runtime-mcp`.

---

## Distribution

| Use case | Workflow |
|----------|----------|
| Local dev | `npm link` in generated package → `npm link <name>` in consumer |
| Monorepo | Local path dep in `package.json` |
| Published SDK | `npm publish` from generated package |

---

## Development

```bash
# Install all workspace deps
npm install

# Build all packages
npm run build

# Run all tests (42 total)
npm test

# Build a single package
npm run build --workspace=packages/mcpiler
npm run build --workspace=packages/runtime-mcp
```

### Workspace layout

```
packages/
  mcpiler/          — CLI + MCP adapter + emitter
    src/
      adapters/     — Source adapters (mcp.ts)
      emitter/      — Code generation (index.ts, names.ts)
      e2e/          — End-to-end tests (fake-server.ts, e2e.test.ts)
      cli.ts        — CLI entrypoint (bin: McPile)
      ir.ts         — Normalized IR types
  runtime-mcp/      — Runtime library peer-depended on by generated packages
    src/
      transport.ts  — McpTransport state machine
      errors.ts     — AdapterError, OperationError
      types.ts      — ContentItem types, CallResult
```

### Tests

```bash
npm test                                          # all 42 tests
npm test --workspace=packages/mcpiler            # 35 tests (unit + e2e)
npm test --workspace=packages/runtime-mcp        # 7 tests (transport)
```

The E2E suite (`src/e2e/e2e.test.ts`) spins up a real fake MCP server over stdio, runs the full adapter → emit → typecheck → runtime pipeline, and asserts on specific return values.

---

## Future

- Additional adapters — OpenAPI/REST, gRPC, GraphQL
- Watch mode — regenerate when `listChanged: true` is declared
- Auth — env var passthrough for HTTP token injection
- Multi-source — single package wrapping multiple adapters
