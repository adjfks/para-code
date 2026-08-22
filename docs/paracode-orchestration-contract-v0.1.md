# ParaCode Orchestration Contract v0.1

状态：已确认的 MVP 产品与技术边界

日期：2026-08-22

本文档定义 ParaCode 的第一条可运行闭环：开发者在一个主会话中提交多个需求，系统生成可编辑的分组方案，开发者确认后创建多个 Git worktree，并在每个 worktree 中运行一个独立 agent。agent 的阻塞请求集中进入主会话交互队列，开发者处理后，原 agent 恢复执行。

## 1. 已确认决策

| 决策项         | MVP 选择                                        | 说明                                        |
| -------------- | ----------------------------------------------- | ------------------------------------------- |
| 目标用户       | 单个开发者，本地使用                            | 暂不做团队协作和多人共享状态                |
| 平台           | macOS + Windows                                 | 使用跨平台桌面框架；Linux 后续评估          |
| 模型接入       | provider-neutral adapter，MVP 只接一个供应商    | UI 和编排层不能绑定某一家模型的消息格式     |
| agent 拓扑     | 一个 worktree 对应一个 agent session            | MVP 不允许多个 agent 共享同一 worktree      |
| 分组确认       | agent 提案，开发者确认后创建                    | 创建前必须可编辑、可复核                    |
| 交互队列       | 仅阻塞 agent 的请求进入队列                     | 普通进度和日志进入动态流                    |
| 集成方式       | 每个 worktree 产出 commit，开发者手动评审和合并 | MVP 不自动合并到 main                       |
| 工作区前置条件 | main 工作区必须干净                             | `git status --porcelain` 有输出时不允许创建 |
| 权限           | 项目级默认权限，危险操作单独批准                | 权限必须可审计、可撤销                      |
| 数据存储       | 本地优先                                        | 使用本地数据库和事件日志，不做云端同步      |
| 执行中新增需求 | 新建一批分组计划                                | 默认不修改已启动的 worktree                 |
| 任务依赖       | 显式依赖图，依赖任务串行                        | 无依赖的任务才允许并行                      |
| 首要成功指标   | 降低手动创建和管理 worktree 的成本              | 无人值守时长不是第一阶段目标                |

## 2. 产品定义

### 2.1 用户任务

开发者已经拥有一批需要处理的 bug、功能和性能任务，希望一次性提交给 ParaCode。ParaCode 负责分析代码依赖、提出分组方案、创建隔离执行环境并管理多个 agent 的生命周期。

### 2.2 价值时刻

开发者确认分组后，两个或多个真实 worktree 被创建，并且每个 worktree 都开始执行自己的需求。开发者不需要手动复制仓库、命名分支、启动多个会话或轮询它们的状态。

### 2.3 MVP 的成功结果

- 每个需求都有清晰的归属、依赖关系和执行状态。
- 每个 worktree 的 agent 能独立运行、暂停、恢复和失败重试。
- agent 需要人工决策时，开发者能从主会话找到并处理它。
- worktree 最终产出可评审的 commit、测试结果和失败原因。
- 应用重启后不丢失任务状态、事件和未处理请求。

### 2.4 非目标

- 第一版不做云端账号、团队协作、跨设备同步。
- 第一版不做多个 agent 共享一个 worktree。
- 第一版不自动合并到 main，不自动解决合并冲突。
- 第一版不承诺完全无人值守地完成高风险代码修改。
- 第一版不提供模型训练、模型托管或统一的云端密钥管理。

## 3. 核心对象

### 3.1 Project

代表一个本地 Git 仓库。

```text
Project
  id
  name
  repositoryPath
  defaultBaseRef
  platform
  permissionPolicy
  createdAt
  updatedAt
```

约束：项目必须能通过系统 Git CLI 读取，且仓库根目录可访问。项目级配置不应混入某一批任务的临时状态。

### 3.2 MainSession

代表开发者提交一批需求的主会话。

```text
MainSession
  id
  projectId
  inputMessages
  requirementIds
  groupingPlanIds
  status
  createdAt
  updatedAt
```

主会话在 worktree 启动后仍然存在，负责汇总状态、接收新批次需求和展示交互队列。

### 3.3 Requirement

代表一个可独立验收的 bug、功能或性能任务。

```text
Requirement
  id
  mainSessionId
  sourceText
  kind: bug | feature | performance | refactor | other
  acceptanceCriteria
  status
  createdAt
```

