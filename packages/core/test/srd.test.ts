import { describe, expect, it } from 'vitest';
import { SRD_CATALOG, SRD_LICENSE } from '../src/srd/data.js';
import { lookupSrd } from '../src/srd/lookup.js';

describe('SRD catalog', () => {
  it('records SRD 5.1 CC-BY-4.0 license metadata', () => {
    expect(SRD_LICENSE.sourceTitle).toBe('System Reference Document 5.1');
    expect(SRD_LICENSE.licenseName).toBe('Creative Commons Attribution 4.0 International');
    expect(SRD_LICENSE.licenseUrl).toBe('https://creativecommons.org/licenses/by/4.0/');
    expect(SRD_LICENSE.attribution).toContain('Wizards of the Coast');
  });

  it('contains seed records for a monster, spell, and class build option', () => {
    expect(SRD_CATALOG.monsters.map((record) => record.ref)).toContain('monster:goblin');
    expect(SRD_CATALOG.spells.map((record) => record.ref)).toContain('spell:fire-bolt');
    expect(SRD_CATALOG.classes.map((record) => record.ref)).toContain('class:fighter');
  });

  it('looks up known SRD records by ref or exact name within a kind', () => {
    expect(lookupSrd({ kind: 'monster', ref: 'monster:goblin' })).toMatchObject({
      ok: true,
      record: { kind: 'monster', name: 'Goblin' },
    });
    expect(lookupSrd({ kind: 'spell', name: 'Fire Bolt' })).toMatchObject({
      ok: true,
      record: { kind: 'spell', ref: 'spell:fire-bolt' },
    });
    expect(lookupSrd({ kind: 'class', name: 'Fighter' })).toMatchObject({
      ok: true,
      record: { kind: 'class', ref: 'class:fighter' },
    });
  });

  it('rejects partial, unknown, and wrong-kind lookup inputs without fuzzy matching', () => {
    expect(lookupSrd({ kind: 'monster', name: 'Gob' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    expect(lookupSrd({ kind: 'monster', name: 'Fire Bolt' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
    expect(lookupSrd({ kind: 'spell', ref: 'spell:unknown' })).toMatchObject({
      ok: false,
      code: 'not_found',
    });
  });
});
