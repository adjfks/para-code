import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'

import type {
  AgentEvent,
  AgentEventPayload,
  AnswerInteractionInput,
  AppInfo,
  ConfirmPlanFailure,
  GroupingPlan,
  InteractionRequest,
  ProjectSummary,
  ProviderSummary,
  RunSnapshot,
  RunStatus,
  WorktreeRun,
  ProviderConfigInput,
  ProviderTestResult,
} from '../../shared/ipc'
import { parseRequirementTexts } from '../../shared/requirements'

type LoadState = 'loading' | 'ready' | 'error'
type View = 'session' | 'board' | 'queue' | 'settings'
type TimelineKind =
  'message' | 'reasoning' | 'plan' | 'activityGroup' | 'test' | 'attention' | 'system'

interface ActivityEntry {
  id: string
  title: string
  body?: string
  detail?: string
  status?: 'running' | 'completed' | 'failed' | 'waiting'
  timestamp: string
}

interface PlanStep {
  step: string
  status: 'pending' | 'inProgress' | 'completed'
}

interface TimelineEntry {
  id: string
  kind: TimelineKind
  title: string
  body?: string
  detail?: string
  status?: 'running' | 'completed' | 'failed' | 'waiting'
  timestamp: string
  items?: ActivityEntry[]
  plan?: PlanStep[]
}

const STATUS_LABELS: Record<RunStatus, string> = {
  proposed: '待启动',
  creating: '创建 worktree',
  bootstrapping: '启动 Agent',
  planning: '分析中',
  coding: '编码中',
  waiting_human: '等待处理',
  testing: '测试中',
  ready_for_review: '等待查看',
  completed: '已完成',
  failed: '执行失败',
  canceled: '已取消',
}

const PHASE_LABELS: Record<string, string> = {
  planning: '开始分析需求',
  coding: '开始修改代码',
  testing: '开始运行测试',
}

