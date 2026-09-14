# 退役 discuss-before-plan，Discuss 并入 Challenge

日期：2026-09-12

## 决定

- 删除 `skills/discuss-before-plan`。`workflow-gate` 不再有 Discuss Route。
- 命名选项收敛（Rule #8）改为 **Challenge 收敛模式**：`user-intent=decide`，`Thesis` 为用户偏好（`user-provided`）或代理推荐项（`agent-strawman`），运行时 `grilling`；用户明确委托拍板时 `Runtime skill: none`，当回合给出决定、决定性理由和被否选项，不访谈、不加选项。
- `destructive=yes`（Rule #1）改为 **authorization hold**：保持最小 Route，`Runtime skill: none`，`Next` 只问一个阻塞授权问题，未授权前不加载运行时、不开工。设计层面比较未来破坏性选项仍为 `destructive=no; risk=high`，实施前必须重新过 Rule #1。

## 为什么

- 7–9 月三端记录：显式 `/discuss-before-plan` 调用 26 → 5 → 0；9 月仅经 gate 路由加载 25 次。功能与 `grilling` / `grill-me` 重叠。
- 讨论类 skill 同区 7 个（grilling、grill-me、grill-with-docs、discuss-before-plan、decision-first-technical-writing、domain-modeling、codebase-design），收敛到 mattpocock 一族，减少 Claude 视图的描述开销和路由歧义。
- 2026-08-08 决策把 Discuss 列为“保留不动”，本次以 9 月用量证据另开决策覆盖。

## 同步范围

- `skills/workflow-gate/**`（SKILL、references、evals）、`skills/goal-gate/SKILL.md`、`skills/decision-first-technical-writing/**`、`scripts/__tests__/workflow-gate-public.test.ts`。
- 安装副本：本仓 `.agents/skills` 镜像与 `~/.agents/skills`；`~/.agents` 侧用 `skm remove discuss-before-plan` 删除源与注册。

## 未验证

- Challenge 收敛模式和 authorization hold 在三家真实客户端的表现尚未跑评测；evals 只更新了期望，未重新执行。
