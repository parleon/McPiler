export class AdapterError extends Error {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = 'AdapterError';
  }
}

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationError';
  }
}