每个 Requirement 在确认分组时必须属于一个 Group，或进入 `unassigned` 并附带原因。不能静默丢弃需求。

### 3.4 GroupingPlan

代表尚未创建 worktree 的分组方案。预览阶段使用“分组 A/B/C”命名，不使用 `WT #1`，避免把提案误认为已创建资源。

```text
GroupingPlan
  id
  mainSessionId
  version
  baseRef
  groups[]
  dependencyEdges[]
  conflicts[]
  unassigned[]
  evidence[]
  status: analyzing | ready | editing | confirmed | rejected | failed
```

每次拖拽、拆分、合并、重命名或增删需求都增加 `version`。确认操作必须携带当前版本，防止旧方案覆盖新方案。

### 3.5 WorktreeRun

代表已经创建的 Git worktree 和其执行生命周期。

```text
WorktreeRun
  id
  groupingPlanId
  groupId
  repositoryPath
  worktreePath
  branchName
  baseRef
  requirementIds
  dependencyRunIds
  agentSessionId
  status
  latestCommit
  testSummary
  createdAt
  updatedAt
```

### 3.6 InteractionRequest

代表 agent 需要开发者介入的一次结构化请求，而不是普通聊天消息。

```text
InteractionRequest
  id
  worktreeRunId
  type: question | approval | review | recovery
  blocking: true
  priority: normal | high | urgent
  title
  context
  options[]
  requiredPermission
  status: queued | assigned | answered | snoozed | expired | canceled
  resumePolicy
  createdAt
  answeredAt
```

## 4. 生命周期

### 4.1 主会话状态

```text
drafting
  -> analyzing
  -> plan_ready
  -> editing_plan
  -> creating
  -> active
  -> completed
  -> failed / canceled
```

- `drafting`：开发者输入或编辑需求。
- `analyzing`：扫描仓库、分析依赖、生成候选分组。
- `plan_ready`：分组方案可预览和编辑。
- `editing_plan`：开发者拖拽或修改方案。
- `creating`：按已确认的方案创建 worktree。
- `active`：至少一个 WorktreeRun 正在执行或等待人工处理。
- `completed`：所有 WorktreeRun 都产生可评审结果，或被明确取消。
- `failed`：主流程无法继续，需要恢复或重新开始。

### 4.2 WorktreeRun 状态

```text
proposed
  -> creating
  -> bootstrapping
  -> planning
  -> coding
  -> waiting_human
  -> testing
  -> ready_for_review
  -> completed

任意执行态 -> failed / canceled
failed -> retrying -> 原执行态
```

状态必须由事件驱动，不能仅由前端推断。进度百分比是展示信息，不是生命周期真相；真实状态以阶段、最近事件、测试结果和 commit 为准。

### 4.3 依赖调度

- GroupingPlan 生成有向依赖图。
- 有入度的 WorktreeRun 只能在依赖任务完成或产生指定 artifact 后启动。
- 无依赖的 WorktreeRun 才进入并行调度池。
- 依赖失败时，下游任务进入 `blocked` 或 `canceled`，不能静默继续。
- MVP 不允许用户手动绕过依赖；后续可增加显式“强制继续”操作。

## 5. 分组协议

### 5.1 分组原则

agent 必须结合以下证据生成方案：

1. 需求语义和验收标准。
2. 代码文件重叠和导入关系。
3. 数据库、API、路由和配置依赖。
4. 测试入口和运行时边界。
5. 任务之间的前置条件。

LLM 可以负责语义聚类、解释、命名和风险总结，但不能只凭自然语言声称“可以安全并行”。

### 5.2 分组不变量

- 每个 Requirement 恰好属于一个 Group，或明确进入 `unassigned`。
- Group 不能为空。
- 共享文件不一定要求合并，但必须显示重叠文件和风险。
- 存在执行顺序时必须生成 dependency edge。
- 用户确认前不创建分支、worktree 或 agent 进程。
- 用户确认只作用于当前 GroupingPlan 版本。
- 创建操作必须幂等，重复点击不能产生重复 worktree。

### 5.3 GroupingPlan 示例

```json
{
  "id": "plan_01",
  "version": 3,
  "baseRef": "main@a1b2c3d",
  "groups": [
    {
      "id": "group_auth",
      "name": "auth-api-fixes",
      "requirementIds": ["req_1", "req_4"],
      "predictedFiles": ["src/features/auth/**", "src/app/api/conversations/**"],
      "risk": "medium",
      "confidence": 0.87
    }
  ],
  "dependencyEdges": [],
  "conflicts": [],
  "unassigned": [],
  "evidence": [
    {
      "type": "shared_api_layer",
      "requirementIds": ["req_1", "req_4"],
      "files": ["src/app/api/**"]
    }
  ]
}
```

