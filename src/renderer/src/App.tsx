import { useEffect, useMemo, useState, type KeyboardEvent } from 'react'

import type {
  AgentEvent,
  AgentEventPayload,
  AppInfo,
  RunSnapshot,
  RunStatus,
} from '../../shared/ipc'

type LoadState = 'loading' | 'ready' | 'error'
type View = 'session' | 'board' | 'queue'
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
  const [requirement, setRequirement] = useState('')
  const [run, setRun] = useState<RunSnapshot>()
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [activeView, setActiveView] = useState<View>('session')
  const [actionState, setActionState] = useState<'idle' | 'starting' | 'stopping' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string>()

  useEffect(() => {
    window.paracode
      .getAppInfo()
      .then((info) => {
        setAppInfo(info)
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
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
      }),
    [],
  )

  const timeline = useMemo(() => buildTimeline(events), [events])
  const projectName = projectLabel(repositoryPath)
  const runStatus = run ? STATUS_LABELS[run.run.status] : '尚未启动'
  const queueCount = events.filter(
    (event) => event.type === 'question' || event.type === 'approval_request',
  ).length
  const currentActivity = timeline
    .flatMap((entry) => (entry.kind === 'activityGroup' ? (entry.items ?? []) : []))
    .find((entry) => entry.status === 'running')

  async function selectProject(): Promise<void> {
    try {
      const selected = await window.paracode.selectProject()
      if (selected) {
        setRepositoryPath(selected)
        setErrorMessage(undefined)
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '选择项目失败')
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
      const snapshot = await window.paracode.startTask({
        repositoryPath,
        requirement: requirement.trim(),
      })
      setRun(snapshot)
      setEvents((current) => mergeEvents(snapshot.events, current))
      setActionState('idle')
    } catch (error) {
      setActionState('error')
      setErrorMessage(error instanceof Error ? error.message : '任务启动失败')
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
    setRequirement('')
    setErrorMessage(undefined)
    setActionState('idle')
    setActiveView('session')
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

        <div className="sidebar-section">
          <p className="sidebar-label">当前项目</p>
          <div className={`project-item ${repositoryPath ? '' : 'muted'}`} title={repositoryPath}>
            <span className="project-dot" aria-hidden="true" />
            <span>{projectName}</span>
          </div>
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
          ) : (
            <p className="sidebar-empty">还没有编码会话</p>
          )}
        </div>

        <div className="sidebar-footer">
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
          <button className="secondary-button" type="button" onClick={() => void selectProject()}>
            打开项目
          </button>
        </header>

        {activeView === 'session' ? (
          <SessionView
            projectName={projectName}
            repositoryPath={repositoryPath}
            requirement={requirement}
            run={run}
            timeline={timeline}
            currentActivity={currentActivity}
            actionState={actionState}
            errorMessage={errorMessage}
            onRequirementChange={setRequirement}
            onSelectProject={() => void selectProject()}
            onStartTask={() => void startTask()}
            onStopTask={() => void stopTask()}
          />
        ) : null}
        {activeView === 'board' ? (
          <BoardView run={run} timeline={timeline} onOpenSession={() => setActiveView('session')} />
        ) : null}
        {activeView === 'queue' ? (
          <QueueView events={events} onOpenSession={() => setActiveView('session')} />
        ) : null}
      </main>
    </div>
  )
}