function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [repositoryPath, setRepositoryPath] = useState<string>()
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [projectState, setProjectState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [requirement, setRequirement] = useState('')
  const [plan, setPlan] = useState<GroupingPlan>()
  const [planFailures, setPlanFailures] = useState<ConfirmPlanFailure[]>([])
  const [runs, setRuns] = useState<WorktreeRun[]>([])
  const [run, setRun] = useState<RunSnapshot>()
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [interactions, setInteractions] = useState<InteractionRequest[]>([])
  const [activeView, setActiveView] = useState<View>('session')
  const [actionState, setActionState] = useState<'idle' | 'starting' | 'stopping' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string>()
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string>()
  const [selectedModel, setSelectedModel] = useState<string>()

  useEffect(() => {
    window.paracode
      .getAppInfo()
      .then((info) => {
        setAppInfo(info)
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
  }, [])

  useEffect(() => {
    let canceled = false
    window.paracode
      .listRuns()
      .then((items) => {
        if (!canceled) setRuns(items)
      })
      .catch(() => undefined)
    window.paracode
      .listInteractions()
      .then((items) => {
        if (!canceled) setInteractions(items)
      })
      .catch(() => undefined)
    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    let canceled = false
    setProjectState('loading')
    window.paracode
      .listProjects()
      .then((items) => {
        if (canceled) return
        setProjects(items)
        const current = items.find((item) => item.isCurrent)
        setRepositoryPath(current?.repositoryPath)
        setProjectState('ready')
      })
      .catch(() => {
        if (!canceled) setProjectState('error')
      })
    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    window.paracode
      .listProviders()
      .then((items) => {
        setProviders(items)
        const selected = items.find((item) => item.isDefault) ?? items[0]
        setSelectedProviderId((current) => current ?? selected?.id)
        setSelectedModel((current) => current ?? selected?.model)
      })
      .catch(() => undefined)
  }, [])

  useEffect(
    () =>
      window.paracode.onRunEvent((event) => {
        setEvents((current) => {
          if (current.some((item) => item.id === event.id)) return current
          return [...current, event].sort((a, b) => a.sequence - b.sequence)
        })
        setRun((current) => {
          if (!current || current.run.id !== event.runId) return current
          const nextStatus =
            current.run.status === 'canceled'
              ? undefined
              : statusForEvent(event.type, event.payload)
          const message = payloadString(event.payload, 'message')
          return {
            ...current,
            run: {
              ...current.run,
              status: nextStatus ?? current.run.status,
              worktreePath:
                payloadString(event.payload, 'worktreePath') ?? current.run.worktreePath,
              branchName: payloadString(event.payload, 'branchName') ?? current.run.branchName,
              baseRef: payloadString(event.payload, 'baseRef') ?? current.run.baseRef,
              latestMessage: message ?? current.run.latestMessage,
              updatedAt: event.timestamp,
            },
          }
        })
        setRuns((current) => {
          if (event.type !== 'run_status_changed') return current
          const status = payloadString(event.payload, 'status') as RunStatus | undefined
          if (!status) return current
          return current.map((item) =>
            item.id === event.runId
              ? {
                  ...item,
                  status,
                  latestMessage: payloadString(event.payload, 'message') ?? item.latestMessage,
                  worktreePath: payloadString(event.payload, 'worktreePath') ?? item.worktreePath,
                  branchName: payloadString(event.payload, 'branchName') ?? item.branchName,
                  baseRef: payloadString(event.payload, 'baseRef') ?? item.baseRef,
                  updatedAt: event.timestamp,
                }
              : item,
          )
        })
        if (
          event.type === 'question' ||
          event.type === 'approval_request' ||
          event.type === 'interaction_answered' ||
          event.type === 'session_canceled'
        ) {
          void window.paracode
            .listInteractions()
            .then(setInteractions)
            .catch(() => undefined)
        }
      }),
    [],
  )

  const timeline = useMemo(() => buildTimeline(events), [events])
  const projectName = projectLabel(repositoryPath)
  const currentProject = projects.find((project) => project.isCurrent)
  const currentProjectHealthLabel =
    currentProject?.health === 'invalid'
      ? '项目不可用'
      : projectState === 'loading'
        ? '项目校验中'
        : currentProject
          ? '项目可用'
          : '未选择项目'
  const runStatus = run ? STATUS_LABELS[run.run.status] : '尚未启动'
  const queueCount = interactions.filter((item) => item.status === 'queued').length
  const pendingInteraction = interactions.find(
    (item) => item.status === 'queued' && item.runId === run?.run.id,
  )
  const currentActivity = timeline
    .flatMap((entry) => (entry.kind === 'activityGroup' ? (entry.items ?? []) : []))
    .find((entry) => entry.status === 'running')

  async function addProject(): Promise<void> {
    try {
      const repositoryPath = await window.paracode.selectProjectPath()
      if (!repositoryPath) return
      setProjectState('loading')
      const nextProjects = await window.paracode.addProject(repositoryPath)
      setProjects(nextProjects)
      const current = nextProjects.find((item) => item.isCurrent)
      setRepositoryPath(current?.repositoryPath)
      setProjectState('ready')
      setErrorMessage(undefined)
    } catch (error) {
      setProjectState('ready')
      setErrorMessage(error instanceof Error ? error.message : '添加项目失败')
    }
  }

  async function selectProject(id: string): Promise<void> {
    try {
      setProjectState('loading')
      const nextProjects = await window.paracode.setCurrentProject(id)
      setProjects(nextProjects)
      const current = nextProjects.find((item) => item.isCurrent)
      setRepositoryPath(current?.repositoryPath)
      setProjectState('ready')
      setErrorMessage(undefined)
    } catch (error) {
      setProjectState('ready')
      setErrorMessage(error instanceof Error ? error.message : '切换项目失败')
    }
  }

  async function validateProject(id: string): Promise<void> {
    try {
      setProjectState('loading')
      setProjects(await window.paracode.validateProject(id))
      setProjectState('ready')
    } catch (error) {
      setProjectState('ready')
      setErrorMessage(error instanceof Error ? error.message : '检查项目失败')
    }
  }

  async function removeProject(id: string): Promise<void> {
    try {
      const nextProjects = await window.paracode.removeProject(id)
      setProjects(nextProjects)
      const current = nextProjects.find((item) => item.isCurrent)
      setRepositoryPath(current?.repositoryPath)
      setErrorMessage(undefined)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '移除项目失败')
    }
  }

  async function validateProjects(): Promise<void> {
    try {
      setProjectState('loading')
      setProjects(await window.paracode.listProjects())
      setProjectState('ready')
    } catch {
      setProjectState('error')
    }
  }

  async function startTask(): Promise<void> {
    if (!repositoryPath || !requirement.trim() || actionState === 'starting') return
    setActionState('starting')
    setErrorMessage(undefined)
    setEvents([])
    setRun(undefined)
    setActiveView('session')
    try {
      const texts = parseRequirementTexts(requirement)
      if (texts.length > 1) {
        const nextPlan = await window.paracode.analyzePlan({
          repositoryPath,
          text: requirement.trim(),
          providerId: selectedProviderId,
          model: selectedModel,
        })
        setPlan(nextPlan)
        setPlanFailures([])
        setActionState('idle')
        return
      }
      setPlan(undefined)
      setPlanFailures([])
      const snapshot = await window.paracode.startTask({
        repositoryPath,
        requirement: requirement.trim(),
        providerId: selectedProviderId,
        model: selectedModel,
      })
      setRun(snapshot)
      setRuns((current) => [snapshot.run, ...current])
      setEvents((current) => mergeEvents(snapshot.events, current))
      setActionState('idle')
    } catch (error) {
      setActionState('error')
      setErrorMessage(error instanceof Error ? error.message : '任务启动失败')
    }
  }

  async function movePlanRequirement(requirementId: string, targetGroupId: string): Promise<void> {
    if (!plan || actionState === 'starting') return
    setActionState('starting')
    setErrorMessage(undefined)
    try {
      setPlan(
        await window.paracode.updatePlan({
          planId: plan.id,
          version: plan.version,
          requirementId,
          targetGroupId,
        }),
      )
      setPlanFailures([])
      setActionState('idle')
    } catch (error) {
      setActionState('error')
      setErrorMessage(error instanceof Error ? error.message : '调整分组失败')
    }
  }

  async function confirmCurrentPlan(retry = false): Promise<void> {
    if (!plan || actionState === 'starting') return
    setActionState('starting')
    setErrorMessage(undefined)
    try {
      const result = await window.paracode.confirmPlan({
        planId: plan.id,
        version: plan.version,
        idempotencyKey: retry
          ? `ui:${plan.id}:v${plan.version}:retry`
          : `ui:${plan.id}:v${plan.version}`,
      })
      setPlan(result.plan)
      setPlanFailures(result.failures)
      setRuns((current) => {
        const incoming = result.runs.map((item) => item.run)
        return [
          ...incoming,
          ...current.filter((item) => incoming.every((run) => run.id !== item.id)),
        ]
      })
      setActionState('idle')
      if (result.failures.length > 0) {
        setActiveView('session')
        return
      }
      if (result.runs[0]) {
        setRun(result.runs[0])
        setEvents(result.runs[0].events)
      }
      setActiveView(result.runs.length > 1 ? 'board' : 'session')
    } catch (error) {
      setActionState('error')
      setErrorMessage(error instanceof Error ? error.message : '确认分组失败')
    }
  }

  async function answerInteraction(
    input: Omit<AnswerInteractionInput, 'idempotencyKey'>,
  ): Promise<void> {
    setActionState('starting')
    setErrorMessage(undefined)
    try {
      const snapshot = await window.paracode.answerInteraction({
        ...input,
        idempotencyKey: `ui:${input.requestId}`,
      })
      setRun(snapshot)
      setEvents((current) => mergeEvents(snapshot.events, current))
      setInteractions(await window.paracode.listInteractions())
      setActionState('idle')
      setActiveView('session')
    } catch (error) {
      setActionState('error')
      setErrorMessage(error instanceof Error ? error.message : '回答失败')
    }
  }

  async function stopTask(): Promise<void> {
    if (!run || !isActiveStatus(run.run.status) || actionState === 'stopping') return
    setActionState('stopping')
    setErrorMessage(undefined)
    try {
      const snapshot = await window.paracode.stopTask(run.run.id)
      setRun(snapshot)
      setEvents((current) => mergeEvents(snapshot.events, current))
      setActionState('idle')
    } catch (error) {
      setActionState('error')
      setErrorMessage(error instanceof Error ? error.message : '停止任务失败')
    }
  }

  function beginNewTask(): void {
    if (run && isActiveStatus(run.run.status)) {
      setActiveView('session')
      return
    }
    setRun(undefined)
    setEvents([])
    setPlan(undefined)
    setPlanFailures([])
    setRequirement('')
    setErrorMessage(undefined)
    setActionState('idle')
    setActiveView('session')
  }

  async function openRun(runId: string): Promise<void> {
    try {
      const snapshot = await window.paracode.getRun(runId)
      setRun(snapshot)
      setEvents(snapshot.events)
      setInteractions((current) => mergeInteractions(snapshot.interactions, current))
      setRequirement(snapshot.run.requirement)
      setActiveView('session')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '打开任务失败')
    }
  }

  function refreshProviders(nextProviders: ProviderSummary[]): void {
    setProviders(nextProviders)
    const current = nextProviders.find((item) => item.id === selectedProviderId)
    const next = current ?? nextProviders.find((item) => item.isDefault) ?? nextProviders[0]
    setSelectedProviderId(next?.id)
    setSelectedModel((model) => (current ? model : next?.model))
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="ParaCode">
          <span className="brand-mark">P</span>
          <span>ParaCode</span>
        </div>

        <button className="new-session" type="button" onClick={beginNewTask}>
          <span aria-hidden="true">＋</span>
          <span>新任务</span>
        </button>

        <nav className="primary-nav" aria-label="主导航">
          <button
            className={`nav-item ${activeView === 'session' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveView('session')}
          >
            <span aria-hidden="true">◌</span>
            <span>会话</span>
          </button>
          <button
            className={`nav-item ${activeView === 'board' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveView('board')}
          >
            <span aria-hidden="true">▦</span>
            <span>并行看板</span>
          </button>
          <button
            className={`nav-item ${activeView === 'queue' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveView('queue')}
          >
            <span aria-hidden="true">◷</span>
            <span>交互队列</span>
            {queueCount > 0 ? <span className="nav-count">{queueCount}</span> : null}
          </button>
        </nav>

        <div className="sidebar-section project-section">
          <p className="sidebar-label">项目</p>
          {projectState === 'loading' ? (
            <p className="sidebar-empty" role="status">
              正在读取项目…
            </p>
          ) : null}
          {projectState === 'error' ? (
            <div className="sidebar-project-error">
              <p>项目列表读取失败</p>
              <button type="button" onClick={() => void validateProjects()}>
                重试
              </button>
            </div>
          ) : null}
          {projectState !== 'error' && projects.length === 0 ? (
            <p className="sidebar-empty">还没有添加项目</p>
          ) : null}
          <div className="project-list">
            {projects.map((project) => (
              <div className={`project-item ${project.isCurrent ? 'active' : ''}`} key={project.id}>
                <button
                  className="project-select"
                  type="button"
                  onClick={() => void selectProject(project.id)}
                  aria-current={project.isCurrent ? 'true' : undefined}
                >
                  <span className={`project-dot ${project.health}`} aria-hidden="true" />
                  <span className="project-name">{project.name}</span>
                </button>
                {project.health === 'invalid' ? (
                  <button
                    className="project-action"
                    type="button"
                    onClick={() => void validateProject(project.id)}
                    title={project.healthMessage}
                  >
                    重新检查
                  </button>
                ) : null}
                <button
                  className="project-action remove"
                  type="button"
                  onClick={() => void removeProject(project.id)}
                  aria-label={`从列表移除 ${project.name}`}
                  title="从列表移除，不删除文件"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button className="add-project" type="button" onClick={() => void addProject()}>
            添加 Git 项目
          </button>
        </div>

        <div className="sidebar-section session-section">
          <p className="sidebar-label">最近会话</p>
          {run ? (
            <button
              className="session-item active"
              type="button"
              onClick={() => setActiveView('session')}
            >
              <span className={`session-dot ${run.run.status}`} aria-hidden="true" />
              <span className="session-item-text">
                <strong>{shorten(run.run.requirement, 28)}</strong>
                <small>{runStatus}</small>
              </span>
            </button>
          ) : runs.length > 0 ? (
            runs.map((item) => (
              <button
                className="session-item"
                key={item.id}
                type="button"
                onClick={() => void openRun(item.id)}
              >
                <span className={`session-dot ${item.status}`} aria-hidden="true" />
                <span className="session-item-text">
                  <strong>{shorten(item.requirement, 28)}</strong>
                  <small>{STATUS_LABELS[item.status]}</small>
                </span>
              </button>
            ))
          ) : (
            <p className="sidebar-empty">还没有编码会话</p>
          )}
        </div>

        <div className="sidebar-footer">
          <button
            className={`settings-entry ${activeView === 'settings' ? 'active' : ''}`}
            type="button"
            onClick={() => setActiveView('settings')}
          >
            <span aria-hidden="true">⚙</span>
            <span>设置</span>
          </button>
          <div className="sidebar-status">
            <span className={`status-dot ${loadState}`} aria-hidden="true" />
            <span>
              {loadState === 'error'
                ? '桌面服务异常'
                : loadState === 'loading'
                  ? '正在连接本地服务'
                  : appInfo
                    ? `本地服务已连接 · ${appInfo.version}`
                    : '本地服务已连接'}
            </span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="topbar-context">
            <span className="folder-mark" aria-hidden="true">
              □
            </span>
            <span>{projectName}</span>
          </div>
          <div className="view-switch" role="tablist" aria-label="工作区视图">
            <ViewButton
              view="session"
              activeView={activeView}
              onChange={setActiveView}
              label="会话"
            />
            <ViewButton
              view="board"
              activeView={activeView}
              onChange={setActiveView}
              label="看板"
            />
            <ViewButton
              view="queue"
              activeView={activeView}
              onChange={setActiveView}
              label="队列"
              count={queueCount}
            />
          </div>
          <span className="topbar-project-health">{currentProjectHealthLabel}</span>
        </header>

        {activeView === 'session' ? (
          <SessionView
            projectName={projectName}
            repositoryPath={repositoryPath}
            requirement={requirement}
            plan={plan}
            planFailures={planFailures}
            run={run}
            timeline={timeline}
            currentActivity={currentActivity}
            pendingInteraction={pendingInteraction}
            actionState={actionState}
            errorMessage={errorMessage}
            onRequirementChange={setRequirement}
            onSelectProject={() => void addProject()}
            onStartTask={() => void startTask()}
            onConfirmPlan={() => void confirmCurrentPlan()}
            onRetryFailedGroups={() => void confirmCurrentPlan(true)}
            onMoveRequirement={(requirementId, targetGroupId) =>
              void movePlanRequirement(requirementId, targetGroupId)
            }
            onStopTask={() => void stopTask()}
            onAnswerInteraction={(input) => void answerInteraction(input)}
            providers={providers}
            selectedProviderId={selectedProviderId}
            selectedModel={selectedModel}
            onModelChange={(providerId, model) => {
              setSelectedProviderId(providerId)
              setSelectedModel(model)
            }}
            onOpenSettings={() => setActiveView('settings')}
          />
        ) : null}
        {activeView === 'board' ? (
          <BoardView
            runs={runs}
            activeRunId={run?.run.id}
            onOpenSession={(runId) => void openRun(runId)}
          />
        ) : null}
        {activeView === 'queue' ? (
          <QueueView
            interactions={interactions}
            answering={actionState === 'starting'}
            onOpenSession={(runId) => void openRun(runId)}
            onAnswer={(input) => void answerInteraction(input)}
          />
        ) : null}
        {activeView === 'settings' ? (
          <SettingsView
            providers={providers}
            onProvidersChange={refreshProviders}
            onOpenSession={() => setActiveView('session')}
          />
        ) : null}
      </main>
    </div>
  )
}

function SessionView({
  projectName,
  repositoryPath,
  requirement,
  plan,
  planFailures,
  run,
  timeline,
  currentActivity,
  pendingInteraction,
  actionState,
  errorMessage,
  onRequirementChange,
  onSelectProject,
  onStartTask,
  onConfirmPlan,
  onRetryFailedGroups,
  onMoveRequirement,
  onStopTask,
  onAnswerInteraction,
  providers,
  selectedProviderId,
  selectedModel,
  onModelChange,
  onOpenSettings,
}: {
  projectName: string
  repositoryPath?: string
  requirement: string
  plan?: GroupingPlan
  planFailures: ConfirmPlanFailure[]
  run?: RunSnapshot
  timeline: TimelineEntry[]
  currentActivity?: ActivityEntry
  pendingInteraction?: InteractionRequest
  actionState: 'idle' | 'starting' | 'stopping' | 'error'
  errorMessage?: string
  onRequirementChange: (value: string) => void
  onSelectProject: () => void
  onStartTask: () => void
  onConfirmPlan: () => void
  onRetryFailedGroups: () => void
  onMoveRequirement: (requirementId: string, targetGroupId: string) => void
  onStopTask: () => void
  onAnswerInteraction: (input: Omit<AnswerInteractionInput, 'idempotencyKey'>) => void
  providers: ProviderSummary[]
  selectedProviderId?: string
  selectedModel?: string
  onModelChange: (providerId: string, model: string) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const canStart =
    Boolean(repositoryPath && requirement.trim()) &&
    actionState !== 'starting' &&
    actionState !== 'stopping'
  const isRunning = Boolean(run && isActiveStatus(run.run.status))
  const canAnswer = Boolean(pendingInteraction) && actionState === 'idle'
  const [reply, setReply] = useState('')

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (!run && canStart) {
      onStartTask()
      return
    }
    if (
      pendingInteraction &&
      canAnswer &&
      (reply.trim() || pendingInteraction.options.length > 0)
    ) {
      submitAnswer()
    }
  }

  function submitAnswer(optionId?: string, decision?: AnswerInteractionInput['decision']): void {
    if (!pendingInteraction || !canAnswer) return
    onAnswerInteraction({
      requestId: pendingInteraction.id,
      text: reply.trim() || undefined,
      optionId,
      decision,
    })
    setReply('')
  }

  return (
    <section className="session-layout" aria-label="编码会话">
      <div className="session-scroll">
        {run ? (
          <div className="session-header">
            <div>
              <p className="eyebrow">当前编码任务</p>
              <h1>{run.run.requirement}</h1>
              <div className="session-meta">
                <span className={`status-badge ${run.run.status}`}>
                  {STATUS_LABELS[run.run.status]}
                </span>
                <span>{projectName}</span>
                <code>{run.run.branchName || '正在创建分支…'}</code>
              </div>
            </div>
            <details className="context-details">
              <summary>执行环境</summary>
              <div className="context-popover">
                <span>worktree</span>
                <code>{run.run.worktreePath || '正在创建…'}</code>
              </div>
            </details>
          </div>
        ) : plan ? (
          <PlanPreview
            plan={plan}
            failures={planFailures}
            busy={actionState === 'starting'}
            onConfirm={onConfirmPlan}
            onRetry={onRetryFailedGroups}
            onMove={onMoveRequirement}
          />
        ) : (
          <div className="empty-session">
            <div className="empty-mark" aria-hidden="true">
              P
            </div>
            <p className="eyebrow">PARALLEL CODING WORKSPACE</p>
            <h1>从一个或一组编码任务开始</h1>
            <p>
              选择一个 Git
              项目。一条需求会直接启动；多条需求（空行或编号列表）会先生成可编辑分组，确认后再并行创建
              worktree。
            </p>
          </div>
        )}

        {run ? (
          <div className="timeline" aria-live="polite">
            <div className="message user-message">
              <div className="message-label">你</div>
              <div className="user-bubble">{run.run.requirement}</div>
            </div>
            {timeline.length === 0 ? <ExecutionState run={run} /> : null}
            {timeline.length > 0 && isActiveStatus(run.run.status) ? (
              <ExecutionState run={run} currentActivity={currentActivity} compact />
            ) : null}
            {timeline.map((entry) => (
              <TimelineItem entry={entry} key={entry.id} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="composer-area">
        <div className="composer">
          <textarea
            id="requirement"
            value={pendingInteraction ? reply : requirement}
            onChange={(event) =>
              pendingInteraction
                ? setReply(event.target.value)
                : onRequirementChange(event.target.value)
            }
            onKeyDown={handleKeyDown}
            placeholder={
              pendingInteraction
                ? pendingInteraction.type === 'approval'
                  ? pendingInteraction.message
                  : '回答 Agent 的问题，或选择下方选项'
                : run
                  ? 'Agent 执行中，阻塞问题会出现在这里'
                  : '描述编码任务。多条需求可用空行或 1. / - 列表分开'
            }
            rows={run && !pendingInteraction ? 1 : 3}
            disabled={Boolean(run) && !pendingInteraction}
            aria-label={pendingInteraction ? '回答 Agent' : run ? '当前会话输入' : '编码需求'}
          />
          {pendingInteraction?.options.length ? (
            <div className="answer-options" role="group" aria-label="可选回答">
              {pendingInteraction.options.map((option) => (
                <button
                  className="secondary-button"
                  type="button"
                  key={option.id}
                  disabled={!canAnswer}
                  onClick={() => submitAnswer(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
          {pendingInteraction?.type === 'approval' ? (
            <div className="answer-options" role="group" aria-label="审批决定">
              <button
                className="send-button"
                type="button"
                disabled={!canAnswer}
                onClick={() => submitAnswer(undefined, 'allow')}
              >
                允许执行
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!canAnswer}
                onClick={() => submitAnswer(undefined, 'deny')}
              >
                拒绝
              </button>
            </div>
          ) : null}
          <div className="composer-controls">
            <div className="composer-context">
              <button className="composer-chip" type="button" onClick={onSelectProject}>
                <span aria-hidden="true">□</span>
                {repositoryPath ? projectName : '添加 Git 项目'}
              </button>
              <ModelPicker
                providers={providers}
                selectedProviderId={selectedProviderId}
                selectedModel={selectedModel}
                onChange={onModelChange}
                onOpenSettings={onOpenSettings}
              />
              <span className="composer-chip readonly">工作区写入</span>
            </div>
            {isRunning ? (
              <div className="composer-actions">
                {pendingInteraction && pendingInteraction.type === 'question' ? (
                  <button
                    className="send-button"
                    type="button"
                    disabled={
                      !canAnswer || (!reply.trim() && pendingInteraction.options.length === 0)
                    }
                    onClick={() => submitAnswer()}
                    aria-label="回答并继续"
                  >
                    {actionState === 'starting' ? '提交中…' : '回答并继续'}
                    <span aria-hidden="true">↑</span>
                  </button>
                ) : null}
                <button
                  className="stop-button"
                  type="button"
                  disabled={actionState === 'stopping'}
                  onClick={onStopTask}
                  aria-label="停止当前任务"
                >
                  <span className="stop-icon" aria-hidden="true" />
                  {actionState === 'stopping' ? '停止中…' : '停止任务'}
                </button>
              </div>
            ) : (
              <button
                className="send-button"
                type="button"
                disabled={!canStart || Boolean(run)}
                onClick={onStartTask}
                aria-label="启动编码任务"
              >
                {actionState === 'starting' ? '创建中…' : plan && !run ? '重新分析' : '开始执行'}
                <span aria-hidden="true">↑</span>
              </button>
            )}
          </div>
        </div>
        <div className="composer-hint">
          {pendingInteraction
            ? '回答后 Agent 会在当前 session 继续，不会新建任务。'
            : run
              ? '任务运行中。Agent 提问或请求授权时，可在此回答。'
              : plan
                ? '核对分组后确认创建。调整分组会增加版本，旧确认无效。'
                : 'Enter 开始执行 · Shift + Enter 换行 · 多条需求用空行或编号列表'}
          {isRunning ? (
            <span className="live-hint">
              <span className="live-dot" />
              实时更新
            </span>
          ) : null}
        </div>
        {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
      </div>
    </section>
  )
}

function PlanPreview({
  plan,
  failures,
  busy,
  onConfirm,
  onRetry,
  onMove,
}: {
  plan: GroupingPlan
  failures: ConfirmPlanFailure[]
  busy: boolean
  onConfirm: () => void
  onRetry: () => void
  onMove: (requirementId: string, targetGroupId: string) => void
}): React.JSX.Element {
  const confirmed = plan.status === 'confirmed' || plan.status === 'failed'
  return (
    <div className="plan-preview" aria-label="分组方案">
      <div className="session-header">
        <div>
          <p className="eyebrow">分组方案 · 版本 {plan.version}</p>
          <h1>确认后再创建 worktree</h1>
          <p>每个分组会在独立 worktree 中启动一个 Agent。创建前可以移动需求或拆出新分组。</p>
        </div>
      </div>
      <div className="plan-grid">
        {plan.groups.map((group) => {
          const failure = failures.find((item) => item.groupId === group.id)
          return (
            <article className="plan-card" key={group.id}>
              <div className="plan-card-head">
                <strong>{group.name}</strong>
                {failure ? <span className="status-badge failed">创建失败</span> : null}
              </div>
              {group.requirementIds.map((requirementId) => {
                const requirement = plan.requirements.find((item) => item.id === requirementId)
                if (!requirement) return null
                return (
                  <div className="plan-requirement" key={requirement.id}>
                    <p>{requirement.sourceText}</p>
                    {confirmed ? null : (
                      <label>
                        移动到
                        <select
                          aria-label={`移动需求：${requirement.sourceText}`}
                          disabled={busy}
                          value={group.id}
                          onChange={(event) => onMove(requirement.id, event.target.value)}
                        >
                          {plan.groups.map((option) => (
                            <option value={option.id} key={option.id}>
                              {option.name}
                            </option>
                          ))}
                          <option value="new">新分组</option>
                        </select>
                      </label>
                    )}
                  </div>
                )
              })}
              {failure ? <p className="error-message">{failure.message}</p> : null}
            </article>
          )
        })}
      </div>
      <div className="plan-actions">
        {confirmed && failures.length > 0 ? (
          <button className="send-button" type="button" disabled={busy} onClick={onRetry}>
            {busy ? '重试中…' : `重试 ${failures.length} 个失败分组`}
          </button>
        ) : null}
        {confirmed ? null : (
          <button
            className="send-button"
            type="button"
            disabled={busy}
            onClick={onConfirm}
            aria-label={`确认创建 ${plan.groups.length} 个隔离 worktree`}
          >
            {busy ? '创建中…' : `确认创建 ${plan.groups.length} 个隔离 worktree`}
          </button>
        )}
      </div>
    </div>
  )
}

function BoardView({
  runs,
  activeRunId,
  onOpenSession,
}: {
  runs: WorktreeRun[]
  activeRunId?: string
  onOpenSession: (runId: string) => void
}): React.JSX.Element {
  return (
    <section className="secondary-view" aria-label="并行看板">
      <div className="secondary-view-header">
        <div>
          <p className="eyebrow">工作区概览</p>
          <h1>并行看板</h1>
          <p>确认分组后，每个分组对应一个隔离 worktree，状态会实时显示在这里。</p>
        </div>
        <span className="view-summary">
          {runs.length > 0 ? `${runs.length} 个 worktree` : '暂无 worktree'}
        </span>
      </div>
      {runs.length > 0 ? (
        <div className="worktree-grid">
          {runs.map((item) => (
            <article className="worktree-card" key={item.id}>
              <div className="worktree-card-head">
                <span className={`session-dot ${item.status}`} aria-hidden="true" />
                <strong>{item.branchName || '未命名分支'}</strong>
                <span className={`status-badge ${item.status}`}>{STATUS_LABELS[item.status]}</span>
              </div>
              <p>{item.requirement}</p>
              <div className="worktree-stats">
                <span>{formatTime(item.createdAt)}</span>
                <span>{projectLabel(item.repositoryPath)}</span>
                <span>{item.latestMessage ?? '等待 Agent 更新'}</span>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onOpenSession(item.id)}
              >
                {activeRunId === item.id ? '查看当前会话' : '打开会话'}
              </button>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="还没有并行任务"
          body="启动一个编码任务后，worktree 的实时状态会显示在这里。"
        />
      )}
    </section>
  )
}

function QueueView({
  interactions,
  answering,
  onOpenSession,
  onAnswer,
}: {
  interactions: InteractionRequest[]
  answering: boolean
  onOpenSession: (runId: string) => void
  onAnswer: (input: Omit<AnswerInteractionInput, 'idempotencyKey'>) => void
}): React.JSX.Element {
  const queued = interactions.filter((item) => item.status === 'queued')
  return (
    <section className="secondary-view" aria-label="交互队列">
      <div className="secondary-view-header">
        <div>
          <p className="eyebrow">需要你的决定</p>
          <h1>交互队列</h1>
          <p>Agent 需要提问或请求授权时，会集中显示在这里。回答后原 session 继续执行。</p>
        </div>
        <span className="view-summary">{queued.length} 个待处理</span>
      </div>
      {queued.length > 0 ? (
        <div className="queue-list">
          {queued.map((item) => (
            <article className="queue-item" key={item.id}>
              <div className="queue-item-head">
                <span className={`queue-tag ${item.type === 'approval' ? 'approval' : ''}`}>
                  {item.type === 'approval' ? '授权' : '提问'}
                </span>
                <time>{formatTime(item.createdAt)}</time>
              </div>
              <h2>{item.title}</h2>
              <p>{item.message}</p>
              <div className="queue-actions">
                {item.type === 'approval' ? (
                  <>
                    <button
                      className="send-button"
                      type="button"
                      disabled={answering}
                      onClick={() => onAnswer({ requestId: item.id, decision: 'allow' })}
                    >
                      允许执行
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={answering}
                      onClick={() => onAnswer({ requestId: item.id, decision: 'deny' })}
                    >
                      拒绝
                    </button>
                  </>
                ) : null}
                {item.options.map((option) => (
                  <button
                    className="secondary-button"
                    type="button"
                    key={option.id}
                    disabled={answering}
                    onClick={() => onAnswer({ requestId: item.id, optionId: option.id })}
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onOpenSession(item.runId)}
                >
                  打开会话
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="暂无待处理请求"
          body="当前任务继续执行时，提问和授权请求会出现在这里。"
        />
      )}
    </section>
  )
}

function TimelineItem({ entry }: { entry: TimelineEntry }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)

  if (entry.kind === 'message') {
    return (
      <div className="message agent-message">
        <div className="message-label">
          <span className="agent-mark">P</span>ParaCode
        </div>
        <div className="agent-body">{entry.body}</div>
        <time>{formatTime(entry.timestamp)}</time>
      </div>
    )
  }

  const isCollapsible =
    entry.kind === 'activityGroup' || entry.kind === 'reasoning' || entry.kind === 'plan'
  const summaryDetail = entry.detail ?? (entry.body ? shorten(entry.body, 80) : undefined)
  const activityItems = entry.items ?? []
  const activityRunning = activityItems.some((item) => item.status === 'running')
  const activityTitle =
    entry.kind === 'activityGroup'
      ? activityRunning
        ? `正在执行 ${activityItems.length} 个活动`
        : `已执行 ${activityItems.length} 个活动`
      : entry.title

  return (
    <div className={`timeline-item ${entry.kind} ${entry.status ?? ''}`}>
      <div className="timeline-icon" aria-hidden="true">
        {entry.kind === 'test'
          ? '✓'
          : entry.kind === 'attention'
            ? '!'
            : entry.kind === 'activityGroup'
              ? activityRunning
                ? '◌'
                : '›'
              : entry.kind === 'reasoning'
                ? '✦'
                : '·'}
      </div>
      <div className="timeline-content">
        {isCollapsible ? (
          <button
            className="timeline-toggle"
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            <span className="timeline-title">
              <strong>{activityTitle}</strong>
              {summaryDetail ? (
                <code className="timeline-summary-detail">{summaryDetail}</code>
              ) : null}
              <time>{formatTime(entry.timestamp)}</time>
            </span>
            <span className="timeline-chevron" aria-hidden="true">
              {expanded ? '⌃' : '⌄'}
            </span>
          </button>
        ) : (
          <div className="timeline-title">
            <strong>{entry.title}</strong>
            <time>{formatTime(entry.timestamp)}</time>
          </div>
        )}
        {entry.kind === 'activityGroup' && expanded ? (
          <div className="activity-list">
            {activityItems.map((item) => (
              <div className={`activity-row ${item.status ?? ''}`} key={item.id}>
                <span className="activity-row-icon" aria-hidden="true">
                  {item.status === 'running' ? '◌' : item.status === 'failed' ? '!' : '✓'}
                </span>
                <div>
                  <strong>{item.title}</strong>
                  {item.detail ? <code>{item.detail}</code> : null}
                  {item.body ? <p>{item.body}</p> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {entry.kind !== 'activityGroup' && (!isCollapsible || expanded) && entry.body ? (
          <p>{entry.body}</p>
        ) : null}
        {entry.kind === 'plan' && expanded && entry.plan?.length ? (
          <ol className="plan-list">
            {entry.plan.map((step) => (
              <li className={step.status} key={step.step}>
                <span aria-hidden="true">
                  {step.status === 'completed' ? '✓' : step.status === 'inProgress' ? '◌' : '·'}
                </span>
                {step.step}
              </li>
            ))}
          </ol>
        ) : null}
        {(!isCollapsible || expanded) && entry.detail ? (
          <code className="timeline-detail">{entry.detail}</code>
        ) : null}
      </div>
    </div>
  )
}

function ExecutionState({
  run,
  currentActivity,
  compact = false,
}: {
  run: RunSnapshot
  currentActivity?: ActivityEntry
  compact?: boolean
}): React.JSX.Element {
  const label = currentActivity?.title ?? STATUS_LABELS[run.run.status]
  const detail = currentActivity?.detail ?? run.run.latestMessage ?? 'Agent 正在准备执行环境。'
  return (
    <div className={`execution-state ${compact ? 'compact' : ''}`} role="status" aria-live="polite">
      <span className="execution-spinner" aria-hidden="true" />
      <strong>{label}</strong>
      <span>{detail}</span>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="empty-state">
      <div className="empty-state-mark" aria-hidden="true">
        ·
      </div>
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  )
}

function ModelPicker({
  providers,
  selectedProviderId,
  selectedModel,
  onChange,
  onOpenSettings,
}: {
  providers: ProviderSummary[]
  selectedProviderId?: string
  selectedModel?: string
  onChange: (providerId: string, model: string) => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const selectedProvider = providers.find((provider) => provider.id === selectedProviderId)
  const modelEntries = providers.flatMap((provider) =>
    provider.models.map((model) => ({
      providerId: provider.id,
      providerName: provider.name,
      model,
    })),
  )
  const activeIndex = modelEntries.findIndex(
    (entry) => entry.providerId === selectedProviderId && entry.model === selectedModel,
  )

  function moveSelection(offset: number): void {
    if (modelEntries.length === 0) return
    const nextIndex =
      activeIndex === -1 ? 0 : Math.min(modelEntries.length - 1, Math.max(0, activeIndex + offset))
    const next = modelEntries[nextIndex]
    onChange(next.providerId, next.model)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveSelection(1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveSelection(-1)
    } else if (event.key === 'Enter' || event.key === 'Escape') {
      event.preventDefault()
      setOpen(false)
    }
  }

  if (!providers.length) {
    return (
      <button className="composer-chip" type="button" onClick={onOpenSettings}>
        <span aria-hidden="true">◇</span>
        添加 Provider
      </button>
    )
  }

  return (
    <div className="model-picker">
      <button
        className="composer-chip"
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleKeyDown}
      >
        <span aria-hidden="true">◇</span>
        {selectedProvider
          ? `${selectedProvider.name} · ${selectedModel ?? selectedProvider.model}`
          : '选择模型'}
      </button>
      {open ? (
        <div className="model-popover" role="dialog" aria-label="选择模型">
          <div className="model-popover-head">
            <strong>选择模型</strong>
            <button type="button" onClick={onOpenSettings}>
              管理 Provider
            </button>
          </div>
          {selectedProvider?.connectionStatus === 'failed' ? (
            <p className="model-warning">当前 Provider 上次连接失败，请到设置中重新测试。</p>
          ) : null}
          {providers.map((provider) => (
            <section key={provider.id}>
              <p className="model-group-label">{provider.name}</p>
              <div className="model-options">
                {provider.models.map((model) => {
                  const selected = provider.id === selectedProviderId && model === selectedModel
                  return (
                    <button
                      className={`model-option ${selected ? 'selected' : ''}`}
                      type="button"
                      key={`${provider.id}:${model}`}
                      onClick={() => {
                        onChange(provider.id, model)
                        setOpen(false)
                      }}
                    >
                      <span>{model}</span>
                      {selected ? <span aria-hidden="true">✓</span> : null}
                    </button>
                  )
                })}
              </div>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function SettingsView({
  providers,
  onProvidersChange,
  onOpenSession,
}: {
  providers: ProviderSummary[]
  onProvidersChange: (providers: ProviderSummary[]) => void
  onOpenSession: () => void
}): React.JSX.Element {
  const [editingId, setEditingId] = useState<string>()
  const [name, setName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [formState, setFormState] = useState<'idle' | 'saving' | 'testing' | 'loadingModels'>(
    'idle',
  )
  const [notice, setNotice] = useState<string>()
  const [error, setError] = useState<string>()

  const editing = providers.find((provider) => provider.id === editingId)

  function fillForm(provider?: ProviderSummary): void {
    setEditingId(provider?.id)
    setName(provider?.name ?? '')
    setBaseURL(provider?.baseURL ?? '')
    setApiKey('')
    setModel(provider?.model ?? '')
    setNotice(undefined)
    setError(undefined)
  }

  async function submit(): Promise<void> {
    if (formState !== 'idle') return
    setFormState('saving')
    setError(undefined)
    setNotice(undefined)
    const input: ProviderConfigInput = { name, baseURL, apiKey: apiKey || undefined, model }
    try {
      const nextProviders = editingId
        ? await window.paracode.updateProvider(editingId, input)
        : await window.paracode.createProvider(input)
      onProvidersChange(nextProviders)
      const saved = editingId
        ? nextProviders.find((provider) => provider.id === editingId)
        : nextProviders.at(-1)
      fillForm(saved)
      setNotice('Provider 已保存。')
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '保存 Provider 失败。')
    } finally {
      setFormState('idle')
    }
  }

  async function test(): Promise<void> {
    if (!editingId || formState !== 'idle') return
    setFormState('testing')
    setError(undefined)
    setNotice(undefined)
    try {
      const result: ProviderTestResult = await window.paracode.testProvider(editingId)
      onProvidersChange(await window.paracode.listProviders())
      setNotice(result.message)
      if (!result.ok) setError(result.message)
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : '测试连接失败。')
    } finally {
      setFormState('idle')
    }
  }

  async function loadModels(): Promise<void> {
    if (!editingId || formState !== 'idle') return
    setFormState('loadingModels')
    setError(undefined)
    setNotice(undefined)
    try {
      const models = await window.paracode.listProviderModels(editingId)
      const nextProviders = await window.paracode.listProviders()
      onProvidersChange(nextProviders)
      const saved = nextProviders.find((provider) => provider.id === editingId)
      fillForm(saved)
      setModel(models[0] ?? saved?.model ?? model)
      setNotice(`已获取 ${models.length} 个模型。`)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '获取模型列表失败。')
    } finally {
      setFormState('idle')
    }
  }

  async function setDefault(id: string): Promise<void> {
    try {
      onProvidersChange(await window.paracode.setDefaultProvider(id))
      setNotice('默认 Provider 已更新。')
    } catch (defaultError) {
      setError(defaultError instanceof Error ? defaultError.message : '设置默认 Provider 失败。')
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      onProvidersChange(await window.paracode.deleteProvider(id))
      if (editingId === id) fillForm(undefined)
      setNotice('Provider 已删除。')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除 Provider 失败。')
    }
  }

  return (
    <section className="settings-layout" aria-label="设置">
      <aside className="settings-nav" aria-label="设置导航">
        <p className="settings-nav-label">设置</p>
        <button className="settings-nav-item active" type="button">
          AI提供商
        </button>
      </aside>
      <div className="settings-scroll">
        <header className="session-header">
          <div>
            <p className="eyebrow">SETTINGS</p>
            <h1>模型服务配置</h1>
            <p className="settings-description">
              配置 OpenAI 协议兼容服务。API Key 只保存在主进程，界面仅显示脱敏信息。
            </p>
          </div>
          <button className="secondary-button" type="button" onClick={onOpenSession}>
            返回会话
          </button>
        </header>

        {notice ? <p className="settings-notice">{notice}</p> : null}
        {error ? <p className="error-message">{error}</p> : null}

        <div className="provider-grid">
          <form
            className="provider-form"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            <h2>Provider 信息</h2>
            <p>
              {editing
                ? '编辑时 API Key 留空，表示继续使用已保存的 Key。'
                : '添加一个新的 OpenAI Compatible 服务。'}
            </p>
            <label>
              名称
              <input value={name} onChange={(event) => setName(event.target.value)} required />
            </label>
            <label>
              协议
              <select disabled>
                <option>OpenAI Compatible</option>
              </select>
            </label>
            <label>
              Base URL
              <input
                value={baseURL}
                onChange={(event) => setBaseURL(event.target.value)}
                required
                placeholder="https://api.example.com/v1"
              />
            </label>
            <label>
              API Key
              <input
                type="password"
                autoComplete="new-password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={editing ? '留空表示不修改' : 'sk-...'}
              />
            </label>
            <label>
              默认模型
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                required
                placeholder="选择或输入模型 ID"
              />
            </label>
            <div className="provider-actions">
              <button className="send-button" type="submit" disabled={formState !== 'idle'}>
                {formState === 'saving' ? '保存中…' : '保存'}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!editingId || formState !== 'idle'}
                onClick={() => void test()}
              >
                {formState === 'testing' ? '测试中…' : '测试连接'}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={!editingId || formState !== 'idle'}
                onClick={() => void loadModels()}
              >
                {formState === 'loadingModels' ? '获取中…' : '刷新模型'}
              </button>
            </div>
          </form>

          <section className="provider-list-panel">
            <h2>已配置服务</h2>
            <p>选择一个服务作为新任务的默认模型来源。</p>
            {providers.length === 0 ? (
              <p className="provider-empty">还没有配置 Provider。</p>
            ) : (
              <div className="provider-list">
                {providers.map((provider) => (
                  <article
                    className={`provider-card ${provider.id === editingId ? 'active' : ''}`}
                    key={provider.id}
                  >
                    <div>
                      <strong>{provider.name}</strong>
                      <small>
                        {provider.model} · {provider.apiKeyMasked}
                      </small>
                      <div className="provider-badges">
                        {provider.isDefault ? <span className="provider-badge">默认</span> : null}
                        <span className={`provider-badge ${provider.connectionStatus}`}>
                          {provider.connectionStatus === 'ok'
                            ? '已连接'
                            : provider.connectionStatus === 'failed'
                              ? '连接失败'
                              : '未验证'}
                        </span>
                      </div>
                    </div>
                    <div className="provider-card-actions">
                      {provider.isDefault ? null : (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => void setDefault(provider.id)}
                        >
                          设默认
                        </button>
                      )}
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => fillForm(provider)}
                      >
                        编辑
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => void remove(provider.id)}
                      >
                        删除
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </section>
  )
}

function ViewButton({
  view,
  activeView,
  onChange,
  label,
  count = 0,
}: {
  view: View
  activeView: View
  onChange: (view: View) => void
  label: string
  count?: number
}): React.JSX.Element {
  return (
    <button
      className={`view-button ${activeView === view ? 'active' : ''}`}
      type="button"
      role="tab"
      aria-selected={activeView === view}
      onClick={() => onChange(view)}
    >
      {label}
      {count > 0 ? <span className="view-count">{count}</span> : null}
    </button>
  )
}

function buildTimeline(events: AgentEvent[]): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  const activityById = new Map<string, ActivityEntry>()

  function ensureActivityGroup(event: AgentEvent): TimelineEntry {
    const previous = entries[entries.length - 1]
    if (previous?.kind === 'activityGroup') return previous
    const group: TimelineEntry = {
      id: event.id,
      kind: 'activityGroup',
      title: '活动',
      timestamp: event.timestamp,
      items: [],
      status: 'running',
    }
    entries.push(group)
    return group
  }

  function appendActivity(event: AgentEvent, mode: 'started' | 'output' | 'completed'): void {
    const payload = event.payload
    const itemId =
      payloadString(payload, 'itemId') ??
      `${payloadString(payload, 'command') ?? 'activity'}-${event.id}`
    let item = activityById.get(itemId)
    if (!item) {
      const group = ensureActivityGroup(event)
      item = {
        id: itemId,
        title: activityTitle(payload),
        detail: payloadString(payload, 'command') ?? payloadString(payload, 'toolName'),
        timestamp: event.timestamp,
        status: mode === 'completed' ? activityStatus(payload) : 'running',
      }
      group.items?.push(item)
      activityById.set(itemId, item)
    }
    item.timestamp = event.timestamp
    if (mode === 'started') item.status = 'running'
    if (mode === 'completed') item.status = activityStatus(payload)
    const output = payloadString(payload, 'output')
    if (output)
      item.body = item.body
        ? `${item.body}${item.body.endsWith('\n') ? '' : '\n'}${output}`
        : output
    const files = payloadStringArray(payload, 'files')
    if (files.length > 0) item.body = `涉及 ${files.length} 个文件：${files.join('、')}`
  }

  function appendMessage(event: AgentEvent, message?: string): void {
    if (!message) return
    const previous = entries[entries.length - 1]
    if (previous?.kind === 'message') {
      previous.body = `${previous.body ?? ''}${message}`
      previous.timestamp = event.timestamp
      return
    }
    entries.push({
      id: event.id,
      kind: 'message',
      title: 'ParaCode',
      body: message,
      timestamp: event.timestamp,
    })
  }

  for (const event of events) {
    const payload = event.payload
    if (event.type === 'run_status_changed') {
      const status = payloadString(payload, 'status')
      if (status === 'creating' || status === 'bootstrapping') {
        entries.push({
          id: event.id,
          kind: 'system',
          title: STATUS_LABELS[status],
          body: payloadString(payload, 'message'),
          timestamp: event.timestamp,
          status: 'running',
        })
      }
      continue
    }
    if (event.type === 'reasoning') {
      const message =
        payloadString(payload, 'message') ??
        payloadString(payload, 'summary') ??
        payloadString(payload, 'delta')
      const previous = entries[entries.length - 1]
      if (previous?.kind === 'reasoning') {
        previous.body = `${previous.body ?? ''}${previous.body ? '\n' : ''}${message ?? ''}`
        previous.timestamp = event.timestamp
      } else {
        entries.push({
          id: event.id,
          kind: 'reasoning',
          title: '分析摘要',
          body: message,
          timestamp: event.timestamp,
          status: 'running',
        })
      }
      continue
    }
    if (event.type === 'plan_updated') {
      const previous = entries[entries.length - 1]
      const plan = Array.isArray(payload.plan) ? payload.plan.filter(isPlanStep) : undefined
      if (previous?.kind === 'plan') {
        previous.body =
          payloadString(payload, 'message') ??
          payloadString(payload, 'explanation') ??
          payloadString(payload, 'delta') ??
          previous.body
        previous.plan = plan ?? previous.plan
        previous.timestamp = event.timestamp
        previous.status = 'completed'
      } else {
        entries.push({
          id: event.id,
          kind: 'plan',
          title: '执行计划',
          body:
            payloadString(payload, 'message') ??
            payloadString(payload, 'explanation') ??
            payloadString(payload, 'delta'),
          plan,
          timestamp: event.timestamp,
          status: 'completed',
        })
      }
      continue
    }
    if (event.type === 'assistant_message') {
      appendMessage(event, payloadString(payload, 'message') ?? payloadString(payload, 'delta'))
      continue
    }
    if (event.type === 'activity_started') {
      appendActivity(event, 'started')
      continue
    }
    if (event.type === 'activity_output') {
      appendActivity(event, 'output')
      continue
    }
    if (event.type === 'activity_completed') {
      appendActivity(event, 'completed')
      continue
    }
    if (event.type === 'progress') {
      const stream = payload.stream
      if (stream === 'agent') {
        appendMessage(event, payloadString(payload, 'message') ?? payloadString(payload, 'delta'))
        continue
      }
      if (stream === 'tool') {
        appendActivity(event, 'output')
        continue
      }
      if (stream === 'plan') {
        entries.push({
          id: event.id,
          kind: 'plan',
          title: '执行计划',
          body: payloadString(payload, 'message'),
          timestamp: event.timestamp,
        })
        continue
      }
      if (stream === 'diff') {
        appendActivity(event, 'output')
        continue
      }
      if (stream === 'stderr') {
        entries.push({
          id: event.id,
          kind: 'attention',
          title: '运行日志',
          body: payloadString(payload, 'message'),
          timestamp: event.timestamp,
          status: 'failed',
        })
        continue
      }
      if (payloadString(payload, 'message')) {
        entries.push({
          id: event.id,
          kind: 'system',
          title: 'Agent 活动',
          body: payloadString(payload, 'message'),
          timestamp: event.timestamp,
        })
      }
      continue
    }

    if (event.type === 'session_started') {
      entries.push({
        id: event.id,
        kind: 'system',
        title: 'Agent 已启动',
        body: '独立 worktree 已准备，Agent 开始处理需求。',
        timestamp: event.timestamp,
      })
      continue
    }
    if (event.type === 'phase_changed') {
      const phase = payloadString(payload, 'phase') ?? ''
      entries.push({
        id: event.id,
        kind: 'system',
        title: PHASE_LABELS[phase] ?? '任务阶段更新',
        timestamp: event.timestamp,
      })
      continue
    }
    if (event.type === 'tool_started') {
      appendActivity(event, 'started')
      continue
    }
    if (event.type === 'tool_finished') {
      appendActivity(event, 'completed')
      continue
    }
    if (event.type === 'test_result') {
      const passed = payloadString(payload, 'status') === 'passed'
      entries.push({
        id: event.id,
        kind: 'test',
        title: passed ? '测试通过' : '测试未通过',
        body: payloadString(payload, 'output'),
        detail: payloadString(payload, 'command'),
        timestamp: event.timestamp,
        status: passed ? 'completed' : 'failed',
      })
      continue
    }
    if (event.type === 'interaction_answered') {
      entries.push({
        id: event.id,
        kind: 'system',
        title: '已回答，Agent 继续执行',
        body: payloadSummary(payload),
        timestamp: event.timestamp,
        status: 'completed',
      })
      continue
    }
    if (event.type === 'approval_request' || event.type === 'question') {
      entries.push({
        id: event.id,
        kind: 'attention',
        title: event.type === 'approval_request' ? '等待授权' : '等待你的回答',
        body: payloadSummary(payload),
        detail: payloadString(payload, 'command'),
        timestamp: event.timestamp,
        status: 'waiting',
      })
      continue
    }
    if (event.type === 'session_completed') {
      entries.push({
        id: event.id,
        kind: 'system',
        title: '任务已完成，等待你查看变更',
        body: 'Agent 已结束执行，worktree 中的修改可以继续检查。',
        timestamp: event.timestamp,
        status: 'completed',
      })
      continue
    }
    if (event.type === 'session_failed') {
      entries.push({
        id: event.id,
        kind: 'attention',
        title: '任务执行失败',
        body: payloadSummary(payload),
        timestamp: event.timestamp,
        status: 'failed',
      })
      continue
    }
    if (event.type === 'session_canceled') {
      entries.push({
        id: event.id,
        kind: 'system',
        title: '任务已停止',
        body: payloadSummary(payload),
        timestamp: event.timestamp,
        status: 'completed',
      })
      continue
    }
    if (event.type === 'session_paused') {
      entries.push({
        id: event.id,
        kind: 'attention',
        title: '任务已暂停',
        body: 'Agent 等待后续操作。',
        timestamp: event.timestamp,
        status: 'waiting',
      })
    }
  }
  return entries
}

function activityTitle(payload: AgentEventPayload): string {
  const kind = payloadString(payload, 'activityKind') ?? payloadString(payload, 'itemType')
  if (kind === 'command' || kind === 'commandExecution') return '运行命令'
  if (kind === 'fileChange') return '编辑文件'
  if (kind === 'mcpToolCall') return `调用 ${payloadString(payload, 'toolName') ?? 'MCP 工具'}`
  if (kind === 'collabAgent') return '协作 Agent'
  return '调用工具'
}

function activityStatus(payload: AgentEventPayload): ActivityEntry['status'] {
  return payloadString(payload, 'status') === 'failed' ? 'failed' : 'completed'
}

function isPlanStep(value: unknown): value is PlanStep {
  if (!value || typeof value !== 'object') return false
  const step = value as Record<string, unknown>
  return (
    typeof step.step === 'string' &&
    (step.status === 'pending' || step.status === 'inProgress' || step.status === 'completed')
  )
}

function statusForEvent(
  type: AgentEvent['type'],
  payload: AgentEventPayload = {},
): RunStatus | undefined {
  const mapping: Partial<Record<AgentEvent['type'], RunStatus>> = {
    session_started: 'planning',
    approval_request: 'waiting_human',
    question: 'waiting_human',
    test_result: 'testing',
    session_completed: 'ready_for_review',
    session_failed: 'failed',
    session_canceled: 'canceled',
    session_paused: 'waiting_human',
  }
  if (type === 'run_status_changed') {
    const status = payloadString(payload, 'status')
    if (
      status === 'creating' ||
      status === 'bootstrapping' ||
      status === 'planning' ||
      status === 'coding' ||
      status === 'waiting_human' ||
      status === 'testing' ||
      status === 'ready_for_review' ||
      status === 'completed' ||
      status === 'failed' ||
      status === 'canceled'
    ) {
      return status
    }
  }
  if (type === 'phase_changed') {
    const phase = payloadString(payload, 'phase')
    if (phase === 'planning' || phase === 'coding' || phase === 'testing') return phase
  }
  return mapping[type]
}

function isActiveStatus(status: RunStatus): boolean {
  return ['creating', 'bootstrapping', 'planning', 'coding', 'testing', 'waiting_human'].includes(
    status,
  )
}

function mergeEvents(...eventLists: AgentEvent[][]): AgentEvent[] {
  const byId = new Map<string, AgentEvent>()
  eventLists.flat().forEach((event) => byId.set(event.id, event))
  return [...byId.values()].sort((a, b) => a.sequence - b.sequence)
}

function mergeInteractions(
  incoming: InteractionRequest[],
  current: InteractionRequest[],
): InteractionRequest[] {
  const byId = new Map(current.map((item) => [item.id, item]))
  for (const item of incoming) byId.set(item.id, item)
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

function payloadString(payload: AgentEventPayload, key: string): string | undefined {
  const value = payload[key]
  return typeof value === 'string' ? value : undefined
}

function payloadStringArray(payload: AgentEventPayload, key: string): string[] {
  const value = payload[key]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

function payloadSummary(payload: AgentEventPayload): string {
  return (
    payloadString(payload, 'message') ??
    payloadString(payload, 'reason') ??
    payloadString(payload, 'command') ??
    'Agent 需要你处理一个请求。'
  )
}

function projectLabel(repositoryPath?: string): string {
  if (!repositoryPath) return '未选择项目'
  const normalized = repositoryPath.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() ?? repositoryPath
}

function shorten(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default App
