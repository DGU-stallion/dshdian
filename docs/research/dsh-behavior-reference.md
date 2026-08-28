# DSH 行为参考 — Dshdian 实现对齐指南

> 基于 DSH v0.x 源码调研（2026-08-28），用于指导 Dshdian 实现逻辑的修正。

## 核心原则

**Dshdian 不发明逻辑，只做 DSH 行为在 Obsidian DOM 中的映射。**

---

## 1. 权限与审批

### DSH 权限体系

| Sandbox Mode | 含义 | 审批策略 |
|---|---|---|
| `read-only` | 不能修改任何文件 | — |
| `workspace-write` | 可修改 workspace 下文件，更宽范围需审批 | `ask` |
| `danger-full-access` | 无限制 | `never`（自动拒绝审批请求，即不弹窗） |

### Dshdian 三模式对应

| Dshdian 模式 | agentPreset | Permission Preset |
|---|---|---|
| Chat | `standard` | sandbox: `read-only`, approval: `ask` |
| Standard | `standard` | sandbox: `workspace-write`, approval: `ask` |
| Create | `cordis` | sandbox: `danger-full-access`, approval: `never` |

### 审批弹窗逻辑

**Dshdian 不决定是否弹窗——DSH 决定。** 当 DSH 的 sandbox policy 判断某个工具调用需要用户确认时，它发送 `approval/requested` 帧。Dshdian 只需要：

1. 收到 `approval/requested` → 显示确认 UI
2. 用户点击 → 用 **原始 rpcId**（envelope 的 rpcId）回复 `client-response`
3. 回复格式：`{ ok: true, value: { sessionId, approvalId, outcome: "allowed-once" | "rejected" } }`

**绝不自己判断是否需要审批。** 如果 DSH 没发 `approval/requested`，就不弹窗。

### 回复格式（关键修正）

当前 Dshdian 错误地用 `client.respond(approvalId, payload)` 回复。正确做法：

```typescript
// 用 envelope 的 rpcId 而不是 approvalId 回复
await this.client.respond(rpcId, {
  sessionId: frame.sessionId,
  approvalId: frame.approvalId,
  outcome: "allowed-once" // or "rejected"
});
```

注意：client 只能回复 `"allowed-once"` 或 `"rejected"`。`"cancelled"` 和 `"unavailable"` 是服务端行为。

---

## 2. Session 与模式切换

### 关键规则

| 操作 | 是否需要新建 Session |
|---|---|
| 切换 agentPreset | **是**（preset 在第一个 turn 后锁定） |
| 切换 permission（sandbox mode） | **否**（同一 session 内可切换） |
| 切换 model | **否**（`session.selectModel` RPC） |

### Dshdian 的模式切换应该怎么做

由于三个模式用了不同的 agentPreset（`standard` vs `cordis`）：

- **Chat ↔ Standard**：preset 都是 `standard`，只需切换 permission。**不需要新建 session**。通过发送 `/permission workspace-write` 或 `/permission read-only` 实现。
- **Chat/Standard ↔ Create**：preset 不同（`standard` → `cordis`），**必须新建 session**。

### Permission 切换方式

在同一 session 内切换 permission 的方式：发送 `/permission <preset>` 作为 `session.prompt` 内容。DSH 的 permission-presets 插件会处理这个 slash command。

```typescript
// 在 Standard → Chat 时：
await client.sendMessage(sessionId, "/permission read-only");

// 在 Chat → Standard 时：
await client.sendMessage(sessionId, "/permission workspace-write");
```

### 切换时不应该清空 UI

- Chat ↔ Standard：同一 session，不清空消息，不刷新页面
- 切到 Create：新建 session，清空消息是合理的

---

## 3. 系统提示词与上下文注入

### DSH 的系统提示词架构

系统提示词**不是通过 `session.prompt` 的 `instructions` 字段传入的**（该字段不存在）。DSH 的系统提示词由以下来源组成：

1. **Agent Preset 的 persona**：在 preset 的 cordis 配置里定义，session 创建时加载
2. **systemPrompt.section()**：插件注册的固定段落
3. **systemPrompt.context()**：动态上下文（自动 diff，变化时才注入）
4. **dsh-agent-instructions**：workspace 的 AGENTS.md 文件内容（作为 user-role 的 `<system-reminder>` 消息注入）

### Dshdian 应该怎么注入 Vault 上下文

**正确方式：利用 DSH 的已有机制。**

1. **在 vault 根目录放 AGENTS.md**：DSH 的 `dsh-agent-instructions` 会自动发现并注入。内容可以包含 vault 结构、使用规则等。这是零代码方案。

2. **如果需要动态注入**（如当前活跃笔记）：作为 `session.prompt` 的用户消息内容的一部分发送，但只在必要时（如第一条消息或 @引用时）。

