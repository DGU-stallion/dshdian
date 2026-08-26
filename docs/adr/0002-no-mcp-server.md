# ADR-0002: 不内嵌 MCP Server，操作走 Obsidian CLI

## Status

已接受 — 2026-08-26

## Context

原方案计划在 dshdian 内嵌 MCP Server，暴露 Vault 工具给 Harness。但 Obsidian 官方 CLI 已提供完整的 vault 操作能力（创建/编辑笔记、搜索、管理附件等），内嵌 MCP Server 会引入额外的 schema 维护负担。

## Decision

去掉 MCP Server。Agent 通过 DSH shell tool 调用 Obsidian CLI 操作 vault；`@` 引用通过前端 context 注入；插件预览通过 session event 监听。

## Consequences

- **正面**：架构大幅简化；不需要维护 MCP schema 与 CLI 的映射层。
- **负面**：Agent 需要 system prompt 预置 CLI 用法说明；Obsidian 必须处于运行状态才能执行操作。
