import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  applyConfigToEnv,
  ConfigFileError,
  installConfigDefaults,
  loadConfigFile,
} from '../src/configFile.js';
import { configFilePath } from '../src/dataRoot.js';

describe('loadConfigFile', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const dir of roots.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  function rootWith(contents: string): string {
    const root = mkdtempSync(join(tmpdir(), 'lw-cfg-'));
    roots.push(root);
    writeFileSync(configFilePath(root), contents, 'utf8');
    return root;
  }

  it('returns an empty config when no file exists', () => {
    const root = mkdtempSync(join(tmpdir(), 'lw-cfg-'));
    roots.push(root);
    expect(loadConfigFile(root)).toEqual({});
  });

  it('reads recognized non-secret keys', () => {
    const root = rootWith(
      JSON.stringify({
        defaultCampaignId: 'emberfall',
        doltHome: '/opt/dolt',
        doltBin: '/usr/bin/dolt',
        profiles: { premium_dm: { provider: 'anthropic', model: 'claude-x' } },
      }),
    );
    expect(loadConfigFile(root)).toEqual({
      defaultCampaignId: 'emberfall',
      doltHome: '/opt/dolt',
      doltBin: '/usr/bin/dolt',
      profiles: { premium_dm: { provider: 'anthropic', model: 'claude-x' } },
    });
  });

  it('rejects invalid JSON', () => {
    const root = rootWith('{ not json');
    expect(() => loadConfigFile(root)).toThrow(ConfigFileError);
  });

  it('rejects a non-object top-level value', () => {
    const root = rootWith('["a"]');
    expect(() => loadConfigFile(root)).toThrow(ConfigFileError);
  });

  it('rejects a wrongly-typed field', () => {
    const root = rootWith(JSON.stringify({ doltHome: 42 }));
    expect(() => loadConfigFile(root)).toThrow(/doltHome/);
  });

  it('rejects a secret-shaped value', () => {
    const root = rootWith(
      JSON.stringify({ doltBin: 'sk-ant-api03-AAAABBBBCCCCDDDD' }),
    );
    expect(() => loadConfigFile(root)).toThrow(/provider API key/);
  });

  it('rejects a secret-named key even with an innocuous value', () => {
    const root = rootWith(JSON.stringify({ anthropicApiKey: 'redacted' }));
    expect(() => loadConfigFile(root)).toThrow(/must not contain secrets/);
  });
});

describe('applyConfigToEnv', () => {
  it('fills Dolt env vars from config when they are unset', () => {
    const merged = applyConfigToEnv(
      {},
      { doltHome: '/opt/dolt', doltBin: '/usr/bin/dolt' },
    );
    expect(merged.LOREWEAVER_DOLT_HOME).toBe('/opt/dolt');
    expect(merged.LOREWEAVER_DOLT_BIN).toBe('/usr/bin/dolt');
  });

  it('lets an environment variable outrank the config file', () => {
    const merged = applyConfigToEnv(
      { LOREWEAVER_DOLT_HOME: '/env/dolt' },
      { doltHome: '/config/dolt' },
    );
    expect(merged.LOREWEAVER_DOLT_HOME).toBe('/env/dolt');
  });

  it('maps profile overrides onto LOREWEAVER_PROFILE_<NAME>_* variables', () => {
    const merged = applyConfigToEnv(
      {},
      {
        profiles: { premium_dm: { provider: 'anthropic', model: 'claude-x' } },
      },
    );
    expect(merged.LOREWEAVER_PROFILE_PREMIUM_DM_PROVIDER).toBe('anthropic');
    expect(merged.LOREWEAVER_PROFILE_PREMIUM_DM_MODEL).toBe('claude-x');
  });

  it('does not mutate the input environment', () => {
    const env = {};
    applyConfigToEnv(env, { doltHome: '/opt/dolt' });
    expect(env).toEqual({});
  });
});

describe('installConfigDefaults', () => {
  it('fills unset keys on the env in place', () => {
    const env: Record<string, string | undefined> = {};
    installConfigDefaults({ doltBin: '/usr/bin/dolt' }, env);
    expect(env.LOREWEAVER_DOLT_BIN).toBe('/usr/bin/dolt');
  });

  it('never overwrites a key already set in the env', () => {
    const env: Record<string, string | undefined> = {
      LOREWEAVER_DOLT_BIN: '/env/dolt',
    };
    installConfigDefaults({ doltBin: '/config/dolt' }, env);
    expect(env.LOREWEAVER_DOLT_BIN).toBe('/env/dolt');
  });
});
