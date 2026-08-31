import type {
  AgentEvent,
  GroupingPlan,
  InteractionRequest,
  RunSnapshot,
  WorktreeRun,
} from '../../shared/ipc'
import type Database from 'better-sqlite3'
import type { ParaCodeDatabase } from '../database/database'
import type { RunRepository } from './types'

export class SqliteRunRepository implements RunRepository {
  private readonly database: ParaCodeDatabase

  private readonly saveStatement: Database.Statement
  private readonly getRunStatement: Database.Statement
  private readonly listRunsStatement: Database.Statement
  private readonly listEventsStatement: Database.Statement
  private readonly listInteractionsByRunStatement: Database.Statement
  private readonly listInteractionsStatement: Database.Statement
  private readonly getInteractionStatement: Database.Statement
  private readonly upsertInteractionStatement: Database.Statement
  private readonly appendEventStatement: Database.Statement
  private readonly upsertPlanStatement: Database.Statement
  private readonly getPlanStatement: Database.Statement

  constructor(database: ParaCodeDatabase) {
    this.database = database
    this.saveStatement = this.database.prepare(
      `INSERT INTO runs (
        id, repository_path, worktree_path, branch_name, base_ref, requirement,
        grouping_plan_id, group_id, agent_session_id, status, latest_message, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        repository_path = excluded.repository_path,
        worktree_path = excluded.worktree_path,
        branch_name = excluded.branch_name,
        base_ref = excluded.base_ref,
        requirement = excluded.requirement,
        grouping_plan_id = excluded.grouping_plan_id,
        group_id = excluded.group_id,
        agent_session_id = excluded.agent_session_id,
        status = excluded.status,
        latest_message = excluded.latest_message,
        updated_at = excluded.updated_at`,
    )
    this.getRunStatement = this.database.prepare('SELECT * FROM runs WHERE id = ?')
    this.listRunsStatement = this.database.prepare(
      'SELECT * FROM runs ORDER BY created_at DESC, id DESC',
    )
    this.listEventsStatement = this.database.prepare(
      'SELECT * FROM agent_events WHERE run_id = ? ORDER BY sequence',
    )
    this.listInteractionsByRunStatement = this.database.prepare(
      'SELECT * FROM interaction_requests WHERE run_id = ? ORDER BY created_at, id',
    )
    this.listInteractionsStatement = this.database.prepare(
      'SELECT * FROM interaction_requests ORDER BY created_at, id',
    )
    this.getInteractionStatement = this.database.prepare(
      'SELECT * FROM interaction_requests WHERE id = ?',
    )
    this.upsertInteractionStatement = this.database.prepare(
      `INSERT INTO interaction_requests (
        id, run_id, event_id, agent_session_id, type, status, title, message,
        options_json, provider_request_id, provider_method, idempotency_key,
        answer_json, created_at, answered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        idempotency_key = excluded.idempotency_key,
        answer_json = excluded.answer_json,
        answered_at = excluded.answered_at`,
    )
    this.upsertPlanStatement = this.database.prepare(
      `INSERT INTO grouping_plans (
        id, version, repository_path, base_ref, source_text, requirements_json,
        groups_json, unassigned_json, group_runs_json, status, confirm_key, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        version = excluded.version,
        repository_path = excluded.repository_path,
        base_ref = excluded.base_ref,
        source_text = excluded.source_text,
        requirements_json = excluded.requirements_json,
        groups_json = excluded.groups_json,
        unassigned_json = excluded.unassigned_json,
        group_runs_json = excluded.group_runs_json,
        status = excluded.status,
        confirm_key = excluded.confirm_key,
        updated_at = excluded.updated_at`,
    )
    this.getPlanStatement = this.database.prepare('SELECT * FROM grouping_plans WHERE id = ?')
    this.appendEventStatement = this.database.prepare(
      `INSERT INTO agent_events (
        id, run_id, agent_session_id, sequence, timestamp, type, payload_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING`,
    )
  }

  async save(snapshot: RunSnapshot): Promise<void> {
    const run = snapshot.run
    this.database.transaction(() => {
      this.saveStatement.run(
        run.id,
        run.repositoryPath,
        run.worktreePath,
        run.branchName,
        run.baseRef,
        run.requirement,
        run.groupingPlanId,
        run.groupId,
        run.agentSessionId,
        run.status,
        run.latestMessage,
        run.createdAt,
        run.updatedAt,
      )
      for (const interaction of snapshot.interactions ?? []) {
        const existing = this.getInteractionStatement.get(interaction.id) as
          InteractionRow | undefined
        if (
          existing &&
          (existing.status === 'answered' || existing.status === 'canceled') &&
          interaction.status === 'queued'
        ) {
          continue
        }
        this.upsertInteractionStatement.run(
          interaction.id,
          interaction.runId,
          interaction.eventId,
          interaction.agentSessionId,
          interaction.type,
          interaction.status,
          interaction.title,
          interaction.message,
          JSON.stringify(interaction.options),
          interaction.providerRequestId === undefined
            ? null
            : String(interaction.providerRequestId),
          interaction.providerMethod,
          interaction.idempotencyKey,
          interaction.answer ? JSON.stringify(interaction.answer) : null,
          interaction.createdAt,
          interaction.answeredAt,
        )
      }
    })
  }

  async get(runId: string): Promise<RunSnapshot | undefined> {
    const run = this.getRunStatement.get(runId) as RunRow | undefined
    return run
      ? {
          run: toRun(run),
          events: await this.getEvents(runId),
          interactions: this.getInteractions(runId),
        }
      : undefined
  }

  async listRuns(): Promise<WorktreeRun[]> {
    return (this.listRunsStatement.all() as RunRow[]).map(toRun)
  }

