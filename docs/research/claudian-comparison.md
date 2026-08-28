# Claudian 对比分析

> 调研日期：2026-08-28
> 对象：[Enigmora/claudian](https://github.com/Enigmora/claudian) — Obsidian 的 Claude AI 集成插件
> 目的：识别可借鉴设计、冲突决策、以及 Dshdian 缺失的高价值功能

## 1. 项目概况

Claudian 将 Anthropic Claude API 直接内嵌到 Obsidian，提供：
- 聊天面板（流式渲染）
- Agent Mode（52 种 vault action + agentic loop）
- Smart Note Processing（标签/链接建议）
- Batch Processing（多笔记模板提取）
- Concept Map 生成（Mermaid）
- Model Orchestrator（Haiku 分类 → 路由到 Haiku/Sonnet/Opus）
- Token Tracker + Context Meter
- 多语言 i18n（en/es/zh/de/fr/ja）

核心区别：Claudian 是**插件直连 API**，所有智能都在插件内实现；Dshdian 是**外部 Harness 进程的 UI 桥接 + 能力扩展**。

## 2. 设计冲突点评估

### 2.1 Vault 操作执行方式

| | Claudian | Dshdian |
|--|----------|---------|
| 方式 | 52 种 VaultActionExecutor，直接调 Obsidian API | Harness 通过 Obsidian CLI 执行 |
| 优点 | 零延迟、原子性、能操作 Editor/Canvas/Search 等 GUI 对象 | 解耦彻底、DSH 升级自动获得新工具 |
| 缺点 | 每新增 action 需插件更新 | CLI 无法操作 GUI 对象（光标、canvas、split leaf 等） |

**决策**：保持 CLI 作为文件操作主路径，但增加轻量 "GUI Action Bridge"——让 DSH 可请求插件执行 Obsidian API 独有的 workspace/editor 操作。解耦 + GUI 能力兼得。

### 2.2 破坏性操作确认

| | Claudian | Dshdian |
|--|----------|---------|
| 方式 | 静态列表（4 种 action）+ overwrite 检测 | Git-aware 动态策略 + 危险操作强制确认 |
| 优点 | 简单直观 | 更智能——有 Git 时减少摩擦 |
| 缺点 | 所有环境一刀切 | 缺少 overwrite 检测和 protected paths |

**决策**：Dshdian 的 Git-aware 策略更优，保持。补充：
1. Overwrite 检测（写入已存在文件时升级确认级别）
2. Protected folders 配置（settings 中可配置受保护目录）

### 2.3 AI 模型路由

| | Claudian | Dshdian |
|--|----------|---------|
| 方式 | Haiku 先分类复杂度 → 路由模型 | 委托 DSH runtime 管理模型选择 |

**决策**：不冲突——架构分层不同。Dshdian 正确地将模型路由留给 DSH。保持现状。

### 2.4 上下文管理

| | Claudian | Dshdian |
|--|----------|---------|
| 方式 | ContextManager：阈值触顶 → Haiku 摘要 → 老消息存磁盘 | Session 级管理，依赖 DSH 内部上下文 |

**决策**：不冲突。DSH 内部有 context 管理。Dshdian 只需在 UI 层展示 context 使用情况（context meter）。

## 3. 高价值可借鉴功能

### 🔴 高优先级

#### 3.1 Vault Indexer — 自动 vault 结构注入

Claudian 启动时索引 vault 的文件结构、标签、链接关系，每次对话自动注入为上下文。

- **痛点**：Dshdian 当前 @引用是手动的，不 @ 就没上下文
- **建议**：启动时生成 vault 结构摘要（路径树 + 标签图 + 最近修改），作为 system prompt 自动注入 session

#### 3.2 Approval UI（确认 Modal + 进度条）

Claudian 检测到破坏性操作时弹确认 Modal，批量执行时显示进度条。

- **痛点**：Dshdian 的 ApprovalStrategy 有 decision 逻辑，但 UI 层未实现
- **建议**：ChatPanelView 中添加 approval dialog（响应 approval/requested 帧）和操作进度条

#### 3.3 Agent Loop 可视化（Thinking + Actions + Results）

Claudian 渲染 thinking 过程、actions 列表、执行结果（✓/✗）。

- **痛点**：Dshdian 只渲染最终文本，StreamChunk 中的 reasoning-delta/tool-call 信息未呈现
- **建议**：利用已有 StreamChunk 类型，渲染折叠式思考过程和工具调用卡片

#### 3.4 消息操作按钮（Copy / Save as Note / Retry）

- **痛点**：用户经常想复制或保存 AI 回答
- **建议**：每条 assistant bubble 底部加 icon buttons，实现成本极低

### 🟡 中优先级

#### 3.5 Smart Note Processing（标签/链接建议）

分析当前笔记，基于 vault 结构推荐 tags 和 wikilinks。

- **建议**：管家模式预置 "/suggest" 命令，触发 DSH 分析当前笔记

#### 3.6 Concept Map 生成

从选定笔记生成 Mermaid 概念图。

- **建议**：管家模式的 Workflow，输出 Mermaid 代码块

#### 3.7 Context Meter

UI 上显示 token 消耗和上下文使用率。

- **状态**：ChatPanelView 已预留 `contextMeterEl`
- **建议**：利用 StreamChunk 的 usage 事件更新

#### 3.8 Vault Action Intent Detection（智能模式切换提示）

检测用户消息中的动作意图，在只读模式下发出写操作意图时提示切换。

- **建议**：sendMessage 前做关键词检测，提示用户切换到管家/创造模式

### 🟢 低优先级

#### 3.9 对话历史持久化

- **状态**：已有 `onShowHistory` handler 和 `session.list` API，未实现 UI

#### 3.10 Protected Folders 配置

- **建议**：settings 中加 textarea，ApprovalStrategy 对这些路径强制 Confirm

#### 3.11 Batch Processing（多笔记批处理）

- **建议**：管家模式高级功能——选择文件夹/标签范围后 DSH 逐个处理

## 4. 另一个相关项目：DeepHarness (cjs19890026)

同日调研了 [dsh-obsidian-DeepHarness](https://github.com/cjs19890026-cmyk/dsh-obsidian-DeepHarness)。

关键差异：
- 进程模型：`dsh --profile headless` 一次性子进程 vs Dshdian 的常驻 HTTP 服务
- 无 Session、无流式、无模式系统、无审批、无插件生成
- 本质是"终端模拟器"式集成，Dshdian 架构明显更先进

可借鉴的点：
- `--patch <vault.yml>` 注入 vault 配置的思路（简洁的上下文传递）
- Chip Editor（@引用的另一种 UI 实现）

## 5. 总结

| 维度 | Dshdian 优势 | 需补齐 |
|------|-------------|--------|
| 架构 | 事件驱动、Session 持久、模式系统 | — |
| 安全 | Git-aware 审批 | overwrite 检测、protected paths、审批 UI |
| UI | @引用 pill、模式切换 | 确认框、进度条、thinking 渲染、消息按钮、context meter、历史面板 |
| 功能 | 插件生成（独有） | vault indexer、intent detection、note processing |

**最大差距不在架构，而在 UI 完成度和 vault 交互广度。** 优先补上"审批 UI + thinking 渲染 + 消息按钮 + vault indexer"四项，即可在体验上追平 Claudian 同时保持架构和定位优势。
