# ParaCode

ParaCode 是一个本地优先的并行编码工作站：开发者在一个主会话中提交多个需求，ParaCode 负责生成可编辑的分组方案，在确认后创建隔离的 Git worktree，并为每个 worktree 运行一个独立的 agent session。

> 项目处于早期开发阶段。核心编排协议见 [`docs/paracode-orchestration-contract-v0.1.md`](docs/paracode-orchestration-contract-v0.1.md)。

## 当前状态

- 单任务闭环已接通：干净 Git 仓库 → 隔离 worktree → Agent 执行 → 事件时间线。
- 阻塞提问和授权进入交互队列，回答后原 session 继续，不会新建任务。
- 本地 SQLite 持久化 run、事件和 InteractionRequest；项目与 Provider 仍用本地配置文件。
- 默认使用 Fake Agent 验证流程；设置 `PARACODE_AGENT_PROVIDER=codex` 可接入 Codex app-server。
- 多需求分组、依赖调度和完整权限策略尚未实现。

## 开发环境

- Node.js `>=20.19 <25`
- pnpm `>=10`
- macOS 或 Windows
- Git

## 开始开发

```bash
corepack enable
pnpm install
pnpm dev
```

## 质量检查

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

或执行完整检查：

```bash
pnpm check
```

## 项目结构

```text
src/
  main/       Electron 主进程，窗口和系统副作用
  preload/    安全 IPC bridge
  renderer/   React 用户界面
  shared/     跨进程共享类型、协议和测试
docs/         产品与技术协议
.github/      CI、Issue 模板和贡献协作配置
```

Renderer 不直接访问文件系统、Git、shell 或 agent。所有副作用都必须经过 main process 的编排服务和类型化 IPC。

## 构建安装包

```bash
pnpm package:dir
pnpm package
```

安装包输出到 `release/`，该目录不会提交到 Git。

## 贡献

请先阅读 [`CONTRIBUTING.md`](CONTRIBUTING.md) 和 [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md)。涉及产品边界或编排协议的改动，先更新文档再实现代码。

## 许可证

本项目使用 MIT License，详见 [`LICENSE`](LICENSE)。
