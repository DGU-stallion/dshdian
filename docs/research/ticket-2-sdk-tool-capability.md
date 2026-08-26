> ⚠️ 本研究的 MCP Server 结论已被 ADR-0002 废弃。dshdian 不再内嵌 MCP Server，改为通过 Obsidian CLI 操作 vault。本文档保留作为技术调研记录。

# Ticket-2: DeepSeek Harness SDK/协议外部工具注册能力研究

> 研究日期：2026-08-26
> 状态：完成

---

## 摘要

本报告调研 DeepSeek Harness 是否支持外部进程（如 Obsidian 插件）在运行时动态注册工具并参与 Agent 循环。结论：**SDK Client 模式不直接支持外部工具注册，但 MCP Server 机制（`@deepseek-ai/dsh-mcp-client`）完整支持所有五项能力。对 dshdian 项目而言，实现一个 MCP Server 是最可行路径。**

---

## 一、能力点逐项评估

### 1. 外部进程在运行时向 Harness 动态注册工具

**结论：✅ 支持（通过 MCP Server 机制）**

| 路径 | 可行性 | 说明 |
|------|--------|------|
| SDK Client (`dsh-sdk-client`) | ❌ 不支持 | SDK Client 是"驱动者"角色——spawn 一个 Harness 子进程并发 prompt，**不能向已运行的 Harness 实例注册工具** |
| 进程内 Cordis 插件 (`ctx.tools.register`) | ✅ 支持 | 同进程内调用 `ctx.tools.register(definition)` 即可动态注册，返回 dispose 函数 |
| MCP Server (Streamable HTTP) | ✅ 支持 | 外部进程实现 MCP Server → Harness 通过 `@deepseek-ai/dsh-mcp-client` 连接 → 自动发现并注册为 `mcp__<serverName>__<toolName>` |
| MCP Server (stdio) | ✅ 支持 | Harness spawn 外部进程作为 MCP Server |

**API 引用：**

```typescript
// 进程内模式
ctx.tools.register(defineTool({
  name: 'greet',
  description: 'Greet the named person.',
  parameters: { name: { type: 'string', required: true } },
  output: { schema: { type: 'string' }, render: (_args, v) => [{ type: 'text', text: v }] },
  async execute(args) { return `Hello, ${args.name}!` },
}))
```

```yaml
# MCP Server 配置 (cordis.patch.yml)
- id: mcp-obsidian
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    transport: streamable-http
    serverName: obsidian
    url: http://localhost:3847/mcp
    toolCallTimeoutMs: 30000
    reconnect:
      enabled: true
      initialDelayMs: 500
      maxDelayMs: 30000
      maxAttempts: 10
```

---

### 2. Harness Web UI 中的会话能够调用这些外部注册的工具

**结论：✅ 支持**

通过 MCP 注册的工具自动出现在 Harness 的 tool registry 中，命名为 `mcp__<serverName>__<toolName>`。Agent 循环在 prompt assembly 阶段会将所有已注册工具（包括 MCP 来源的）组装进 tool catalog 发送给模型。

**关键约束：**
- Web UI 的 **Standard** 和 **Code** 模式暴露 MCP 工具
- **Minimal** 模式仅暴露 `bash` 和 `str_replace_editor`，隐藏 MCP 工具
- 工具调用经过完整的 permission/approval 管道

**证据来源：** Composio 集成文档明确描述："Open `localhost:1420` and start a session on Standard or Code mode. Composio's tools register as `mcp__composio__<tool>`. Ask DeepSeek Harness to connect to [service] or request any [service]-related task."

---

### 3. 工具调用结果从外部进程返回给 Harness 并继续 Agent 循环

**结论：✅ 支持**

MCP 协议本身定义了完整的 tool call → result 流程：

1. Agent 循环决定调用 `mcp__obsidian__read_note`
2. Harness 的 `dsh-mcp-client` 将调用通过 MCP 协议转发给外部 MCP Server
3. 外部 Server 执行并返回结果
4. `dsh-mcp-client` 将结果注入 Agent 循环的 observation 队列
5. Agent 循环继续下一 turn

