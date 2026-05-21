import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBanner, main, runDoltInstall } from '../src/index.js';

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

describe('main', () => {
  const startExitCode = process.exitCode;

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    // main() sets process.exitCode on the ConfigError path; restore it so a
    // covered failure branch never leaks into the vitest process exit status.
    process.exitCode = startExitCode;
  });

  it('prints the banner and resolved config on the happy path', () => {
    vi.stubEnv('LOREWEAVER_DB_PATH', '/tmp/lw.db');
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test');
    vi.stubEnv('LOREWEAVER_MODEL', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    main(['node', 'cli']);

    const printed = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(printed).toContain('Loreweaver — core v');
    expect(printed).toContain('db=/tmp/lw.db');
    expect(process.exitCode).not.toBe(1);
  });

  it('reports a ConfigError to stderr and sets process.exitCode to 1', () => {
    vi.stubEnv('LOREWEAVER_DB_PATH', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});

    main(['node', 'cli']);

    expect(process.exitCode).toBe(1);
    expect(err.mock.calls.map((c) => String(c[0])).join('\n')).toContain(
      'config error:',
    );
  });
});

/**
 * The `import.meta.url === pathToFileURL(process.argv[1]).href` guard only
 * fires when the module is the process entrypoint, so it cannot be exercised by
 * an in-process import. Spawn the built CLI as a real subprocess instead.
 * Skipped when `dist/` is absent (e.g. a test-only run with no prior build);
 * CI always builds before testing, so it runs there.
 */
describe('entrypoint guard', () => {
  const cliDist = fileURLToPath(new URL('../dist/index.js', import.meta.url));

  it.skipIf(!existsSync(cliDist))('runs main() when invoked as the entrypoint', () => {
    const stdout = execFileSync(process.execPath, [cliDist], {
      encoding: 'utf8',
      env: {
        ...process.env,
        LOREWEAVER_DB_PATH: '/tmp/lw-entrypoint.db',
        ANTHROPIC_API_KEY: 'sk-test',
      },
    });
    expect(stdout).toContain('Loreweaver — core v');
    expect(stdout).toContain('db=/tmp/lw-entrypoint.db');
  });
});