## 6. Worktree 创建协议

### 6.1 前置检查

确认创建前必须检查：

- 当前项目是有效 Git 仓库。
- `git status --porcelain` 为空。
- `baseRef` 仍然存在，且没有被用户切换。
- 目标 worktree 路径不存在，或属于本次任务且可安全重试。
- 目标分支不存在，或已经由同一运行实例创建。
- 磁盘空间和文件权限满足创建要求。

### 6.2 命名

建议默认格式：

```text
worktree path: <repo-parent>/.paracode/worktrees/<session-slug>/<group-slug>
branch name:   paracode/<session-slug>/<group-slug>
```

实际命名规则必须经过路径清理，兼容 Windows 保留字符、路径长度和大小写不敏感文件系统。

### 6.3 部分失败

批量创建不是全有或全无：

- 已成功创建的 WorktreeRun 保持可用并显示状态。
- 失败项显示具体目标、原因和可重试操作。
- 重试只能操作失败项，不重复创建成功项。
- 主分支和其他 worktree 不得因某个创建失败而被删除或回滚。

## 7. Agent Session 协议

### 7.1 运行模型

- 一个 WorktreeRun 只启动一个 AgentSession。
- AgentSession 的当前工作目录固定为对应 worktree。
- agent 只能通过统一的工具执行层访问 Git、文件系统、终端和网络。
- 所有工具调用、审批、输出和结果都产生结构化事件。
- agent 可以被暂停、恢复、取消、重试；恢复必须携带原 session 上下文和未完成任务。

### 7.2 初始上下文

每个 agent 至少收到：

- 项目基本信息和 baseRef。
- 当前 Group 的需求和验收标准。
- 该 Group 的预测文件、依赖关系和风险。
- 项目级编码规范、测试命令和权限策略。
- 其他 Group 的只读摘要，不默认共享其他 worktree 的文件。

### 7.3 AgentEvent

```text
AgentEvent
  id
  worktreeRunId
  agentSessionId
  sequence
  timestamp
  type
  payload
```

MVP 事件类型：

| 事件                                 | 用途                                 |
| ------------------------------------ | ------------------------------------ |
| `session_started`                    | agent 进程启动                       |
| `phase_changed`                      | planning、coding、testing 等阶段变化 |
| `progress`                           | 当前任务和可选进度信息               |
| `tool_started` / `tool_finished`     | 工具调用和结果                       |
| `question`                           | 需要开发者回答的阻塞问题             |
| `approval_request`                   | 需要权限或危险操作批准               |
| `review_request`                     | 需要开发者评审方案或结果             |
| `commit_created`                     | 创建 commit                          |
| `test_result`                        | 测试、lint、构建结果                 |
| `session_paused` / `session_resumed` | 暂停和恢复                           |
| `session_completed`                  | 任务完成                             |
| `session_failed`                     | 任务失败                             |
| `session_canceled`                   | 用户主动停止任务                     |

事件必须带递增 `sequence`，客户端断线重连时可以从最后一个 sequence 继续拉取。

## 8. 交互队列协议

### 8.1 进入条件

只有会阻塞 agent 继续执行的请求进入交互队列。普通日志、进度、非阻塞建议不占用队列位置。

### 8.2 排序规则

默认排序：

1. `urgent` 阻塞请求。
2. 已等待时间更长的 `high` 请求。
3. 普通 `question`、`review` 和 `approval`。

相同优先级按创建时间排序。队列顶部必须显示等待时间和关联 WorktreeRun。

### 8.3 用户操作语义

- `处理`：打开对应 sub-session，将请求标记为 `assigned`。
- `回答`：提交文本或结构化选项，产生 `interaction_answered` 事件。
- `稍后`：只改变提醒时间，不解除 agent 的阻塞状态。
- `取消任务`：取消关联的 WorktreeRun，并明确显示会停止哪些 agent 和保留哪些 artifact。
- `让 agent 自主选`：仅在请求声明允许 delegation 时可用；必须记录授权范围和有效期。

## 9. 权限与安全

### 9.1 权限层级

MVP 按项目配置以下能力：

