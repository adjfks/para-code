import { useEffect, useState } from 'react'

import type { AppInfo } from '../../shared/ipc'

type LoadState = 'loading' | 'ready' | 'error'

function App(): React.JSX.Element {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [loadState, setLoadState] = useState<LoadState>('loading')

  useEffect(() => {
    window.paracode
      .getAppInfo()
      .then((info) => {
        setAppInfo(info)
        setLoadState('ready')
      })
      .catch(() => setLoadState('error'))
  }, [])

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
          <button className="secondary-button" type="button">
            打开项目
          </button>
        </header>

        <section className="workspace-grid" aria-label="工作区概览">
          <article className="intro-panel">
            <p className="panel-kicker">下一步</p>
            <h2>从一个项目开始并行处理需求</h2>
            <p>ParaCode 会在确认分组后创建隔离 worktree，并在每个 worktree 中运行独立的 agent。</p>
            <button className="primary-button" type="button">
              创建工作区
            </button>
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
                <dd>待连接项目</dd>
              </div>
            </dl>
          </article>
        </section>

        <footer className="content-footer">
          <span>ParaCode 0.1.0 · Early development</span>
          <span>本地优先 · 单 worktree 单 agent</span>
        </footer>
      </main>
    </div>
  )
}

export default App
