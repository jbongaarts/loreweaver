import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Offline unit coverage for AgentSdkModelClient (loreweaver-bq1 / loreweaver-jmv).
 *
 * The adapter's only non-trivial logic — flattening structured messages into the
 * SDK's single `prompt` string, and the provider error path — was previously
 * exercised only by the gated live-API integration test. Here the Agent SDK is
 * mocked so the flattening and error semantics run deterministically with no
 * network access.
 */

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}));

import { AgentSdkModelClient } from '../src/model/agentSdkClient.js';
import { ModelClientError } from '../src/model/client.js';

/** An async generator yielding the given SDK stream messages, in order. */
function sdkStream(...messages: unknown[]): AsyncGenerator<unknown> {
  return (async function* () {
    for (const m of messages) yield m;
  })();
}

const ok = (result: string) => ({ type: 'result', subtype: 'success', result });

describe('AgentSdkModelClient', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('flattens messages into a "role: content" prompt and forwards model + system', async () => {
    queryMock.mockReturnValue(sdkStream(ok('narration')));

    const out = await new AgentSdkModelClient('claude-test').complete({
      system: 'be a DM',
      messages: [
        { role: 'user', content: 'i open the door' },
        { role: 'assistant', content: 'it creaks' },
        { role: 'user', content: 'i step through' },
      ],
    });

    expect(out).toBe('narration');
    expect(queryMock).toHaveBeenCalledOnce();
    const arg = queryMock.mock.calls[0][0] as {
      prompt: string;
      options: { model: string; systemPrompt?: string };
    };
    expect(arg.prompt).toBe(
      'user: i open the door\nassistant: it creaks\nuser: i step through',
    );
    expect(arg.options.model).toBe('claude-test');
    expect(arg.options.systemPrompt).toBe('be a DM');
  });

  it('omits systemPrompt entirely when no system text is given', async () => {
    queryMock.mockReturnValue(sdkStream(ok('ok')));

    await new AgentSdkModelClient('m').complete({
      messages: [{ role: 'user', content: 'hi' }],
    });

    const arg = queryMock.mock.calls[0][0] as { options: Record<string, unknown> };
    expect('systemPrompt' in arg.options).toBe(false);
  });

  it('takes the success result even when non-result messages precede it', async () => {
    queryMock.mockReturnValue(
      sdkStream({ type: 'system' }, { type: 'assistant' }, ok('final')),
    );

    const out = await new AgentSdkModelClient('m').complete({
      messages: [{ role: 'user', content: 'x' }],
    });

    expect(out).toBe('final');
  });

  it('throws ModelClientError on an SDK error result (loreweaver-jmv)', async () => {
    queryMock.mockReturnValue(
      sdkStream({ type: 'result', subtype: 'error_during_execution' }),
    );

    await expect(
      new AgentSdkModelClient('m').complete({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(
      /Agent SDK returned an error result \(subtype: error_during_execution\)/,
    );
  });

  it('throws ModelClientError when the stream ends without a result message', async () => {
    queryMock.mockReturnValue(sdkStream({ type: 'system' }, { type: 'assistant' }));

    await expect(
      new AgentSdkModelClient('m').complete({
        messages: [{ role: 'user', content: 'x' }],
      }),
    ).rejects.toThrowError(ModelClientError);
  });
});