- 文件读写范围。
- Git 操作范围。
- shell 命令执行。
- 网络访问。
- 环境变量和密钥可见性。
- 是否允许安装依赖或修改项目配置。

默认允许低风险读操作和测试命令。以下操作默认需要批准：删除或覆盖大量文件、修改权限、访问敏感路径、上传数据、安装系统级依赖、推送远程仓库和修改 main。

### 9.2 审计

权限请求、用户决定、实际执行命令和执行结果必须写入事件日志。日志中的 token、密钥和敏感环境变量必须脱敏。

### 9.3 Prompt Injection

仓库中的 README、注释、Issue 导入内容和测试数据都视为不可信输入。agent 不能仅因为代码库文本中的指令就获得额外权限或改变系统策略。

## 10. 持久化与恢复

### 10.1 本地数据

使用本地 SQLite 保存：

- 项目配置。
- 主会话和需求。
- GroupingPlan 版本。
- WorktreeRun 和 AgentSession 状态。
- InteractionRequest。
- AgentEvent 事件日志。
- commit、测试和 artifact 索引。

### 10.2 事件与快照

采用“追加事件 + 当前快照”方式：

- 事件是恢复和审计的事实来源。
- 快照用于快速加载界面。
- 前端不直接写领域状态，只发送命令。
- 命令需要幂等 key，避免重复创建 worktree 或重复回答请求。

### 10.3 应用重启

重启后：

- 恢复所有未完成 WorktreeRun。
- 检查对应 agent 进程是否仍存活。
- 进程不存在时进入 `recovering` 或 `failed`，不能假设 agent 仍在执行。
- 恢复未处理的 InteractionRequest。
- 扫描 worktree 当前分支、最新 commit 和工作区状态，与快照进行校验。

## 11. 跨平台技术架构

### 11.1 暂定技术选择

- 桌面壳：Electron，React + TypeScript renderer。
- 本地编排器：Electron main process 中的 TypeScript/Node 服务。
- 进程执行：`node-pty` 处理交互式终端，`execa` 或等价封装处理结构化命令。
- Git：优先调用系统 Git CLI，不在 MVP 内重新实现 Git。
- 持久化：SQLite；使用迁移文件管理 schema。
- 状态：后端有限状态机，前端订阅快照和事件流。
- agent 接入：统一 `AgentProvider` interface，MVP 只实现一个 provider。

Electron 是 MVP 的已决桌面框架。Tauri 2 仅作为未来的替代评估对象；任何迁移必须先验证 Windows 下的 PTY、Git、sidecar 打包和自动更新能力，不能只按安装包大小决定。

### 11.2 进程边界

```text
Renderer
  -> typed IPC commands
Desktop Orchestrator
  -> Project / Plan / Scheduler / Queue services
  -> Git / Process / Permission adapters
  -> AgentProvider adapter
  -> SQLite event store
```

Renderer 不直接执行 shell、Git 或文件写入。所有副作用都由编排器执行并产生事件。

### 11.3 跨平台约束

- 路径统一使用规范化内部表示，渲染时再转换分隔符。
- 不假设默认 shell 是 bash；命令执行应尽量使用参数数组而不是字符串拼接。
- 处理 Windows 的进程树终止、文件锁、长路径和权限弹窗。
- 处理 macOS 的应用沙箱、文件访问授权和签名分发。
- 所有工作目录、分支名和日志路径都必须可追踪。

## 12. 用户界面范围

MVP 保留原型的三个核心视图：

1. 主会话：需求输入、分析状态、GroupingPlan 编辑。
2. 并行看板：WorktreeRun 状态、当前阶段、最近事件、测试和 commit。
3. 交互队列：阻塞请求、等待时间、处理入口和恢复结果。

每个 WorktreeRun 需要一个详情抽屉或详情页，至少包含分支、路径、需求、事件、权限记录、测试结果和 commit。

MVP 暂不做独立的自动合并页面，但必须提供足够的结果信息，让开发者能打开 worktree、查看 commit 并手动合并。

## 13. 必须覆盖的状态

所有涉及数据加载、创建、agent 执行和人工操作的界面都要设计以下状态：

- 首次加载和分析中。
- 没有需求、空分组和过滤后无结果。
- 分组方案已生成、正在编辑、方案过期。
- worktree 创建中、部分成功、失败和可重试。
- agent 规划中、编码中、测试中、暂停、等待人工、完成和失败。
- 队列为空、存在多个请求、请求已被其他窗口处理、请求过期。
- 权限不足、用户拒绝、网络断开、模型服务失败。
- 应用重启后的恢复中和恢复失败。
- 长分支名、长需求文本、大量 worktree、窄窗口和 Windows 路径。