**超时处理：**
- `toolCallTimeoutMs` 配置每次调用的超时（默认 60000ms）
- 超时后 Harness 视为工具调用失败，Agent 循环收到错误结果

**执行管道：** 调用经过 validation → permission → execution → post-processing → durable result logging 完整管道。

---

### 4. 连接断开和重连时工具注册如何恢复

**结论：✅ 有明确的自动重连机制**

`@deepseek-ai/dsh-mcp-client` 内置 `ReconnectConfig`：

```typescript
interface ReconnectConfig {
  /** 自动重连开关（默认 true） */
  enabled?: boolean
  /** 首次重连延迟，后续指数退避（默认 500ms） */
  initialDelayMs?: number
  /** 退避上限 & uptime 重置阈值（默认 30000ms） */
  maxDelayMs?: number
  /** 连续失败上限（默认 10 次） */
  maxAttempts?: number
}
```

**行为细节：**

| 传输方式 | 断开触发 | 重连行为 |
|----------|----------|----------|
| stdio | 子进程退出/崩溃 | 重新 spawn 进程，重新发现工具 |
| streamable-http | HTTP 连接失败 / SSE 流断开 | 指数退避重连，重新 `tools/list` 发现工具 |

**重连后工具恢复：**
- 重连成功后自动重新调用 MCP `tools/list` 获取工具列表
- 如果 `serverName` 不变，工具名保持一致（`mcp__obsidian__<tool>`）
- 热重载支持：编辑配置触发 disconnect → reconnect 而不重启 dsh 进程
- 文档明确说明："Keep `serverName` stable across edits — changing it changes every tool name the model sees for that server."

**已知限制（官方 README 记录）：**
- stdio 的重连由 supervisor 触发进程重启
- HTTP 的重连依赖 SDK 的 SSE-stream recovery，而非 supervisor-led respawn

---

### 5. 其他官方机制（MCP server、插件系统、webhook）

**结论：MCP Server 是首选官方机制，另有 Cordis 插件和 A2A 两条路径**

| 机制 | 成熟度 | 适用场景 |
|------|--------|----------|
| **MCP Server (streamable-http)** | ✅ 生产可用 | 外部进程暴露工具给 Harness，跨进程，最佳隔离 |
| **MCP Server (stdio)** | ✅ 生产可用 | Harness spawn 外部进程，子进程模型 |
| **Cordis 进程内插件** | ✅ 生产可用 | 同进程内注册，最低延迟，但需要共享进程 |
| **A2A (Agent-to-Agent)** | 🟡 社区插件 | `dsh-a2a` 提供 Agent 网格互联 |
| **ACP (Agent Communication Protocol)** | 🟡 社区插件 | `deepseek-harness-acp` 暴露 DSH agent 给 Zed 等 |
| **Webhook** | ❌ 无原生支持 | 无直接 webhook 机制 |
| **Web Extension API** | ❌ 无 | Web UI 无插件扩展接口 |

**MCP Server 的官方地位：**
- `@deepseek-ai/dsh-mcp-client` 是 deepseek-harness 官方 monorepo 的一部分
- 文档明确："MCP in dsh isn't experimental or half-finished"
- 支持两种传输协议，有完整重连策略
- **限制**：仅桥接 MCP Tools，MCP Resources 和 Prompts 能力不支持（显式标记为 deferred）

---

## 二、对 dshdian 项目的影响和建议

### 2.1 推荐架构：Obsidian 插件 = MCP Server

```
┌──────────────────────────────────────────────────┐
│                  用户桌面                          │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────┐   MCP (HTTP)    ┌──────────────────┐
│  │   DeepSeek Harness │ ◄──────────────► │  Obsidian 插件   │
│  │   (dsh web)        │   localhost:3847  │  (MCP Server)    │
│  │                    │                  │                  │
│  │  Agent 循环        │   tools/list     │  vault-tools     │
│  │  Web UI            │   tools/call     │  editor-tools    │
│  │  Session Log       │   ◄───────────►  │  plugin-tools    │
│  └────────────────────┘                  └──────────────────┘
│                                                  │
└──────────────────────────────────────────────────┘
```

