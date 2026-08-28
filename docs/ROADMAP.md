# 开发规划 — Dshdian

> 最后更新: 2026-08-28

## 里程碑

### ✅ M1: MVP — 端到端对话（已完成 2026-08-27）

核心验证：Obsidian 插件能否通过 DSH Harness 完成一轮完整的 AI 对话。

| 功能 | Issue | 状态 |
|------|-------|------|
| 插件脚手架 + Chat Panel | #14 | ✅ |
| DSH 进程检测/自动启动 | #15 | ✅ |
| 双流 WebSocket 通信 | #16 | ✅ |
| 三模式 UI 切换 | #17 | ✅ |
| @引用文件 + pill UI | #18 | ✅ |
| Git 感知审批策略 | #19 | ✅ |
| 创造模式 pipeline | #20 | ✅ |
| 文字可选中复制 | #22 | ✅ |
| 历史会话列表 + 切换 | #23 | ✅ |
| 清理 DEBUG 日志 | #24 | ✅ |
| PR #21 合并到 main | #21 | ✅ |
| README 更新 | — | ✅ |
| 改名 dshdian → Dshdian + 鲸鱼图标 | — | ✅ |

---

### ✅ Phase 1: Bug 修复 + 核心可用性（已完成 2026-08-28）

目标：让当前 MVP 在日常使用中不出问题。Phase 1 完成后 GitHub Release 发版 + 提交 Obsidian 社区插件上架。

| # | 功能 | 说明 | 状态 |
|---|------|------|------|
| 1 | 模式↔preset/permission 映射 | Chat→standard+read-only, Butler→standard+workspace-write, Creator→cordis | ✅ |
| 2 | 历史记录 cwd 过滤 | session.list 按 cwd===vaultPath 过滤，隔离 vault | ✅ |
| 3 | 流式 Markdown 实时渲染 | 增量渲染 + 防抖，不等响应完成 | ✅ |
| 4 | Session title 显示 | 从 session/projection 的 title 字段获取 | ✅ |
| 5 | Health check 绕过代理 | DshProcessManager 改用 Node http.get() 直连 | ✅ |

**完成标志**：5 项全部完成 → dogfooding 2-3 天 → GitHub Release v0.1.0 → 提交 obsidian-releases PR

---

### 🎯 Phase 2: 交互完善

目标：补齐 agent 交互闭环——用户能看到 AI 在做什么、能确认/拒绝操作。

