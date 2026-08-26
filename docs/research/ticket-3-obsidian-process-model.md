# Obsidian 桌面端插件进程模型研究报告

> 研究日期: 2026-08-26
> 状态: 完成
> 关联: Ticket #3 — dshdian 进程模型设计

---

## 摘要

Obsidian 桌面端基于 Electron，插件运行在完整的 Node.js 环境中。插件**可以** spawn 子进程、建立 WebSocket/stdio 长连接、使用 `fs`/`net`/`child_process`/`crypto` 等 Node.js API。社区审核不禁止这些能力，但要求：声明 `isDesktopOnly: true`、在 README 中披露网络使用和文件系统访问、自行负责 `onunload` 时的资源清理。

---

## 1. 插件能否 spawn 子进程（child_process）？

### 结论: ✅ 可以，无官方禁止

**技术事实:**
- Obsidian 桌面端运行在 Electron 上，插件可通过 `require('child_process')` 访问完整的 Node.js `child_process` 模块（`spawn`、`exec`、`fork`）。
- 官方 API 文档明确声明: "Import NodeJS or Electron API using `require('fs')` or `require('electron')`"（[obsidian-api README](https://github.com/obsidianmd/obsidian-api)）。

**官方限制:**
- 使用 Node.js API 的插件**必须**在 `manifest.json` 中设置 `isDesktopOnly: true`（[Submission Requirements](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Community%20directory/Submission%20requirements%20for%20plugins.md)）。
- 需在 README 中披露访问 vault 外文件或网络的行为（[Developer Policies — Disclosures](https://docs.obsidian.md/Developer+policies)）。

**社区实践案例:**

| 插件 | 用法 | 下载量 |
|------|------|--------|
| [obsidian-git](https://github.com/Vinzent03/obsidian-git) | 通过 `child_process.spawn` 调用系统 git 二进制文件 | 3M+ |
| [Shell Commands](https://community.obsidian.md/plugins/obsidian-shellcommands) | 直接执行用户自定义 shell 命令，使用 `child_process` | 高 |
| [Execute Code](https://github.com/twibiral/obsidian-execute-code) | spawn 各种语言解释器执行代码块 | 高 |
| [Claude Panel](https://community.obsidian.md/plugins/claude-panel-ryukyuhub) | spawn `claude` CLI 作为子进程 | 新 |
| [obsidian-mcp-bridge](https://github.com/prefrontalsys/obsidian-mcp-bridge) | spawn MCP server 子进程 (stdio transport) | 新 |

**Electron 特殊注意点:**
- 使用 `fork()` 时 Electron 会自动设置 `ELECTRON_RUN_AS_NODE=1`，使子进程以纯 Node.js 模式运行（不启动新 Electron 窗口）。
- macOS 打包后的 `.app` 可能找不到 `node` 二进制路径，需用 `spawn` + 绝对路径代替 `fork`（[electron#3627](https://github.com/electron/electron/issues/3627)）。

---

## 2. 插件能否建立长连接（WebSocket / stdio pipe）？

### 结论: ✅ 可以，无限制

**WebSocket:**
- 浏览器原生 `WebSocket` API 在 Electron 中完全可用，无需额外依赖。
- 社区案例:
  - [obsidian-websocket-tester-plugin](https://github.com/lawnchairsociety/obsidian-websocket-tester-plugin) — 直接使用 WebSocket 连接外部服务器
  - [peerdraft/obsidian-plugin](https://github.com/peerdraft/obsidian-plugin) — 基于 WebSocket 的 Yjs 实时协作
  - [obsidian-edge-tts](https://github.com/travisvn/obsidian-edge-tts) — 使用 WebSocket 连接 Edge TTS 服务
  - [obsidian-mcp-bridge](https://github.com/prefrontalsys/obsidian-mcp-bridge) — 支持 WebSocket transport 连接远程 MCP server

**stdio pipe:**
- 通过 `child_process.spawn` 的 `stdio: 'pipe'` 选项可建立与子进程的双向管道通信。
- obsidian-mcp-bridge 正是使用 stdio transport 与 MCP server 子进程通信的典型案例。

**Node.js `net` 模块:**
- 桌面端可使用 `require('net')` 建立 TCP 长连接。

**实践模式:**
```typescript
// WebSocket 长连接示例
class MyPlugin extends Plugin {
  private ws: WebSocket | null = null;

  onload() {
    this.ws = new WebSocket('ws://localhost:8080');
    this.ws.onmessage = (event) => { /* handle */ };
  }

  onunload() {
    this.ws?.close();
    this.ws = null;
  }
}
```

---

## 3. 插件生命周期：退出/Vault 切换时如何清理？

### 结论: ⚠️ 有生命周期 hook，但不保证 100% 执行

**生命周期方法:**

| 事件 | 方法/事件 | 触发时机 | 保证执行？ |
|------|-----------|----------|-----------|
| 插件禁用 | `onunload()` | 用户手动禁用插件 | ✅ 是 |
| Vault 切换 | `onunload()` | 用户切换到另一个 vault | ✅ 是 |
| Obsidian 退出 | `workspace.on('quit')` | 应用即将退出 | ❌ 不保证 |
| 强制关闭 | 无 | 任务管理器杀进程 / OS 回收 | ❌ 无 |

**官方文档说明:**
- `onunload()`: "Override this to unload your component and perform cleanup tasks."（[Plugin API](https://github.com/obsidianmd/obsidian-developer-docs)）
- `workspace.on('quit')`: "Triggered when the app is about to quit. **Not guaranteed to actually run.** Perform some best effort cleanup here."（[Obsidian API](https://docs.obsidian.md)）

**社区讨论确认:**
- Obsidian 论坛帖 "[Cleanup when Obsidian is closed](https://forum.obsidian.md/t/cleanup-when-obsidian-is-closed/83709)" 中，开发者确认 `onunload` 在正常退出时**不一定**被调用，且 OS 可能在应用还未完成清理时就强制杀掉进程。

**清理策略建议:**

```typescript
class MyPlugin extends Plugin {
  private childProcess: ChildProcess | null = null;

  onload() {
    // 启动子进程
    this.childProcess = spawn('my-harness', [], { stdio: 'pipe' });

    // 注册 quit 事件（尽力清理）
    this.registerEvent(
      this.app.workspace.on('quit', () => {
        this.killChild();
      })
    );

    // 使用 register() 确保 onunload 时也清理
    this.register(() => this.killChild());
  }

  onunload() {
    this.killChild();
  }

  private killChild() {
    if (this.childProcess && !this.childProcess.killed) {
      this.childProcess.kill('SIGTERM');
      this.childProcess = null;
    }
  }
}
```

**关键洞察: 子进程可能成为孤儿进程！**
- 如果 Obsidian 被强制关闭（kill -9、崩溃），子进程不会收到任何信号。
- 建议: 子进程自身实现"父进程心跳检测"或使用 PID 文件 + 启动时清理策略。

---

## 4. 插件能否监听外部进程事件？

### 结论: ✅ 可以，多种方式

**方式一: stdio pipe（推荐用于 Harness 推送）**
- 子进程通过 stdout/stdin 双向通信
- 父进程（插件）监听 `childProcess.stdout.on('data', ...)` 接收推送

**方式二: WebSocket**
- 插件作为 WebSocket client 连接到外部服务的 WebSocket server
- 外部进程主动推送事件到插件

**方式三: TCP/IPC socket**
- 使用 `net.createServer()` 在插件端开启本地 TCP 端口或 Unix domain socket
- 外部进程连接进来推送消息

**方式四: 文件系统监听**
- 使用 `fs.watch()` 或 Obsidian 的 vault 事件监听特定文件变化
- 外部进程写入文件，插件检测到变化后读取

**方式五: HTTP Server**
- 插件启动一个本地 HTTP server（如 Express 或原生 `http` 模块）
- 外部进程发 POST 请求推送事件

**社区案例:**
- obsidian-mcp-bridge: stdio pipe 双向通信 + WebSocket 远程连接
- Local REST API plugin: 在 Obsidian 内启动 HTTP server 接收外部请求
- Peerdraft: WebSocket 实时接收远程协作事件

**对 dshdian 的建议:**
- Harness 进程通过 stdio pipe 推送通知是最简单可靠的方式
- 备选: WebSocket server 在 Harness 端，插件作为 client 连接并接收推送

---

## 5. Electron 环境中 Node.js API 的可用性

### 结论: ✅ 桌面端完全可用

**可用性矩阵:**

| API | 桌面端 | 移动端 | 备注 |
|-----|--------|--------|------|
| `fs` / `fs/promises` | ✅ | ❌ | 移动端用 Capacitor adapter |
| `net` | ✅ | ❌ | TCP/IPC socket |
| `child_process` | ✅ | ❌ | spawn/exec/fork |
| `crypto` | ✅ | ⚠️ 部分 | 移动端建议用 `SubtleCrypto` |
| `path` | ✅ | ❌ | |
| `os` | ✅ | ❌ | |
| `http` / `https` | ✅ | ❌ | 移动端用 `fetch` |
| `electron` (safeStorage 等) | ✅ | ❌ | |
| `WebSocket` (浏览器 API) | ✅ | ✅ | 跨平台 |
| `fetch` | ✅ | ✅ | 跨平台 |

**使用方式:**
```typescript
// 正确方式：动态 require + 平台检查
import { Platform } from 'obsidian';

if (Platform.isDesktopApp) {
  const { spawn } = require('child_process');
  const fs = require('fs');
  // 使用 Node.js API
}
```

**官方要求:**
- 不要在顶层 `import`/`require` Node.js 模块，应在 `Platform.isDesktopApp` 检查后动态加载（[Plugin Self-Critique Checklist](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Obsidian%20October%20plugin%20self-critique%20checklist.md)）。
- 不要使用 `process.platform`，应使用 Obsidian 的 `Platform` 工具类。
- `Vault.adapter` 不要强制转换为 `FileSystemAdapter`，应先 `instanceof` 检查。

---

## 6. 社区插件审核对子进程和网络连接的态度

### 结论: ✅ 允许，但需披露和声明

**审核机制:**

1. **自动化扫描**: Obsidian 自动扫描每个插件版本的安全漏洞、代码质量问题和恶意软件。结果显示为"safety scorecard"。
2. **人工审核**: 热门、推荐和被举报的插件会进行人工审核。
3. **新插件提交**: 所有新插件 PR 需通过 ReviewBot 自动验证 + 人工审核（当前积压约 3 个月）。

**与子进程/网络相关的政策要求:**

| 要求 | 来源 | 详情 |
|------|------|------|
| `isDesktopOnly: true` | Submission Requirements | 使用 Node.js/Electron API 必须设置 |
| 披露网络使用 | Developer Policies — Disclosures | README 中说明使用了哪些远程服务及原因 |
| 披露 vault 外文件访问 | Developer Policies — Disclosures | README 中说明为什么需要 |
| 不得混淆代码 | Developer Policies — Not Allowed | 代码不得故意混淆 |
| 不得包含自更新机制 | Developer Policies — Not Allowed | 不能绕过官方更新流程 |
| 不得包含客户端遥测 | Developer Policies — Not Allowed | 不能偷偷收集数据 |
| 无"不可动态加载远程代码"限制 | — | 没有明确禁止通过子进程执行外部程序 |

**关键引用:**

> "Due to technical limitations, Obsidian cannot reliably restrict plugins to specific permissions or access levels. This means that plugins will inherit Obsidian's access levels."
> — [Plugin Security](https://obsidian.md/help/plugin-security)

> "Community plugins can access files on your computer. Community plugins can connect to internet. Community plugins can install additional programs."
> — [Plugin Security](https://obsidian.md/help/plugin-security)

**没有被禁止的事项:**
- spawn 子进程 ✅（只要声明 desktop-only）
- 网络连接 ✅（只要 README 披露）
- 安装外部程序 ✅（只要 README 披露）
- 访问 vault 外文件 ✅（只要 README 披露）
- 长连接（WebSocket / TCP） ✅

---

## 7. 对 dshdian 项目的影响和建议

### 架构可行性确认

dshdian 项目计划中的以下能力在 Obsidian 桌面插件中**完全可行**:

| 能力需求 | 可行性 | 实现方式 |
|----------|--------|----------|
| spawn Harness 子进程 | ✅ | `child_process.spawn` |
| 通过 stdio pipe 双向通信 | ✅ | `spawn` + `stdio: 'pipe'` |
| 接收 Harness 主动推送 | ✅ | 监听 `childProcess.stdout` |
| 进程清理 | ⚠️ | `onunload` + `workspace.on('quit')` + 心跳 |
| WebSocket 备选通道 | ✅ | 浏览器原生 `WebSocket` |

### 设计建议

1. **进程管理必须防御孤儿进程**
   - 在 Harness 侧实现"父进程心跳检测"：如果 N 秒没收到心跳，自行退出
   - 或者: 插件启动时检查是否有上次遗留的 Harness 进程（PID 文件），先清理再启动新的
   - `onunload` 时发 SIGTERM；`workspace.on('quit')` 时再做一次尽力清理

2. **通信协议选择**
   - 首选 stdio pipe (JSON-RPC 或 NDJSON): 简单、无端口冲突、进程绑定
   - 备选 WebSocket: 用于解耦场景（Harness 独立于 Obsidian 运行时）
   - 不建议: HTTP 轮询（延迟高、浪费资源）

3. **manifest.json 配置**
   ```json
   {
     "isDesktopOnly": true
   }
   ```

4. **README 披露项**
   - 声明插件会 spawn 外部子进程（Harness）
   - 声明网络使用（如 Harness 需要连接外部 API）
   - 说明进程清理策略

5. **平台兼容性**
   - 动态 `require('child_process')`，不在顶层导入
   - 使用 `Platform.isDesktopApp` 守护所有 Node.js 代码路径
   - macOS 注意 PATH 问题: Electron app 可能找不到系统命令，需传入完整路径或设置 `env.PATH`

6. **参考实现**
   - obsidian-git: 成熟的 `child_process.spawn` + 进程管理模式
   - obsidian-mcp-bridge: stdio/WebSocket 双 transport + 超时/重试
   - Shell Commands: 完整的 shell 执行 + 事件触发框架

### 风险点

| 风险 | 等级 | 缓解策略 |
|------|------|----------|
| 孤儿进程 | 高 | Harness 心跳自杀 + PID 文件清理 |
| macOS PATH 问题 | 中 | 配置 Harness 绝对路径或 bundle 到插件目录 |
| 审核延迟（~3 个月积压） | 中 | 可先以手动安装方式发布 beta |
| `quit` 事件不保证执行 | 中 | 多层防御（onunload + quit + 心跳） |
| 移动端不可用 | 低 | 项目本身就是 desktop-only |

---

## 参考来源

1. [Obsidian API — obsidianmd/obsidian-api](https://github.com/obsidianmd/obsidian-api) — "Import NodeJS or Electron API using require('fs') or require('electron')"
2. [Submission requirements for plugins](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Community%20directory/Submission%20requirements%20for%20plugins.md) — isDesktopOnly 要求
3. [Developer policies](https://docs.obsidian.md/Developer+policies) — 披露要求和禁止事项
4. [Plugin security](https://obsidian.md/help/plugin-security) — "plugins can access files, connect to internet, install additional programs"
5. [Plugin lifecycle — Manage plugin lifecycle](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Guides/Manage%20plugin%20lifecycle.md) — onunload, registerEvent, register
6. [Cleanup when Obsidian is closed — Forum](https://forum.obsidian.md/t/cleanup-when-obsidian-is-closed/83709) — workspace.on('quit') 不保证执行
7. [obsidian-git](https://github.com/Vinzent03/obsidian-git) — child_process.spawn 实践（3M+ 下载）
8. [Shell Commands plugin](https://community.obsidian.md/plugins/obsidian-shellcommands) — child_process 执行 shell 命令
9. [obsidian-mcp-bridge](https://github.com/prefrontalsys/obsidian-mcp-bridge) — stdio + WebSocket 双 transport
10. [Plugin self-critique checklist](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Obsidian%20October%20plugin%20self-critique%20checklist.md) — 动态 require、Platform 检查
11. [Electron child_process guide](https://www.matthewslipper.com/2019/09/22/everything-you-wanted-electron-child-process.html) — Electron 中 fork/spawn 行为差异