  async getEvents(runId: string): Promise<AgentEvent[]> {
    return (this.listEventsStatement.all(runId) as EventRow[]).map(toEvent)
  }

  async listInteractions(): Promise<InteractionRequest[]> {
    return (this.listInteractionsStatement.all() as InteractionRow[]).map(toInteraction)
  }

  getInteractions(runId: string): InteractionRequest[] {
    return (this.listInteractionsByRunStatement.all(runId) as InteractionRow[]).map(toInteraction)
  }

  async savePlan(plan: GroupingPlan): Promise<void> {
    this.upsertPlanStatement.run(
      plan.id,
      plan.version,
      plan.repositoryPath,
      plan.baseRef,
      plan.sourceText,
      JSON.stringify(plan.requirements),
      JSON.stringify(plan.groups),
      JSON.stringify(plan.unassigned),
      JSON.stringify(plan.groupRuns),
      plan.status,
      plan.confirmKey,
      plan.createdAt,
      plan.updatedAt,
    )
  }

  async getPlan(planId: string): Promise<GroupingPlan | undefined> {
    const row = this.getPlanStatement.get(planId) as PlanRow | undefined
    return row ? toPlan(row) : undefined
  }

  async appendEvent(runId: string, event: AgentEvent): Promise<RunSnapshot | undefined> {
    const snapshot = await this.get(runId)
    if (!snapshot) throw new Error(`运行记录不存在：${runId}`)
    if (snapshot.events.some((item) => item.id === event.id)) return snapshot
    this.appendEventStatement.run(
      event.id,
      runId,
      event.agentSessionId,
      event.sequence,
      event.timestamp,
      event.type,
      JSON.stringify(event.payload),
    )
    return this.get(runId)
  }

  async appendRecoveryEvent(run: WorktreeRun, message: string): Promise<AgentEvent | undefined> {
    const existing = await this.getEvents(run.id)
    const sequence = existing.length + 1
    const event: AgentEvent = {
      id: `recovery-${run.id}`,
      runId: run.id,
      agentSessionId: run.agentSessionId,
      sequence,
      timestamp: new Date().toISOString(),
      type: 'session_failed',
      payload: { message },
    }
    await this.appendEvent(run.id, event)
    return event
  }
}

interface RunRow {
  id: string
  repository_path: string
  worktree_path: string
  branch_name: string
  base_ref: string
  requirement: string
  grouping_plan_id?: string | null
  group_id?: string | null
  agent_session_id?: string | null
  status: string
  latest_message?: string | null
  created_at: string
  updated_at: string
}

interface EventRow {
  id: string
  run_id: string
  agent_session_id?: string | null
  sequence: number
  timestamp: string
  type: string
  payload_json: string
}

function toRun(row: RunRow): WorktreeRun {
  return {
    id: row.id,
    repositoryPath: row.repository_path,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    baseRef: row.base_ref,
    requirement: row.requirement,
    groupingPlanId: row.grouping_plan_id ?? undefined,
    groupId: row.group_id ?? undefined,
    agentSessionId: row.agent_session_id ?? undefined,
    status: row.status as WorktreeRun['status'],
    latestMessage: row.latest_message ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface InteractionRow {
  id: string
  run_id: string
  event_id: string
  agent_session_id?: string | null
  type: string
  status: string
  title: string
  message: string
  options_json: string
  provider_request_id?: string | null
  provider_method?: string | null
  idempotency_key?: string | null
  answer_json?: string | null
  created_at: string
  answered_at?: string | null
}

function toInteraction(row: InteractionRow): InteractionRequest {
  const numericId = Number(row.provider_request_id)
  return {
    id: row.id,
    runId: row.run_id,
    eventId: row.event_id,
    agentSessionId: row.agent_session_id ?? undefined,
    type: row.type as InteractionRequest['type'],
    status: row.status as InteractionRequest['status'],
    title: row.title,
    message: row.message,
    options: JSON.parse(row.options_json) as InteractionRequest['options'],
    providerRequestId:
      row.provider_request_id === null || row.provider_request_id === undefined
        ? undefined
        : Number.isNaN(numericId)
          ? row.provider_request_id
          : numericId,
    providerMethod: row.provider_method ?? undefined,
    idempotencyKey: row.idempotency_key ?? undefined,
    answer: row.answer_json
      ? (JSON.parse(row.answer_json) as InteractionRequest['answer'])
      : undefined,
    createdAt: row.created_at,
    answeredAt: row.answered_at ?? undefined,
  }
}

function toEvent(row: EventRow): AgentEvent {
  return {
    id: row.id,
    runId: row.run_id,
    agentSessionId: row.agent_session_id ?? undefined,
    sequence: row.sequence,
    timestamp: row.timestamp,
    type: row.type as AgentEvent['type'],
    payload: JSON.parse(row.payload_json) as AgentEvent['payload'],
  }
}

interface PlanRow {
  id: string
  version: number
  repository_path: string
  base_ref: string
  source_text: string
  requirements_json: string
  groups_json: string
  unassigned_json: string
  group_runs_json: string
  status: string
  confirm_key?: string | null
  created_at: string
  updated_at: string
}

function toPlan(row: PlanRow): GroupingPlan {
  return {
    id: row.id,
    version: row.version,
    repositoryPath: row.repository_path,
    baseRef: row.base_ref,
    sourceText: row.source_text,
    requirements: JSON.parse(row.requirements_json) as GroupingPlan['requirements'],
    groups: JSON.parse(row.groups_json) as GroupingPlan['groups'],
    unassigned: JSON.parse(row.unassigned_json) as GroupingPlan['unassigned'],
    groupRuns: JSON.parse(row.group_runs_json) as GroupingPlan['groupRuns'],
    status: row.status as GroupingPlan['status'],
    confirmKey: row.confirm_key ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