| # | 功能 | 来源 | 说明 | 状态 |
|---|------|------|------|------|
| 6 | Approval UI — 确认 Modal | Claudian 借鉴 + ROADMAP 原 M2 | 响应 approval/requested 帧，弹 Modal 让用户 Allow/Reject | 🔲 |
| 7 | Question 交互 UI | ROADMAP 原 M2 | 响应 question/requested 帧，渲染选项卡让用户作答 | 🔲 |
| 8 | Thinking/Tool-call 可视化 | Claudian 借鉴 | 利用 reasoning-delta + tool-call-delta 渲染折叠式思考链和工具调用卡片 | 🔲 |
| 9 | 消息操作按钮 | Claudian 借鉴 | 每条 assistant 消息：Copy / Save as Note / Retry | 🔲 |
| 10 | 代码块复制按钮 | ROADMAP 原 M3 提前 | ``` 代码块右上角加复制 icon | 🔲 |

---

### 🧠 Phase 3: 智能增强

目标：让 Dshdian 比"透传 DSH"更聪明——自动注入上下文、主动引导用户。

| # | 功能 | 来源 | 说明 | 状态 |
|---|------|------|------|------|
| 11 | Vault Indexer — 自动结构注入 | Claudian 借鉴 | 启动时索引 vault（路径树+标签+最近修改），作为 system prompt 片段注入 | 🔲 |
| 12 | Intent Detection — 智能模式切换提示 | Claudian 借鉴 | Chat 模式下检测到写操作意图时，提示切换管家模式 | 🔲 |
| 13 | Context Meter | ROADMAP 原 M3 | 利用 usage 事件在 UI 上显示 token 消耗和上下文使用率（已预留 contextMeterEl） | 🔲 |
| 14 | ApprovalStrategy 增强 | 调研新增 | 补 overwrite 检测 + protected folders 配置 | 🔲 |

---

### 🎨 Phase 4: 体验打磨 + 生态

目标：接近正式发布的用户体验质量，拓展 vault 交互能力。

| # | 功能 | 来源 | 状态 |
|---|------|------|------|
| 15 | 文件路径可点击打开 | ROADMAP 原 M3 | 🔲 |
| 16 | Tool call 折叠/展开优化 | ROADMAP 原 M3 | 🔲 |
| 17 | 键盘快捷键（Cmd+L/N/Esc） | ROADMAP 原 M3 | 🔲 |
| 18 | Smart Note Processing（/suggest 命令） | Claudian 借鉴 | 🔲 |
| 19 | Concept Map 生成（Mermaid） | Claudian 借鉴 | 🔲 |
| 20 | GUI Action Bridge（workspace/editor 操作） | 调研新增 | 🔲 |
| 21 | Batch Processing（多笔记批处理） | Claudian 借鉴 | 🔲 |
| 22 | 多 session tab | ROADMAP 原 M3 | 🔲 |
| 23 | 主题适配微调 | ROADMAP 原 M3 | 🔲 |

---

### 🏗️ Phase 5: 工程化

| # | 功能 | 说明 | 状态 |
|---|------|------|------|
| 24 | 单元测试 | HarnessClient, ModeManager, ApprovalStrategy 可测 | 🔲 |
| 25 | CI/CD | GitHub Actions: tsc + build + test | 🔲 |
| 26 | 自动发布 | tag → build → GitHub Release | 🔲 |
| 27 | 错误边界 | 未捕获异常不崩溃整个插件 | 🔲 |
| 28 | 性能监测 | 大 session 历史加载/渲染性能 | 🔲 |

---

## 已知 Bug

| 问题 | 严重度 | 根因 | 修复方向 | 归属 |
|------|--------|------|----------|------|
| 模式切换不实际生效 | **高** | `session.create` 未传 `agentPreset`/permission | 聊天=read-only, 管家=workspace-write, 创造=cordis preset | Phase 1 #1 |
| 历史记录跨实例混杂 | 中 | `session.list` 返回 profile 下所有 session | 客户端按 `cwd === vaultPath` 过滤 | Phase 1 #2 |
| Health check 走代理 | 中 | Obsidian `requestUrl()` 使用系统代理 | 改用 Node http 模块直连 127.0.0.1 | Phase 1 #5 |
| Approval respond 未验证 | 低 | respond 调用路径未实际触发过 | 找到触发审批的 tool call 做端到端测试 | Phase 2 #6 |

---

## 发版计划

| 版本 | 触发条件 | 发布渠道 |
|------|----------|----------|
| v0.1.0 | Phase 1 全部完成 + 2-3 天 dogfooding | GitHub Release + 提交 Obsidian 社区插件上架 PR |
| v0.2.0 | Phase 2 完成 | GitHub Release |
| v0.3.0 | Phase 3 完成 | GitHub Release |
| v1.0.0 | Phase 4 完成 + Phase 5 CI/CD 就绪 | GitHub Release + 社区更新 |

---

## 技术决策记录

| 日期 | 决策 | 原因 |
|------|------|------|
| 2026-08-28 | 改名 dshdian → Dshdian（manifest id 保持小写） | 品牌统一，大写更正式 |
| 2026-08-28 | 使用 DSH 官方鲸鱼 SVG 作为插件图标 | 品牌识别，MIT 授权 |
| 2026-08-27 | 用 Node.js `ws` 模块而非浏览器 WebSocket | Electron Origin header 被 DSH trust fence 拒绝 |
| 2026-08-27 | esbuild alias ws→index.js + Node builtins external | ws 的 package.json browser 字段指向 stub |
| 2026-08-27 | SessionEvent 数据在 `event.data` 中 | DSH 实际结构: `{ type, seq, time, data: {...} }` |
| 2026-08-26 | 独立 `Dshdian` profile (port 3180) | 避免与用户 web profile 冲突 |
| 2026-08-26 | 不自建通信协议，复用 DSH 已有 | 减少维护成本，保持兼容 |

---

## DSH Agent Preset 参考

| ID | 名称 | 适合 Dshdian 模式 |
|----|------|-------------------|
| `standard` | 标准模式 | 聊天（+ read-only）、管家（+ workspace-write） |
| `code` | PTC 模式 | — |
| `minimal` | 极简模式 | — |
| `cordis` | 创造模式 | 创造 |

DSH Permission levels: `read-only` / `workspace-write` / `danger-full-access`

---

## 调研参考

- `docs/research/claudian-comparison.md` — Claudian 对比分析（Phase 2-4 功能来源）
- `docs/research/reference-harness-like-analysis.md` — Harness Like 竞品分析
- `docs/research/ticket-2-sdk-tool-capability.md` — DSH SDK 工具能力调研
- `docs/research/ticket-3-obsidian-process-model.md` — Obsidian 进程模型调研

---

## 文件结构

```
src/
├── main.ts                     # 插件入口 + 事件分发
├── settings.ts                 # 5 组设置面板
├── types.ts                    # 共享类型
├── utils.ts                    # 工具函数
├── services/
│   ├── HarnessClient.ts        # DSH RPC + WebSocket 双流
│   ├── DshProcessManager.ts    # 进程生命周期
│   ├── ModeManager.ts          # 模式切换 + session 管理
│   ├── ReferenceResolver.ts    # @引用解析
│   ├── ApprovalStrategy.ts     # Git 感知审批
│   └── PluginGenerator.ts      # 创造模式 pipeline
└── views/
    ├── ChatPanelView.ts        # 聊天面板 UI
    └── MarkdownRenderer.ts     # Markdown 渲染辅助
```
