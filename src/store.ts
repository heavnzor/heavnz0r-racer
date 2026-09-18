import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { Event, Mission } from "./types.js";

export class Store {
  readonly db: DatabaseSync;

  constructor(readonly directory: string) {
    this.db = new DatabaseSync(join(directory, "missions.sqlite"));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS missions (id TEXT PRIMARY KEY, revision INTEGER NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT, mission_id TEXT NOT NULL,
        at TEXT NOT NULL, type TEXT NOT NULL, details TEXT NOT NULL
      );
    `);
  }

  close() { this.db.close(); }

  get(id: string): Mission {
    const row = this.db.prepare("SELECT body FROM missions WHERE id = ?").get(id);
    if (!row) throw new Error(`Unknown mission: ${id}`);
    return JSON.parse(String(row.body)) as Mission;
  }

  list(): Mission[] {
    return this.db.prepare("SELECT body FROM missions ORDER BY rowid DESC").all()
      .map((row) => JSON.parse(String(row.body)) as Mission);
  }

  events(id: string): Event[] {
    return this.db.prepare("SELECT sequence, at, type, details FROM events WHERE mission_id = ? ORDER BY sequence")
      .all(id).map((row) => ({
        sequence: Number(row.sequence), at: String(row.at), type: String(row.type),
        details: JSON.parse(String(row.details)) as unknown,
      }));
  }

  create(mission: Mission) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("INSERT INTO missions VALUES (?, ?, ?)")
        .run(mission.id, mission.revision, JSON.stringify(mission));
      this.append(mission.id, "mission.started", { kind: mission.kind, baseSha: mission.baseSha });
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  update(id: string, revision: number, type: string, change: (mission: Mission) => unknown): Mission {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const mission = this.get(id);
      if (mission.revision !== revision) {
        throw new Error(`Revision conflict: expected ${revision}, found ${mission.revision}. Resume before retrying.`);
      }
      const details = change(mission);
      mission.revision++;
      mission.updatedAt = new Date().toISOString();
      this.db.prepare("UPDATE missions SET revision = ?, body = ? WHERE id = ?")
        .run(mission.revision, JSON.stringify(mission), id);
      this.append(id, type, details ?? {});
      this.db.exec("COMMIT");
      return mission;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  private append(id: string, type: string, details: unknown) {
    this.db.prepare("INSERT INTO events (mission_id, at, type, details) VALUES (?, ?, ?, ?)")
      .run(id, new Date().toISOString(), type, JSON.stringify(details));
  }
}
