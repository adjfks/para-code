import { useEffect, useMemo, useState } from 'react'

import type { AgentEvent, AppInfo, RunSnapshot } from '../../shared/ipc'

type LoadState = 'loading' | 'ready' | 'error'

function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [repositoryPath, setRepositoryPath] = useState<string>()
  const [requirement, setRequirement] = useState('')
  const [run, setRun] = useState<RunSnapshot>()
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [actionState, setActionState] = useState<'idle' | 'starting' | 'error'>('idle')
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
        setEvents((current) => [...current, event])
      }),
    [],
  )

  const runStatus = useMemo(() => run?.run.status ?? '尚未启动', [run])

  async function selectProject(): Promise<void> {
    const selected = await window.paracode.selectProject()
    if (selected) setRepositoryPath(selected)
  }

  async function startTask(): Promise<void> {
    if (!repositoryPath || !requirement.trim()) return
    setActionState('starting')
    setErrorMessage(undefined)
    setEvents([])
    try {
      const snapshot = await window.paracode.startTask({ repositoryPath, requirement })
      setRun(snapshot)
      setActionState('idle')
    } catch (error) {
      setActionState('error')
      setErrorMessage(error instanceof Error ? error.message : '任务启动失败')
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label="ParaCode">
          <span className="brand-mark">P</span>
          <span>ParaCode</span>
        </div>

        <nav className="primary-nav" aria-label="主导航">
          <button className="nav-item active" type="button">
            <span aria-hidden="true">⌘</span>
            <span>工作区</span>
          </button>
          <button className="nav-item" type="button">
            <span aria-hidden="true">◫</span>
            <span>并行任务</span>
          </button>
          <button className="nav-item" type="button">
            <span aria-hidden="true">◷</span>
            <span>交互队列</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <span className="status-dot" aria-hidden="true" />
          <span>本地编排器就绪</span>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div>
            <p className="eyebrow">PARALLEL CODING WORKSPACE</p>
            <h1>欢迎使用 ParaCode</h1>
          </div>
          <button className="secondary-button" type="button" onClick={() => void selectProject()}>
            打开项目
          </button>
        </header>

        <section className="workspace-grid" aria-label="工作区概览">
          <article className="intro-panel">
            <p className="panel-kicker">下一步</p>
            <h2>从一个项目开始并行处理需求</h2>
            <p>
              先运行一个真实编码任务：ParaCode 会在隔离 worktree 中启动 Agent，主工作区保持不变。
            </p>
            <button className="primary-button" type="button" onClick={() => void selectProject()}>
              选择 Git 项目
            </button>
            <div className="task-form">
              <label htmlFor="repository-path">项目路径</label>
              <div className="path-field">{repositoryPath ?? '尚未选择项目'}</div>
              <label htmlFor="requirement">编码需求</label>
              <textarea
                id="requirement"
                value={requirement}
                onChange={(event) => setRequirement(event.target.value)}
                placeholder="例如：为用户服务增加输入校验，并补充单元测试"
                rows={4}
              />
              <button
                className="primary-button"
                type="button"
                disabled={!repositoryPath || !requirement.trim() || actionState === 'starting'}
                onClick={() => void startTask()}
              >
                {actionState === 'starting' ? '创建执行环境中…' : '启动编码任务'}
              </button>
              {errorMessage ? <p className="error-message">{errorMessage}</p> : null}
            </div>
          </article>

          <article className="status-panel">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">系统状态</p>
                <h2>基础设施检查</h2>
              </div>
              <span className={`health-badge ${loadState}`}>
                {loadState === 'ready' ? '正常' : loadState === 'error' ? '异常' : '检查中'}
              </span>
            </div>
            <dl className="status-list">
              <div>
                <dt>桌面进程</dt>
                <dd>{appInfo ? `${appInfo.name} ${appInfo.version}` : '检测中'}</dd>
              </div>
              <div>
                <dt>运行平台</dt>
                <dd>{appInfo ? `${appInfo.platform} · ${appInfo.arch}` : '检测中'}</dd>
              </div>
              <div>
                <dt>编排器</dt>
                <dd>{repositoryPath ?? '待连接项目'}</dd>
              </div>
              <div>
                <dt>当前任务</dt>
                <dd>{runStatus}</dd>
              </div>
            </dl>
          </article>
        </section>

        {run ? (
          <section className="run-panel" aria-label="当前编码任务">
            <div className="panel-heading">
              <div>
                <p className="panel-kicker">当前编码任务</p>
                <h2>{run.run.requirement}</h2>
              </div>
              <span className={`health-badge ${run.run.status === 'failed' ? 'error' : 'ready'}`}>
                {run.run.status}
              </span>
            </div>
            <p className="run-path">{run.run.worktreePath || '正在创建 worktree…'}</p>
            <div className="event-list">
              {events.length === 0 ? <span>等待 Agent 事件…</span> : null}
              {events.map((event) => (
                <div className="event-row" key={event.id}>
                  <span>{event.type}</span>
                  <span>
                    {event.payload.message ? String(event.payload.message) : '事件已记录'}
                  </span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <footer className="content-footer">
          <span>ParaCode 0.1.0 · Early development</span>
          <span>本地优先 · 单 worktree 单 agent</span>
        </footer>
      </main>
    </div>
  )
}

export default App
