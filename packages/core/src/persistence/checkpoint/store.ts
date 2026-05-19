import { openDatabase } from '../db.js';
import { assertSeparateFromBeads } from './separation.js';
import { serializeCampaign } from './serialize.js';
import { DoltRepo, type Checkpoint } from './doltRepo.js';
import type { SnapshotRecord } from './serialize.js';

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

function materialize(records: SnapshotRecord[], destDbPath: string): void {
  const db = openDatabase(destDbPath);
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
}
