export interface ModelMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ModelCompleteInput {
  system?: string;
  messages: ModelMessage[];
}

export interface ModelClient {
  complete(input: ModelCompleteInput): Promise<string>;
}
