import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  EMBERFALL_HOLLOW,
  WorldModuleError,
  assertShippablePack,
  evaluatePackPolicy,
  forkModuleIntoCampaign,
  initSchema,
  loadModuleFromDir,
  mutateState,
  openDatabase,
  validateModulePack,
  worldOverlayKey,
  worldQuery,
} from '../src/index.js';
import type { ModulePack, PackLicense } from '../src/index.js';

const tmpDirs: string[] = [];

afterEach(() => {
  while (tmpDirs.length > 0) {
    rmSync(tmpDirs.pop() as string, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lw-world-'));
  tmpDirs.push(dir);
  return dir;
}

function clone(): ModulePack {
  return JSON.parse(JSON.stringify(EMBERFALL_HOLLOW)) as ModulePack;
}

describe('module schema validation', () => {
  it('accepts the original sample pack and enforces referential integrity', () => {
    const pack = validateModulePack(clone());
    expect(pack.meta.packId).toBe('loreweaver:emberfall-hollow');
    expect(pack.locations.map((l) => l.id)).toContain('emberfall-square');
    expect(pack.encounters[0].creatures[0].srdRef).toBe('monster:goblin');
  });

  it('rejects a missing required field', () => {
    const bad = clone() as Record<string, unknown> & { meta: { title?: string } };
    delete bad.meta.title;
    expect(() => validateModulePack(bad)).toThrow(WorldModuleError);
  });

  it('rejects an unknown license class', () => {
    const bad = clone();
    (bad.meta.license as { licenseClass: string }).licenseClass = 'fair-use';
    expect(() => validateModulePack(bad)).toThrow(/licenseClass/);
  });

  it('rejects duplicate ids within a kind', () => {
    const bad = clone();
    (bad.locations as unknown[]).push(
      JSON.parse(JSON.stringify(bad.locations[0])),
    );
    expect(() => validateModulePack(bad)).toThrow(/duplicate id/);
  });

  it('rejects a starting location that does not resolve', () => {
    const bad = clone();
    (bad.meta as { startingLocationId: string }).startingLocationId = 'nowhere';
    expect(() => validateModulePack(bad)).toThrow(/startingLocationId/);
  });

  it('rejects an exit pointing at an unknown location', () => {
    const bad = clone();
    (bad.locations[0].exits as Array<{ toLocationId: string }>)[0].toLocationId =
      'void';
    expect(() => validateModulePack(bad)).toThrow(/unknown location/);
  });
});

describe('module pack loading', () => {
  it('loads an authored pack from a directory and leaves the file pristine', () => {
    const dir = tempDir();
    const file = join(dir, 'module.json');
    const original = JSON.stringify(EMBERFALL_HOLLOW, null, 2);
    writeFileSync(file, original, 'utf8');

    const pack = loadModuleFromDir(dir);
    const db = openDatabase(':memory:');
    initSchema(db);
    forkModuleIntoCampaign(db, pack);
    db.close();

    expect(readFileSync(file, 'utf8')).toBe(original);
  });

  it('reports a parse error as WorldModuleError', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'module.json'), '{ not json', 'utf8');
    expect(() => loadModuleFromDir(dir)).toThrow(WorldModuleError);
  });
});

describe('pack license policy', () => {
  it('treats the original CC-BY sample as shippable', () => {
    const policy = evaluatePackPolicy(EMBERFALL_HOLLOW.meta.license);
    expect(policy.shippable).toBe(true);
    expect(policy.hostedAllowed).toBe(true);
    expect(() =>
      assertShippablePack(EMBERFALL_HOLLOW.meta.license),
    ).not.toThrow();
  });

  it('never ships a user-private pack', () => {
    const lic: PackLicense = {
      ...EMBERFALL_HOLLOW.meta.license,
      licenseClass: 'user-private',
    };
    const policy = evaluatePackPolicy(lic);
    expect(policy.shippable).toBe(false);
    expect(policy.reasons.join(' ')).toContain('user-private');
    expect(() => assertShippablePack(lic)).toThrow(WorldModuleError);
  });

  it('blocks trademarked setting material without a publisher license', () => {
    const lic: PackLicense = {
      ...EMBERFALL_HOLLOW.meta.license,
      licenseClass: 'original',
      containsTrademarkedSettingMaterial: true,
    };
    expect(evaluatePackPolicy(lic).shippable).toBe(false);

    const licensed: PackLicense = {
      ...lic,
      licenseClass: 'publisher-licensed',
    };
    expect(evaluatePackPolicy(licensed).shippable).toBe(true);
  });
});

describe('campaign fork + worldQuery', () => {
  function freshCampaign() {
    const db = openDatabase(':memory:');
    initSchema(db);
    forkModuleIntoCampaign(db, validateModulePack(clone()));
    return db;
  }

  it('forks the template into queryable rows', () => {
    const db = freshCampaign();
    const meta = worldQuery(db, { type: 'meta' });
    expect(meta).toMatchObject({
      ok: true,
      resolved: { packId: 'loreweaver:emberfall-hollow' },
    });
    const npc = worldQuery(db, { type: 'npc', id: 'warden-sela' });
    expect(npc).toMatchObject({
      ok: true,
      resolved: { name: 'Warden Sela', disposition: 'wary but grateful' },
      overlays: [],
    });
    db.close();
  });

  it('re-forking is idempotent', () => {
    const db = freshCampaign();
    forkModuleIntoCampaign(db, validateModulePack(clone()));
    const rows = db
      .prepare('SELECT COUNT(*) AS n FROM module_location')
      .get() as { n: number };
    expect(rows.n).toBe(EMBERFALL_HOLLOW.locations.length);
    db.close();
  });

  it('an overlay fact overrides the template on later queries', () => {
    const db = freshCampaign();

    mutateState(db, {
      target: 'overlay_facts',
      field: worldOverlayKey('npc', 'warden-sela', 'disposition'),
      op: 'set',
      value: 'dead',
      provenance: 'combat:turn-9',
      sessionId: 'session-2',
      at: '2026-05-19T05:00:00.000Z',
    });

    const npc = worldQuery(db, { type: 'npc', id: 'warden-sela' });
    expect(npc.ok).toBe(true);
    if (npc.ok) {
      expect(npc.resolved.disposition).toBe('dead');
      expect(npc.template.disposition).toBe('wary but grateful');
      expect(npc.overlays).toEqual([
        {
          field: 'disposition',
          value: 'dead',
          provenance: 'combat:turn-9',
          sessionId: 'session-2',
          updatedAt: '2026-05-19T05:00:00.000Z',
        },
      ]);
    }
    db.close();
  });

  it('returns not_found for unknown targets and missing ids', () => {
    const db = freshCampaign();
    expect(worldQuery(db, { type: 'npc', id: 'ghost' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    expect(worldQuery(db, { type: 'location' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    db.close();
  });
});
