export interface StdioConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface HttpConfig {
  url: string;
}

export type TransportConfig = StdioConfig | HttpConfig;

export interface TextContent {
  type: 'text';
  text: string;
}

export interface ImageContent {
  type: 'image';
  data: string;
  mimeType: string;
}

export interface AudioContent {
  type: 'audio';
  data: string;
  mimeType: string;
}

export type ContentItem = TextContent | ImageContent | AudioContent;

export interface CallResult {
  /** Present when the server declared an outputSchema and returned structuredContent. */
  structured?: unknown;
  /** Normalized content items — fallback when no outputSchema. */
  content: Array<ContentItem | unknown>;
}
