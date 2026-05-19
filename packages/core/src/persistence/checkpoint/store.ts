import { openDatabase } from '../db.js';
import { assertSeparateFromBeads } from './separation.js';
import { serializeCampaign } from './serialize.js';
import { DoltRepo, type Checkpoint } from './doltRepo.js';

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
}
