# 直连讨论（用户控制下的双模型讨论）· canonical spec v5 · 2026-07-14

> 本文件是唯一运行协议。历史依据：盲评 tmp/relay/20260714-1442、三方辩论 tmp/relay/20260714-1608、DM-OPT-001（已收编退役）、Codex 两轮 review。
> 命名澄清：这不是"三方轮流讨论"——用户是议题拥有者与裁决者，不是自动回合参与者；仅在 NEEDS_USER/NEEDS_EVIDENCE 或发下一张票时重新进入。

## 使用

```bash
# 1. 发起方窗口在本目录建账本，kickoff 按 framing 合同写（见下）
# 2. 启动（必须可被唤醒，禁裸 &）：
bash tmp/relay/coordinator-lite.sh <账本路径(须在本目录)> [来回数<=3] [首发者=codex|opus]
# 盲开局（架构/高风险/用户点名独立意见时）：BLIND_OPENING=1 前缀，建议至少 2 来回
# 旁观: tail -f <账本> ；急停: touch tmp/relay/CHANNEL_OFF / <账本>.STOP
# 3. 收口后发起方向用户分层汇总（结论/共识/实质分歧/关键证据/下一步）
```

## Kickoff framing 合同（发起方义务，缺"用户原话"字段会被 coordinator 记警告注记）

```
用户原话：（逐字，不得改写）
需要决定的问题：
已知事实：
尚未验证的假设：
发起方观点（如有，单独标记，不得混入事实）：
范围与禁止事项：
证据路径：
```

## 机制事实（代码强制，模型无权更改）

账本限本目录+路径规范化防别名；每账本一把可回收锁+并行软上限4；每场懒孵化专属只读会话对（claude allowedTools 三件套/codex -s read-only），首手建会话+发言合一，第二手起增量阅读；单票硬上界3来回、整票 deadline 1800s、单手600s；TAIL fail-closed（末行必须恰为 TAIL 行，否则 PROTOCOL_ERROR 停机）；**共识必须绑定对象**——提案方正文含 `CONSENSUS_PROPOSAL <ID>`+四要素（接受的决定/保留 OPEN/未验证假设/用户影响），确认方 `TAIL: CONSENSUS_REF=<ID>`，coordinator 只机械核对引用；未绑定的 CONSENSUS 不进 pending；预算耗尽的未确认提案记"共识提议·UNREVIEWED"；一切调用失败=DELIVERY_UNKNOWN 停机不重试（分级重试休眠，激活门=投递阶段证据可用）；盲开局=双方对冻结 kickoff 独立作答后同时公开，盲答阶段不建 pending。

## TAIL 词表

`CONTINUE` | `CONSENSUS`(须带提案对象) | `CONSENSUS_REF=<ID>` | `NEEDS_USER` | `NEEDS_EVIDENCE`(正文写明缺什么/去哪查/决定哪个 OPEN；由交互窗口取证后 Boss 授权下票) | `BLOCKED` | `ROTATE_REQUESTED`

## 内容合同（注入每手，条件式）

归因须引手号+最短原文（不实转 OPEN-待补引，可补一次）；证据推理分离证据/解释/新增；OPEN 不得折算共识；未复核候选逐项 UNREVIEWED；任一方可标 user-relevant 且不可被静默降级；模型不得自宣成功；缺证据时用 NEEDS_EVIDENCE 停机，不得靠记忆互相说服。

## 跨票 handoff 合同（发起方发下一张票时，kickoff 必须携带）

```
已接受决定及来源手：
仍 OPEN 的问题（稳定 ID，如 T2-O1）：
user-relevant 分歧：
未验证假设/缺失证据：
用户约束：
下一票只讨论什么：
```

关闭 OPEN 时引用 `CLOSED_BY=T<n>`。

## 汇总者合同

汇总者（常为有立场的发起方）不得删改异议；任一参与方标 user-relevant 的分歧必须展示且用标记方最短原句+手号；其余 OPEN 报数量可展开。

## 启用边界（guidance）与成果升级

架构取舍/重大风险/真实冲突/用户点名才建议开票；简单事实不开；用户明确要求不得拒绝。**tmp/ 是临时权威**：收口的重大共识必须升级到版本控制内（ADR/docs/代码契约），账本只作过程证据。
