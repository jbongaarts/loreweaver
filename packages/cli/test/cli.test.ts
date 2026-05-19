import { describe, expect, it, vi } from 'vitest';
import { buildBanner, runDoltInstall } from '../src/index.js';

describe('cli', () => {
  it('builds a banner that includes the core version', () => {
    expect(buildBanner('1.2.3')).toBe('Loreweaver — core v1.2.3');
  });
});

describe('runDoltInstall', () => {
  it('reports the path and exits 0 when dolt is ready', async () => {
    const logs: string[] = [];
    const code = await runDoltInstall({
      ensure: async ({ confirm }) => {
        // already-present path: ensure() resolves without consulting confirm
        void confirm;
        return '/usr/bin/dolt';
      },
      log: (m) => logs.push(m),
    });
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('/usr/bin/dolt');
  });

  it('exits 1 with the actionable message when install is declined', async () => {
    const logs: string[] = [];
    const code = await runDoltInstall({
      ensure: async () => {
        throw new Error('a managed install was declined');
      },
      log: (m) => logs.push(m),
    });
    expect(code).toBe(1);
    expect(logs.join('\n')).toContain('declined');
  });

  it('passes a confirm callback through to ensureDoltAvailable', async () => {
    const ensure = vi.fn().mockResolvedValue('/x/dolt');
    await runDoltInstall({ ensure, confirm: () => true });
    expect(ensure).toHaveBeenCalledOnce();
    expect(typeof ensure.mock.calls[0][0].confirm).toBe('function');
  });
});