### Dshdian 不应该做的事

- ❌ 每条消息都注入 `[Vault Info]`
- ❌ 自己实现系统提示词拼接
- ❌ 用不存在的 `instructions` 字段

### 建议实现

```
第一条消息：用户内容 + vault 结构摘要（如有 @引用则附加引用内容）
后续消息：纯用户内容（如有 @引用则附加引用内容）
vault 结构：依赖 AGENTS.md 自动注入 OR 第一条消息时附带
```

---

## 4. 消息渲染

### DSH 的渲染模型

消息 = Block 数组，每个 Block 有 kind：

| Block Kind | 来源 | 渲染方式 |
|---|---|---|
| `text` | `text-delta` chunks | Markdown 渲染 |
| `reasoning` | `reasoning-delta` chunks | 可折叠 "Think" 区块 |
| `tool-call` | `tool-call-delta` + `block-start/end` | 工具卡片（DisclosureRow） |

### 思维链（Reasoning）渲染

- **流式中**：展开状态，显示最后一行作为摘要，sweep 动画
- **完成后**：折叠状态，显示第一行作为摘要，点击展开
- **样式**：灰色文字（tertiary），pre-wrap，14px，左侧缩进
- **标题**：固定 "Think"，配脑图标

### 工具调用渲染

- **折叠行**：`[图标] [标题] · [摘要]`，24px 高度
- **图标**：按 variant 分类（bash=⚙️, read=📖, search=🔍, write=✏️）
- **摘要**：从 args 提取关键字段（bash→command, read→path, search→query）
- **展开体**：按 variant 不同显示（Terminal、Diff、Read、Search、Generic IN/OUT）
- **状态**：running（sweep 动画）、ok（绿点）、error（红点）、stopped

### 流式 Markdown

- **节流**：chunk 更新以 `requestAnimationFrame` 批量（~16ms）
- **streaming 标志**：传给 Markdown 渲染器，处理未闭合语法（代码块、链接等）
- **不用防抖 setTimeout**——用 rAF

### 用户消息

- 气泡样式：圆角 22px，最大宽度 min(525px, 82%)
- 对齐：右对齐（`align-self: flex-end`）

---

## 5. CSS 设计规范

### DSH 使用的设计 token 系统

```css
--dsw-alias-bg-base              /* 主背景 */
--dsw-alias-bg-layer-1           /* 卡片背景 */
--dsw-alias-label-primary        /* 主文字 */
--dsw-alias-label-tertiary       /* 次要文字（thinking、摘要） */
--dsw-alias-border-l2            /* 边框 */
--dsw-alias-state-success-primary /* 成功绿色 */
--dsw-alias-state-error-primary   /* 错误红色 */
--dsw-alias-interactive-bg-hover  /* 悬浮背景 */
--dsw-alias-markdown-code-block   /* 代码块背景 */
```

### 关键数值

- 代码块圆角：12px
- 工具行高度：24px
- 用户气泡圆角：22px
- 用户气泡最大宽度：82%
- 基础字号：16px（Markdown），14px（工具/思维链），13px（摘要）

---

## 6. Dshdian 需要修正的点

| 当前问题 | 正确做法 |
|---------|---------|
| 自己判断审批级别（ApprovalStrategy） | 删除，只响应 DSH 发来的 `approval/requested` |
| 切模式就新建 session + 清空 | Chat ↔ Standard 用 `/permission` 命令切换，不新建 |
| 每条消息注入 [Vault Info] | 只在第一条或 AGENTS.md 自动注入 |
| 用不存在的 `instructions` 字段 | 删除，vault 上下文放在用户消息中或 AGENTS.md |
| 自己写的 ApprovalStrategy 逻辑 | 移除，信任 DSH 的 permission-presets 体系 |
| 思维链和正文混在一起渲染 | 分开为独立 Block，reasoning = 折叠区块 |
| 流式渲染用 setTimeout 100ms | 改为 requestAnimationFrame |
| approval 回复用 approvalId 作 rpcId | 用 envelope 的 __rpcId 回复 |

---

## 7. 关于 `approval/requested` 的 rpcId

当前 HarnessClient 已经在 `attachMessageHandler` 中把 envelope 的 rpcId 挂到 `__rpcId` 字段。但 `handleApprovalRequest` 没有使用它——而是用 `frame.approvalId` 调用 `client.respond()`。

正确做法：
```typescript
const rpcId = (frame as any).__rpcId as string;
await this.client.respond(rpcId, {
  sessionId: frame.sessionId,
  approvalId: frame.approvalId,
  outcome: "allowed-once" // or "rejected"
});
```

这和 Question UI 的 respond 逻辑一致（Task 7 已经正确使用了 __rpcId）。
