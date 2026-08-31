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