function SessionView({
  projectName,
  repositoryPath,
  requirement,
  run,
  timeline,
  currentActivity,
  actionState,
  errorMessage,
  onRequirementChange,
  onSelectProject,
  onStartTask,
  onStopTask,
}: {
  projectName: string
  repositoryPath?: string
  requirement: string
  run?: RunSnapshot
  timeline: TimelineEntry[]
  currentActivity?: ActivityEntry
  actionState: 'idle' | 'starting' | 'stopping' | 'error'
  errorMessage?: string
  onRequirementChange: (value: string) => void
  onSelectProject: () => void
  onStartTask: () => void
  onStopTask: () => void
}): React.JSX.Element {
  const canStart =
    Boolean(repositoryPath && requirement.trim()) &&
    actionState !== 'starting' &&
    actionState !== 'stopping'
  const isRunning = Boolean(run && isActiveStatus(run.run.status))

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !run) {
      event.preventDefault()
      if (canStart) onStartTask()
    }
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
        ) : (
          <div className="empty-session">
            <div className="empty-mark" aria-hidden="true">
              P
            </div>
            <p className="eyebrow">PARALLEL CODING WORKSPACE</p>
            <h1>从一个编码任务开始</h1>
            <p>选择一个 Git 项目，描述你想完成的工作，ParaCode 会在隔离 worktree 中启动 Agent。</p>
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
            value={requirement}
            onChange={(event) => onRequirementChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              run
                ? '当前会话的继续交互即将开放'
                : '描述一个要完成的编码任务，支持粘贴完整需求或 bug 列表'
            }
            rows={run ? 1 : 3}
            disabled={Boolean(run)}
            aria-label={run ? '当前会话输入' : '编码需求'}
          />
          <div className="composer-controls">
            <div className="composer-context">
              <button className="composer-chip" type="button" onClick={onSelectProject}>
                <span aria-hidden="true">□</span>
                {repositoryPath ? projectName : '选择 Git 项目'}
              </button>
              <span className="composer-chip readonly">工作区写入</span>
            </div>
            {isRunning ? (
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
            ) : (
              <button
                className="send-button"
                type="button"
                disabled={!canStart || Boolean(run)}
                onClick={onStartTask}
                aria-label="启动编码任务"
              >
                {actionState === 'starting' ? '创建中…' : '开始执行'}
                <span aria-hidden="true">↑</span>
              </button>
            )}
          </div>
        </div>
        <div className="composer-hint">
          {run
            ? '任务运行中，后续追问与审批回复将在下一阶段接入。'
            : 'Enter 开始执行 · Shift + Enter 换行'}
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

function BoardView({
  run,
  timeline,
  onOpenSession,
}: {
  run?: RunSnapshot
  timeline: TimelineEntry[]
  onOpenSession: () => void
}): React.JSX.Element {
  return (
    <section className="secondary-view" aria-label="并行看板">
      <div className="secondary-view-header">
        <div>
          <p className="eyebrow">工作区概览</p>
          <h1>并行看板</h1>
          <p>当前阶段展示真实 worktree 状态，更多并行任务将在分组流程接入后出现。</p>
        </div>
        <span className="view-summary">{run ? '1 个 worktree' : '暂无 worktree'}</span>
      </div>
      {run ? (
        <article className="worktree-card">
          <div className="worktree-card-head">
            <span className={`session-dot ${run.run.status}`} aria-hidden="true" />
            <strong>{run.run.branchName || '未命名分支'}</strong>
            <span className={`status-badge ${run.run.status}`}>
              {STATUS_LABELS[run.run.status]}
            </span>
          </div>
          <p>{run.run.requirement}</p>
          <div className="worktree-stats">
            <span>
              {timeline.reduce(
                (count, entry) =>
                  count + (entry.kind === 'activityGroup' ? (entry.items?.length ?? 0) : 0),
                0,
              )}{' '}
              个活动
            </span>
            <span>{timeline.filter((entry) => entry.kind === 'test').length} 个测试结果</span>
            <span>{run.run.latestMessage ?? '等待 Agent 更新'}</span>
          </div>
          <button className="secondary-button" type="button" onClick={onOpenSession}>
            打开会话
          </button>
        </article>
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
  events,
  onOpenSession,
}: {
  events: AgentEvent[]
  onOpenSession: () => void
}): React.JSX.Element {
  const queueEvents = events.filter(
    (event) => event.type === 'question' || event.type === 'approval_request',
  )
  return (
    <section className="secondary-view" aria-label="交互队列">
      <div className="secondary-view-header">
        <div>
          <p className="eyebrow">需要你的决定</p>
          <h1>交互队列</h1>
          <p>Agent 需要提问或请求授权时，会集中显示在这里。</p>
        </div>
        <span className="view-summary">{queueEvents.length} 个待处理</span>
      </div>
      {queueEvents.length > 0 ? (
        <div className="queue-list">
          {queueEvents.map((event) => (
            <article className="queue-item" key={event.id}>
              <div className="queue-item-head">
                <span
                  className={`queue-tag ${event.type === 'approval_request' ? 'approval' : ''}`}
                >
                  {event.type === 'approval_request' ? '授权' : '提问'}
                </span>
                <time>{formatTime(event.timestamp)}</time>
              </div>
              <h2>
                {event.type === 'approval_request' ? 'Agent 等待执行许可' : 'Agent 需要你的回答'}
              </h2>
              <p>{payloadSummary(event.payload)}</p>
              <button className="secondary-button" type="button" onClick={onOpenSession}>
                打开会话
              </button>
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
