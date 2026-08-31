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
