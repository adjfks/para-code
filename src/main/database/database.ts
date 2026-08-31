import Database from 'better-sqlite3'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const MIGRATIONS = ['0001_init.sql', '0002_interactions.sql', '0003_grouping_plans.sql'] as const

export class ParaCodeDatabase {
  private readonly database: Database.Database

  private constructor(database: Database.Database) {
    this.database = database
  }

  static async open(databasePath: string): Promise<ParaCodeDatabase> {
    await mkdir(path.dirname(databasePath), { recursive: true })
    const database = new Database(databasePath)
    database.pragma('journal_mode = WAL')
    database.pragma('foreign_keys = ON')
    database.pragma('busy_timeout = 5000')
    const instance = new ParaCodeDatabase(database)
    instance.migrate()
    return instance
  }

  close(): void {
    this.database.close()
  }

  transaction<T>(run: () => T): T {
    return this.database.transaction(run)()
  }

  prepare(statement: string): Database.Statement {
    return this.database.prepare(statement)
  }

  private migrate(): void {
    const currentVersion = Number(this.database.pragma('user_version', { simple: true }))
    if (currentVersion > MIGRATIONS.length) {
      throw new Error(
        `数据库 schema 版本 ${currentVersion} 高于当前应用支持的版本 ${MIGRATIONS.length}。`,
      )
    }

    this.database.transaction(() => {
      MIGRATIONS.forEach((migration, index) => {
        const version = index + 1
        if (version <= currentVersion) return
        this.database.exec(MIGRATION_SQL[migration])
        this.database.pragma(`user_version = ${version}`)
      })
    })()
  }
}

const MIGRATION_SQL: Record<(typeof MIGRATIONS)[number], string> = {
  '0001_init.sql': `
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      repository_path TEXT NOT NULL,
      worktree_path TEXT NOT NULL,
      branch_name TEXT NOT NULL,
      base_ref TEXT NOT NULL,
      requirement TEXT NOT NULL,
      agent_session_id TEXT,
      status TEXT NOT NULL,
      latest_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_runs_created_at ON runs (created_at DESC);
    CREATE INDEX idx_runs_status ON runs (status);

    CREATE TABLE agent_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      agent_session_id TEXT,
      sequence INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      UNIQUE (run_id, sequence)
    );

    CREATE INDEX idx_agent_events_run_id ON agent_events (run_id, sequence);
    CREATE INDEX idx_agent_events_type ON agent_events (type);
  `,
  '0002_interactions.sql': `
    CREATE TABLE interaction_requests (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      agent_session_id TEXT,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      options_json TEXT NOT NULL,
      provider_request_id TEXT,
      provider_method TEXT,
      idempotency_key TEXT,
      answer_json TEXT,
      created_at TEXT NOT NULL,
      answered_at TEXT,
      UNIQUE (event_id)
    );

    CREATE INDEX idx_interaction_requests_run_id ON interaction_requests (run_id, created_at);
    CREATE INDEX idx_interaction_requests_status ON interaction_requests (status, created_at);
  `,
  '0003_grouping_plans.sql': `
    ALTER TABLE runs ADD COLUMN grouping_plan_id TEXT;
    ALTER TABLE runs ADD COLUMN group_id TEXT;

    CREATE TABLE grouping_plans (
      id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      repository_path TEXT NOT NULL,
      base_ref TEXT NOT NULL,
      source_text TEXT NOT NULL,
      requirements_json TEXT NOT NULL,
      groups_json TEXT NOT NULL,
      unassigned_json TEXT NOT NULL,
      group_runs_json TEXT NOT NULL,
      status TEXT NOT NULL,
      confirm_key TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX idx_runs_grouping_plan_id ON runs (grouping_plan_id);
    CREATE INDEX idx_grouping_plans_updated_at ON grouping_plans (updated_at DESC);
  `,
}
