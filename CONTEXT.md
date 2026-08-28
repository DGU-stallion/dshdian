# CONTEXT — Dshdian

> Obsidian 插件，将 DSH（DeepSeek Harness）作为 AI 协作者嵌入笔记工作流，同时充当原生插件工厂。

## 定位

- 在 Obsidian 内提供完整的 DSH 原生体验
- 通过 Creator 模式生成**独立的** Obsidian 原生插件（不依赖 Dshdian 运行）
- 竞品：DSH Bridge (skysky)、Harness Like (frank6com)、Claudian
- 差异化：生成独立原生插件（非 Cordis 插件）、多 Agent 体系、完整 DSH 集成

## 架构概览

```
Obsidian ←HTTP API + SSE→ Harness 进程 (port 3180)
```

- 外部 Harness 进程，非内嵌；无 MCP Server
- Vault 操作通过 Obsidian CLI（`obsidian` 命令行工具）
- @引用通过前端上下文注入实现
- 插件预览通过监听 Session 事件实现

## 四层能力模型

| 层 | 职责 |
|---|---|
| 1. DSH 嵌入层 | Chat Panel、@引用、/命令、Skill、Prompt 模板、工具审批、Session 管理 |
| 2. 多 Agent 层 | 3 种内置模式 + Workflow Agent + 自定义 Agent（存储于 vault） |
| 3. 原生插件生成层 | TypeScript 生成 → esbuild 编译 → 预览 → 确认安装；源码在 `.obsidian/plugins/dshdian/generated/`；Git 版本管理 |
| 4. 灵感管理（旗舰，post-MVP） | 由第 3 层生成为独立插件 |

## Glossary

| 术语 | 定义 |
|------|------|
| **Dshdian** | 本项目——Obsidian 插件本体 |
| **DSH / Harness** | DeepSeek Harness，外部 AI Agent 运行时进程 |
| **模式（Mode）** | 3 种内置 Agent 预设：聊天、管家、创造 |
| **聊天模式** | 自由对话，等同 DSH 原生聊天体验 |
| **管家模式** | 面向 vault 维护的自动化任务（整理、归档、关联） |
| **创造模式** | 生成 Obsidian 原生插件的专用模式 |
| **Workflow Agent** | 按钮触发的非对话式 Agent（如打标签、建关联），结果显示在 Chat Panel |
| **自定义 Agent** | 用户在 vault 中定义的 Agent 配置 |
| **Generated Plugin** | 由创造模式产出的独立 Obsidian 原生插件，运行不依赖 Dshdian |
| **Preview（预览）** | 在 `_dshdian_preview/` 临时目录加载插件供用户验证 |
| **Obsidian CLI** | `obsidian` 命令行工具，Harness 通过它执行 vault 文件操作 |
| **Git-aware Approval** | 基于 vault Git 状态动态调整的权限等级——有 Git 时宽松（可回滚），无 Git 时严格 |
| **@引用** | 用户在聊天中通过 `@` 引用笔记/文件夹/标签，前端注入为上下文 |
| **Session** | 一次 Harness 会话，包含消息流和工具调用事件 |

## Domain Rules

1. **Generated Plugin 独立性**：生成的插件不得 import Dshdian 的任何模块，必须作为独立插件运行。
2. **Harness 生命周期由 Dshdian 管理**：Dshdian 负责启动、健康检查、重连外部 Harness 进程。
3. **Vault 操作走 CLI**：Harness 不直接读写文件系统，所有 vault 操作通过 Obsidian CLI 执行。
4. **预览隔离**：Preview 在 `_dshdian_preview/` 加载，不影响正式插件目录；用户确认后才安装到 `.obsidian/plugins/`。
5. **Git-aware 审批**：vault 有 Git 时工具调用自动批准（用户可回滚）；无 Git 时高风险操作需手动确认。
6. **源码归档**：生成插件的 TypeScript 源码保存在 `.obsidian/plugins/dshdian/generated/<plugin-id>/`，用 Git 管理版本。
7. **通信协议**：Dshdian → Harness 用 HTTP POST；Harness → Dshdian 用 SSE 推送事件流。
8. **模式互斥**：同一时刻只有一个活跃模式，切换模式会结束当前 Session。
