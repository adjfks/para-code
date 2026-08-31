import type {
  AgentEvent,
  AnalyzePlanInput,
  AnswerInteractionInput,
  ConfirmPlanInput,
  ConfirmPlanResult,
  GroupingPlan,
  InteractionAnswer,
  InteractionRequest,
  RunSnapshot,
  StartTaskInput,
  UpdatePlanInput,
  WorktreeRun,
} from '../../shared/ipc'

export interface WorktreeMetadata {
  repositoryPath: string
  worktreePath: string
  branchName: string
  baseRef: string
}

export interface WorktreeManager {
  validate?(input: StartTaskInput): Promise<void>
  create(input: StartTaskInput & { runId: string }): Promise<WorktreeMetadata>
}

export interface AgentRunContext {
  runId: string
  worktreePath: string
  requirement: string
  baseRef: string
}

export interface AgentProvider {
  start(
    context: AgentRunContext,
    emit: (event: Omit<AgentEvent, 'id' | 'runId' | 'sequence' | 'timestamp'>) => void,
  ): Promise<{ agentSessionId: string }>
  stop(agentSessionId: string): Promise<void>
  respond(
    agentSessionId: string,
    request: InteractionRequest,
    answer: InteractionAnswer,
  ): Promise<void>
}

export interface RunRepository {
  save(snapshot: RunSnapshot): Promise<void>
  get(runId: string): Promise<RunSnapshot | undefined>
  listRuns(): Promise<WorktreeRun[]>
  listInteractions(): Promise<InteractionRequest[]>
  appendEvent(runId: string, event: AgentEvent): Promise<RunSnapshot | undefined>
  savePlan(plan: GroupingPlan): Promise<void>
  getPlan(planId: string): Promise<GroupingPlan | undefined>
}

export interface Orchestrator {
  startTask(input: StartTaskInput): Promise<RunSnapshot>
  stopTask(runId: string): Promise<RunSnapshot>
  getRun(runId: string): Promise<RunSnapshot | undefined>
  listRuns(): Promise<WorktreeRun[]>
  listInteractions(): Promise<InteractionRequest[]>
  answerInteraction(input: AnswerInteractionInput): Promise<RunSnapshot>
  analyzePlan(input: AnalyzePlanInput): Promise<GroupingPlan>
  updatePlan(input: UpdatePlanInput): Promise<GroupingPlan>
  confirmPlan(input: ConfirmPlanInput): Promise<ConfirmPlanResult>
  onEvent(listener: (event: AgentEvent) => void): () => void
}

export type RunMutable = WorktreeRun
