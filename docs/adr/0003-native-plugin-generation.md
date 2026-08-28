# ADR-0003: 生成独立 Obsidian 原生插件而非 Cordis 插件

## Status

已接受 — 2026-08-26

## Context

Harness Like 通过 Cordis 运行时加载生成的插件（`new Function`），插件依赖 Harness Like 才能运行，无法独立使用。我们需要决定 Dshdian 创造模式生成的插件格式。

## Decision

Dshdian 的创造模式生成标准 Obsidian 原生插件（`manifest.json` + `main.js`），使用 TypeScript 生成 + 内置 esbuild 编译，生成物完全独立于 Dshdian。

## Consequences

- **正面**：生成的插件可在任何 vault 独立运行，不依赖 Dshdian；符合 Obsidian 社区标准，可直接发布。
- **负面**：实现复杂度更高（需要完整 Plugin API 知识）；需要预览机制（临时目录热加载）；版本管理走 vault git。
