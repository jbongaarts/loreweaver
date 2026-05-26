import { describe, expect, it } from 'vitest';
import type { ModelClient, ModelMessage } from '../src/model/client.js';

class FakeModelClient implements ModelClient {
  async complete(input: {
    system?: string;
    messages: ModelMessage[];
  }): Promise<string> {
    const last = input.messages.at(-1)?.content ?? '';
    return `echo:${last}`;
  }
}

describe('ModelClient contract', () => {
  it('a conforming client returns assistant text for the last message', async () => {
    const client: ModelClient = new FakeModelClient();
    const out = await client.complete({
      system: 'be terse',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(out).toBe('echo:ping');
  });
});
