import { existsSync, renameSync, rmSync } from 'node:fs';
import { openDatabase } from '../db.js';
import { assertSeparateFromBeads } from './separation.js';
import { serializeCampaign } from './serialize.js';
import { DoltRepo, type Checkpoint } from './doltRepo.js';
import type { SnapshotRecord } from './serialize.js';

export class CheckpointError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckpointError';
  }
}

export class CheckpointStore {
  private readonly repo: DoltRepo;

  constructor(doltDir: string, beadsDir: string) {
    assertSeparateFromBeads(doltDir, beadsDir);
    this.repo = new DoltRepo(doltDir);
  }

  checkpoint(liveDbPath: string, message: string): string {
    const db = openDatabase(liveDbPath);
    try {
      const records = serializeCampaign(db);
      this.repo.init();
      this.repo.applySnapshot(records);
      return this.repo.commit(message);
    } finally {
      db.close();
    }
  }

  list(): Checkpoint[] {
    return this.repo.log();
  }

  restoreToNewWorkingCopy(checkpointId: string, destDbPath: string): string {
    const records = this.repo.readSnapshotAt(checkpointId);
    materialize(records, destDbPath);
    return destDbPath;
  }

  forkFromCheckpoint(
    checkpointId: string,
    branchName: string,
    destDbPath: string,
  ): string {
    this.repo.branch(branchName, checkpointId);
    return this.restoreToNewWorkingCopy(checkpointId, destDbPath);
  }
}

/**
 * Rebuild a campaign snapshot into a SQLite file. Restore is destination-safe
 * and atomic: it refuses to overwrite an existing destination, and it builds
 * into a sibling temp file that is renamed into place only after every record
 * has been applied. Any failure removes the temp file, so a partial restore
 * can never leave a usable-looking database at `destDbPath`.
 */
function materialize(records: SnapshotRecord[], destDbPath: string): void {
  if (existsSync(destDbPath)) {
    throw new CheckpointError(
      `restore destination already exists: ${destDbPath}`,
    );
  }
  const tmpDbPath = `${destDbPath}.restore-${process.pid}-${Date.now()}.tmp`;
  try {
    const db = openDatabase(tmpDbPath);
    try {
      for (const r of records.filter((x) => x.kind === 'schema')) {
        const { create } = JSON.parse(r.payload) as { create: string };
        db.exec(`${create};`);
      }
      for (const r of records.filter((x) => x.kind === 'row')) {
        const row = JSON.parse(r.payload) as Record<string, unknown>;
        const cols = Object.keys(row);
        const ph = cols.map(() => '?').join(', ');
        const vals = cols.map((c) => {
          const v = row[c] as unknown;
          if (v && typeof v === 'object' && '__blob' in (v as object)) {
            return Buffer.from((v as { __blob: string }).__blob, 'base64');
          }
          return v as string | number | null;
        });
        db.prepare(
          `INSERT INTO "${r.table}" (${cols
            .map((c) => `"${c}"`)
            .join(', ')}) VALUES (${ph})`,
        ).run(...vals);
      }
    } finally {
      db.close();
    }
    renameSync(tmpDbPath, destDbPath);
  } catch (e) {
    removeDbFiles(tmpDbPath);
    throw e;
  }
}

/** Remove a SQLite file and any WAL/SHM/journal sidecars left behind. */
function removeDbFiles(dbPath: string): void {
  for (const suffix of ['', '-wal', '-shm', '-journal']) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
}
