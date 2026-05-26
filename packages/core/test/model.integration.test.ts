import { describe, expect, it } from 'vitest';
import { AgentSdkModelClient } from '../src/model/agentSdkClient.js';

const hasKey = !!process.env.ANTHROPIC_API_KEY;

describe.skipIf(!hasKey)('AgentSdkModelClient round-trip', () => {
  it('returns non-empty assistant text from a real call', async () => {
    const client = new AgentSdkModelClient(
      process.env.LOREWEAVER_MODEL ?? 'claude-opus-4-7',
    );
    const out = await client.complete({
      system: 'Reply with exactly the word: pong',
      messages: [{ role: 'user', content: 'ping' }],
    });
    expect(out.text.trim().length).toBeGreaterThan(0);
  }, 30_000);
});
