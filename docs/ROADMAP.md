# 开发规划 — dshdian

> 最后更新: 2026-08-27

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

---

### 🔨 M2: 功能完善 — 让 MVP 真正可用

目标：修复已知 Bug，补齐核心体验缺失项。

| 功能 | Issue | 优先级 | 状态 |
|------|-------|--------|------|
| 模式↔权限/preset 映射 | 待创建 | P0 | 🔲 |
| 历史记录 cwd 过滤（隔离 vault） | 待创建 | P1 | 🔲 |
| 流式 Markdown 实时渲染 | #25 | P1 | 🔲 |
| Session title 显示 | 待创建 | P1 | 🔲 |
| Question 交互 UI（agent 提问） | 待创建 | P1 | 🔲 |
| Health check 绕过代理 | #26 | P2 | 🔲 |
| 对话持久化/恢复（重启后恢复 session） | 待创建 | P2 | 🔲 |
| Approval respond 验证 | 待创建 | P2 | 🔲 |
| PR #21 合并到 main | — | P0 | 🔲 |
| README 更新（标记 MVP 完成） | — | P1 | 🔲 |

---

### 🎨 M3: 体验打磨

目标：接近正式发布的用户体验质量。

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 代码块一键复制按钮 | P2 | assistant 回复的 ``` 代码块右上角加复制 icon |
| 文件路径可点击打开 | P2 | tool/call 中的路径点击后在 Obsidian 打开 |
| Tool call 折叠/展开优化 | P2 | 折叠=名称+状态图标，展开=完整 input/output |
| Workspace 集成 | P2 | 为 vault 自动创建 DSH workspace，session 归属管理 |
| Token 用量显示 | P3 | 用 session/projection 的 tokenUsage 显示用量条 |
| 键盘快捷键 | P3 | Cmd+L 聚焦输入, Cmd+N 新对话, Esc 取消流 |
| 多 session tab | P3 | 同时打开多个会话 |
| 主题适配微调 | P3 | 暗色/亮色主题下的边缘 case |

---

### 🏗️ M4: 架构 & 工程化

| 项目 | 说明 |
|------|------|
| 单元测试 | HarnessClient, ModeManager, ApprovalStrategy 可测 |
| CI/CD | GitHub Actions: tsc + build + test |
| 自动发布 | tag → build → GitHub Release |
| 错误边界 | 未捕获异常不崩溃整个插件 |
| 性能监测 | 大 session 历史加载/渲染性能 |

---

## 已知 Bug

| 问题 | 严重度 | 根因 | 修复方向 |
|------|--------|------|----------|
| 模式切换不实际生效 | **高** | `session.create` 未传 `agentPreset`/permission | 聊天=read-only, 管家=workspace-write, 创造=cordis preset |
| 历史记录跨实例混杂 | 中 | `session.list` 返回 profile 下所有 session | 客户端按 `cwd === vaultPath` 过滤 |
| Health check 走代理 | 中 | Obsidian `requestUrl()` 使用系统代理 | 改用 Node http 模块直连 127.0.0.1 |
| Approval respond 未验证 | 低 | respond 调用路径未实际触发过 | 找到触发审批的 tool call 做端到端测试 |

---

## 技术决策记录

| 日期 | 决策 | 原因 |
|------|------|------|
| 2026-08-27 | 用 Node.js `ws` 模块而非浏览器 WebSocket | Electron Origin header 被 DSH trust fence 拒绝 |
| 2026-08-27 | esbuild alias ws→index.js + Node builtins external | ws 的 package.json browser 字段指向 stub |
| 2026-08-27 | SessionEvent 数据在 `event.data` 中 | DSH 实际结构: `{ type, seq, time, data: {...} }` |
| 2026-08-26 | 独立 `dshdian` profile (port 3180) | 避免与用户 web profile 冲突 |
| 2026-08-26 | 不自建通信协议，复用 DSH 已有 | 减少维护成本，保持兼容 |

---

## DSH Agent Preset 参考

| ID | 名称 | 适合 dshdian 模式 |
|----|------|-------------------|
| `standard` | 标准模式 | 管家 (+ workspace-write permission) |
| `code` | PTC 模式 | — |
| `minimal` | 极简模式 | — |
| `cordis` | 创造模式 | 创造 |

DSH Permission levels: `read-only` / `workspace-write` / `danger-full-access`

聊天模式建议：`standard` preset + `read-only` permission

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
