import sqlite3 from 'sqlite3';
import { open, type Database } from 'sqlite';

export class ThreadMap {
  private db!: Database;

  async init(filename = './thread-map.sqlite'): Promise<void> {
    this.db = await open({ filename, driver: sqlite3.Database });
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        channel_type TEXT NOT NULL,
        thread_id    TEXT NOT NULL,
        mission_id   TEXT NOT NULL,
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (channel_type, thread_id)
      )
    `);
  }

  async get(channel: string, threadId: string): Promise<string | null> {
    const row = await this.db.get<{ mission_id: string }>(
      'SELECT mission_id FROM threads WHERE channel_type = ? AND thread_id = ?',
      [channel, threadId]
    );
    return row?.mission_id ?? null;
  }

  async set(channel: string, threadId: string, missionId: string): Promise<void> {
    await this.db.run(
      'INSERT OR REPLACE INTO threads (channel_type, thread_id, mission_id) VALUES (?, ?, ?)',
      [channel, threadId, missionId]
    );
  }
}
