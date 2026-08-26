# ADR-0001: 使用外部 Harness 进程而非进程内 Cordis

## Status

已接受 — 2026-08-26

## Context

参考项目 Harness Like 采用进程内 Cordis 运行时，将 AI runtime 嵌入插件进程。我们需要决定 dshdian 的 AI runtime 部署方式：是像 Harness Like 一样在进程内运行 Cordis，还是依赖外部进程。

## Decision

选择外部 DSH Harness 进程（端口 3180），dshdian 作为 thin client 通过 HTTP API + SSE 与之通信。

## Consequences

- **正面**：插件更轻量，职责单一；可复用 DSH Web UI 的全部能力（模型管理、会话历史、工具注册等）。
- **负面**：进程管理复杂度增加（需要处理 spawn、心跳检测、锁文件）；要求用户环境已安装 DSH。
