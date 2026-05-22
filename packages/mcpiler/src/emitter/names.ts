const RESERVED_WORDS = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'let',
  'new',
  'null',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'await',
  'async',
  'enum',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
]);

function getSegments(rawName: string): string[] {
  return rawName
    .replace(/[^A-Za-z0-9]+/g, '_')
    .split('_')
    .filter(Boolean);
}

function toTitleCase(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase();
}

function finalizeIdentifier(name: string): string {
  if (!name) {
    throw new Error('Name normalization produced an empty identifier');
  }

  const prefixed = /^\d/.test(name) ? `op_${name}` : name;
  return RESERVED_WORDS.has(prefixed) ? `$${prefixed}` : prefixed;
}

export function toMethodName(rawName: string): string {
  const segments = getSegments(rawName);

  if (segments.length === 0) {
    throw new Error(`Cannot derive method name from ${JSON.stringify(rawName)}`);
  }

  const [first, ...rest] = segments;
  return finalizeIdentifier(first.toLowerCase() + rest.map(toTitleCase).join(''));
}

export function toTypeName(rawName: string): string {
  const segments = getSegments(rawName);

  if (segments.length === 0) {
    throw new Error(`Cannot derive type name from ${JSON.stringify(rawName)}`);
  }

  return finalizeIdentifier(segments.map(toTitleCase).join(''));
}

export function toClassName(packageName: string): string {
  const localName = packageName.startsWith('@') ? (packageName.split('/')[1] ?? '') : packageName;
  const segments = localName.split(/[^A-Za-z0-9]+/).filter(Boolean);

  if (segments.length === 0) {
    throw new Error(`Cannot derive class name from package name ${JSON.stringify(packageName)}`);
  }

  return finalizeIdentifier(segments.map(toTitleCase).join(''));
}

export function checkNameCollisions(names: string[]): void {
  const collisions = new Map<string, string[]>();

  for (const rawName of names) {
    const methodName = toMethodName(rawName);
    const existing = collisions.get(methodName);

    if (existing) {
      existing.push(rawName);
      continue;
    }

    collisions.set(methodName, [rawName]);
  }

  const duplicates = [...collisions.entries()].filter(([, rawNames]) => rawNames.length > 1);

  if (duplicates.length === 0) {
    return;
  }

  const details = duplicates
    .map(([methodName, rawNames]) => `${methodName} <= ${rawNames.map((rawName) => JSON.stringify(rawName)).join(', ')}`)
    .join('; ');
  throw new Error(`Operation name collision after normalization: ${details}`);
}
