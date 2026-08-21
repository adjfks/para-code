# 贡献指南

感谢你关注 ParaCode。项目仍处于早期阶段，贡献前请先确认改动是否符合编排协议和本地优先的 MVP 边界。

## 开发流程

1. Fork 仓库并创建短生命周期分支。
2. 安装 Node.js、pnpm 和 Git。
3. 执行 `pnpm install`，运行 `pnpm dev`。
4. 完成改动后运行 `pnpm check`。
5. 提交 Pull Request，说明行为变化、测试范围和已知限制。

## 代码约束

- 使用 TypeScript strict mode。
- Renderer 不直接执行 shell、Git、文件写入或 agent 操作。
- 新增跨进程通信时，先更新 `src/shared` 中的协议和类型。
- 改变产品状态、权限或 worktree 生命周期时，先更新 `docs/` 下的协议文档。
- 对状态机、权限和恢复逻辑补充自动化测试。

## 提交信息

推荐使用 Conventional Commits：

```text
feat(orchestrator): add worktree creation command
fix(queue): preserve blocked interaction after restart
docs(protocol): define grouping plan versioning
```

## Pull Request 检查清单

- [ ] 已说明用户可见的行为变化。
- [ ] 已补充或更新测试。
- [ ] `pnpm check` 通过。
- [ ] 未提交密钥、构建产物或本地路径。
- [ ] 涉及协议的改动已同步更新文档。