### 2.2 为什么选 MCP Server 而非进程内 Cordis

| 维度 | MCP Server (HTTP) | 进程内 Cordis |
|------|-------------------|---------------|
| 进程隔离 | ✅ 独立进程 | ❌ 共享 Electron 进程 |
| 崩溃隔离 | ✅ MCP Server 崩溃不影响 Harness | ❌ 崩溃冻结 Obsidian |
| 部署灵活性 | ✅ 可独立升级 | ❌ 版本耦合 |
| 官方支持 | ✅ 官方 monorepo 包 | ✅ 官方 API |
| 延迟 | 🟡 本地 HTTP ~1-5ms | ✅ 函数调用 <0.1ms |
| 复杂度 | 🟡 需实现 MCP Server | ✅ 直接调用 |
| Web UI 集成 | ✅ 工具自动出现 | ✅ 工具自动出现 |

**推荐：MCP Server (streamable-http)**。理由：
1. Obsidian 是 Electron 应用，主进程稳定性至关重要
2. dshdian 的前置研究已确认参考项目选择了进程内 Cordis，我们可以走差异化路线
3. MCP 是行业标准协议，未来可复用给其他 Agent（Cursor、Claude Code 等）
4. 断线重连已内置，不需要自己实现

### 2.3 实现方案草图

**Obsidian 插件侧（MCP Server）：**

```typescript
// Obsidian 插件 onload() 启动 MCP Server
import { McpServer } from '@modelcontextprotocol/sdk/server'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamablehttp'

class DshdianPlugin extends Plugin {
  private mcpServer: McpServer

  async onload() {
    this.mcpServer = new McpServer({ name: 'obsidian', version: '0.1.0' })

    // 注册 Vault 工具
    this.mcpServer.tool('read_note', { path: z.string() }, async ({ path }) => {
      const content = await this.app.vault.read(this.app.vault.getFileByPath(path))
      return { content: [{ type: 'text', text: content }] }
    })

    this.mcpServer.tool('list_notes', { folder: z.string().optional() }, async ({ folder }) => {
      const files = this.app.vault.getMarkdownFiles()
      // ...filter by folder...
      return { content: [{ type: 'text', text: JSON.stringify(paths) }] }
    })

    // 启动 HTTP transport
    const transport = new StreamableHTTPServerTransport({ port: 3847 })
    await this.mcpServer.connect(transport)
  }

  onunload() {
    this.mcpServer?.close()
  }
}
```

**Harness 侧配置（`~/.dsh/profiles/web/cordis.patch.yml`）：**

```yaml
insert:
  - id: mcp-obsidian
    name: '@deepseek-ai/dsh-mcp-client'
    config:
      transport: streamable-http
      serverName: obsidian
      url: http://localhost:3847/mcp
      toolCallTimeoutMs: 30000
      failOnStartupError: false
      reconnect:
        enabled: true
        initialDelayMs: 500
        maxDelayMs: 30000
        maxAttempts: 10
```

### 2.4 需要解决的问题

| 问题 | 方案 |
|------|------|
| Obsidian 启动时 Harness 可能未连接 | `failOnStartupError: false` + `reconnect.enabled: true` |
| Obsidian 重启后 Harness 需重新发现工具 | 重连自动触发 `tools/list`，工具自动恢复 |
| 端口冲突 | 使用可配置端口 + 写入约定文件（类似 `~/.dsh/mcp-manager.json`） |
| 多 Vault 同时运行 | 每个 Vault 使用不同端口/serverName |
| 认证 | 本地回环连接可选 token header 或无认证 |
| 动态工具变更（子插件注册新工具） | MCP 协议支持 `notifications/tools/list_changed` 通知 → Harness 重新 `tools/list` |

### 2.5 动态工具注册的关键：`notifications/tools/list_changed`

当 dshdian 的子插件通过自然语言创建并注册了新工具时：

