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
