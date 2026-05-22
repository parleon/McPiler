export interface IR {
  operations: Operation[];
}

export interface Operation {
  name: string;
  description?: string;
  inputSchema: JSONSchema;
  outputSchema?: JSONSchema;
}

// Minimal JSONSchema type — extend as needed
export type JSONSchema = {
  type?: string;
  properties?: Record<string, JSONSchema>;
  required?: string[];
  description?: string;
  [key: string]: unknown;
};