关键动作需要明确对象、范围和后果；确认创建、取消任务和授予代理权限不能使用模糊的“确认/确定”文案（`rule/name-object-scope-consequence`、`rule/destructive-proportional`）。拖拽分组必须有键盘可完成的替代操作（`rule/keyboard-complete-flow`）。

## 14. MVP 验收场景

### 场景 A：两个独立需求

给定一个干净的 Git 仓库和两个互不相关的需求：

- agent 生成两个分组，并给出文件证据。
- 开发者确认后创建两个 worktree。
- 两个 agent 在各自目录启动，主会话能看到事件和阶段。

### 场景 B：需求需要人工调整分组

- agent 初始生成两个分组。
- 开发者把一个需求拖到另一个分组并重命名。
- 系统更新 plan version，创建摘要反映最新分组。
- 旧版本确认请求不能创建 worktree。

### 场景 C：agent 阻塞提问

- 一个 agent 发出 `question`。
- 请求进入交互队列，WorktreeRun 进入 `waiting_human`。
- 开发者从主会话回答，原 agent 恢复，不创建新的 session。
- 回答和恢复事件可审计。

### 场景 D：依赖任务

- Group A 被识别为 Group B 的前置任务。
- A 完成前 B 不启动。
- A 失败时 B 显示阻塞原因，并提供恢复或取消路径。

### 场景 E：创建部分失败

- 三个分组中一个分支名冲突。
- 两个成功的 worktree 继续执行。
- 失败项显示原因和重试按钮，重试不重复创建成功项。

### 场景 F：应用重启

- 两个 agent 执行中关闭并重新打开应用。
- 系统恢复 worktree、事件、agent 存活状态和未处理的 InteractionRequest。
- 进程已经退出时，系统显示恢复失败，而不是继续显示“编码中”。

## 15. 衡量指标

第一阶段只收集基线，不预设硬性目标：

- 从确认分组到第一个 agent 启动的耗时。
- 开发者修改自动分组的比例。
- worktree 创建失败率和重试成功率。
- agent 阻塞等待人工的总时长。
- 应用重启后的状态恢复成功率。
- 每个 WorktreeRun 产出 commit 和测试结果的比例。
- 最终手动合并时的冲突率。

## 16. 当前仍待决定的事项

以下事项不阻塞协议 v0.1，但实现前必须定案：

- MVP 接入哪一家 agent provider，以及其本地认证方式。
- 默认最大并发 WorktreeRun 数量，以及 CPU、内存和 token 预算。
- worktree 的默认目录是否允许用户自定义。
- agent 的默认测试命令如何发现和覆盖。
- commit 是由 agent 自主创建，还是由 ParaCode 在测试通过后统一创建。
- 是否允许开发者在主会话中直接打开终端或编辑器。
- 应用崩溃后 agent 是否默认自动重启，还是必须人工确认。
- Linux 支持的时间点。

## 17. 第一阶段实施顺序

1. 固化本文档中的数据模型、状态机和 JSON Schema。
2. 实现本地 SQLite event store 和 WorktreeManager。
3. 实现 fake agent simulator，先不用真实模型验证事件、队列和恢复。
4. 接入一个真实 agent provider，完成两个 worktree 的纵向闭环。
5. 实现分组编辑、确认摘要和创建部分失败处理。
6. 实现应用重启恢复和最小的权限审批。
7. 用独立需求、共享文件、依赖任务、创建失败和多请求并发五类场景做验收。

不要先实现自动合并、多人协作或多 agent 共享 worktree。它们都应建立在这条本地纵向闭环稳定之后。

## 18. 设计约束索引

- `rule/preserve-mental-model`：创建前使用分组对象，创建后再显示 WorktreeRun。
- `rule/name-object-scope-consequence`：创建、取消、授权等动作必须显示对象、范围和后果。
- `rule/destructive-proportional`：高风险命令和取消任务需要与影响匹配的确认。
- `rule/cover-reachable-states`：覆盖加载、空、部分成功、失败、恢复和权限状态。
- `rule/keyboard-complete-flow`：分组调整和队列处理不能只依赖鼠标拖拽。
- `rule/accessible-name-required`：图标按钮、状态控件和队列操作必须有可访问名称。