1. 子插件调用 `ctx.toolsCompat.register(...)` 注册到 Obsidian 插件内部
2. Obsidian 的 MCP Server 收到注册事件
3. MCP Server 发送 `notifications/tools/list_changed` 给 Harness
4. Harness 的 `dsh-mcp-client` 重新调用 `tools/list`
5. 新工具出现在 Web UI 的 tool catalog 中

这意味着**工具可以在会话中途动态增减**，无需重启任何进程。

### 2.6 与前期研究的对齐

前期研究（`docs/research-dsh-integration.md`）确认了两种模式：
- **进程内 Cordis**：参考项目 obsidian-harness-like 选择的路径
- **SDK Client**：spawn 子进程 + stdio JSON-RPC

本研究新增第三条路径：
- **MCP Server**：Obsidian 插件暴露 MCP Server → Harness 作为 Client 连接

这三条路径对应不同的设计哲学：

| 路径 | 哲学 | dshdian 适用性 |
|------|------|---------------|
| 进程内 Cordis | Obsidian 为主，AI 为附 | ✅ 适合 AI 聊天面板场景 |
| SDK Client | AI 为主，Obsidian 为数据源 | 🟡 用户需要同时开 Harness Web UI |
| MCP Server | 双主体：各自独立，协议互联 | ✅ 最佳解耦，面向未来 |

**推荐策略：MCP Server 为主，进程内 Cordis 为辅。**
- MCP Server 暴露 Vault 工具给外部 Harness（用户想用 Harness Web UI 时）
- 进程内 Cordis 提供 Obsidian 内 Chat 面板（用户想在 Obsidian 内交互时）
- 两条路径共享同一套工具定义，仅注册方式不同

---

## 三、结论总结

| # | 能力点 | 结论 | 机制 |
|---|--------|------|------|
| 1 | 外部进程动态注册工具 | ✅ 支持 | MCP Server (streamable-http) |
| 2 | Web UI 会话调用外部工具 | ✅ 支持 | Standard/Code 模式自动暴露 MCP 工具 |
| 3 | 结果返回并继续 Agent 循环 | ✅ 支持 | MCP 协议原生 tool call → result 流程 |
| 4 | 断线重连恢复工具 | ✅ 支持 | `ReconnectConfig` + 自动 `tools/list` 重发现 |
| 5 | 替代机制 | ✅ 存在 | MCP Server 是官方首选；另有 Cordis 插件、A2A、ACP |

**核心结论：DeepSeek Harness 通过 MCP 协议完整支持外部工具注册的所有需求场景。dshdian 项目应实现一个 MCP Server 嵌入 Obsidian 插件，通过 `streamable-http` 传输暴露 Vault 工具给 Harness。**

---

## 四、后续行动

1. **ADR 决策**：记录"dshdian 采用 MCP Server 作为 Harness 集成主路径"
2. **原型验证**：最小 MCP Server 实现（1-2 个工具） + Harness 配置连通测试
3. **工具清单设计**：确定第一批暴露给 Harness 的 Vault 工具（read_note, list_notes, search_notes, write_note）
4. **子插件工具动态注册**：验证 `notifications/tools/list_changed` 在 Harness 中的实际行为

---

## 附录：信息来源

| 来源 | URL | 置信度 |
|------|-----|--------|
| DeepSeek Harness 官方 README | github.com/deepseek-ai/deepseek-harness | 高 |
| dsh-mcp-client 包文档 | packages/mcp/mcp-client/README.md | 高 |
| 配置目录文档 | docs/config-catalog.md | 高 |
| extension-cookbook.md | docs/cookbook/extension-cookbook.md | 高 |
| Composio 集成指南 | composio.dev/toolkits/*/framework/deepseek | 中（第三方） |
| FindHarness MCP 指南 | findharness.com/blog/deepseek-harness-mcp-guide | 中（社区） |
| Habr 架构分析 | habr.com/en/articles/1070958 | 中（社区） |
| dsh-mcp-manager 社区插件 | github.com/fishlikewater/dsh-mcp-manager | 中（社区验证） |
| Context7 代码库索引 | /deepseek-ai/deepseek-harness (6018 snippets) | 高 |
