# Obsidian × DeepSeek Harness "插件的插件" 设计参考文档

> 研究日期：2026-08-26

## 一、项目目标

构建一个 Obsidian 桌面插件（宿主插件），集成 DeepSeek Harness 的 AI Agent 能力，使用户能够通过自然语言在 Obsidian 中创建、管理和运行子插件。

核心差异化（相对参考项目 obsidian-harness-like）：更多定制化空间。

---

## 二、技术栈概览

| 层级 | 技术 | 说明 |
|------|------|------|
| 宿主环境 | Obsidian Desktop | Electron 应用，Plugin API + Vault 文件系统 |
| 宿主插件 | TypeScript + esbuild | 标准 Obsidian 插件结构 |
| AI 引擎 | DeepSeek Harness | Cordis 元框架，Everything is Plugin |
| 模型接入 | OpenAI 兼容 API | DeepSeek V4-Pro/Flash，可扩展其他 Provider |
| 子插件运行时 | Cordis Context | DI 容器 + effect/dispose 生命周期 |
| SDK 嵌入 | @deepseek-ai/dsh-sdk-client | TypeScript SDK，stdio JSON-RPC 驱动子进程 |

---

## 三、Obsidian 插件开发要点

### 3.1 项目结构

```
my-plugin/
├── manifest.json        # 必需：id, name, version, minAppVersion
├── main.ts              # 入口：export default class extends Plugin
├── main.js              # 编译产物
├── styles.css           # 可选样式
├── package.json
├── tsconfig.json
└── esbuild.config.mjs
```

### 3.2 生命周期

```ts
export default class MyPlugin extends Plugin {
  async onload() {
    // 注册所有资源：commands, views, settings, events
  }
  onunload() {
    // 清理资源
  }
}
```

### 3.3 核心 API

| API | 用途 |
|-----|------|
| `this.addCommand()` | 注册命令面板命令 |
| `this.addRibbonIcon()` | 左侧边栏图标 |
| `this.addSettingTab()` | 设置页 |
| `this.registerView()` | 注册自定义视图（ItemView） |
| `this.app.vault` | 文件读写 |
| `this.app.workspace` | 工作区/面板管理 |
| `Modal` | 模态对话框 |

### 3.4 动态代码加载方式

Obsidian 无官方"动态加载插件"API，可行方案：
1. **`vault.adapter` 读取文件** → `new Function()` / `eval()` 执行
2. **`require()` 动态导入** — Node.js 风格模块加载
3. **`app.plugins.getPlugin()`** — 访问已加载插件实例
4. **`Component.addChild()`** — 子组件机制管理生命周期

---

## 四、DeepSeek Harness SDK 要点

### 4.1 核心概念

- **Everything is Plugin**：模型适配器、工具注册、会话管理、Agent 循环均为 Cordis 插件
- **Cordis 元框架**：DI 容器 + effect/dispose 生命周期 + 配置合并
- **三种工具模式**：native（独立 function call）、code（生成代码编排多步）、both

### 4.2 嵌入方式选择

| 方式 | 适用场景 |
|------|----------|
| `@deepseek-ai/dsh-sdk-client` | 启动 Harness 子进程，通过 stdio JSON-RPC 通信 |
| 直接 OpenAI 兼容 API | 轻量接入，仅用 chat completions + tool calling |
| Cordis boot API | 深度集成，在同进程启动完整 Cordis 运行时 |

**推荐路线**：
- 初期：直接使用 OpenAI 兼容 API + 自建 tool-calling 循环（轻量、可控）
- 进阶：通过 SDK Client 启动完整 Harness 子进程（功能完整、沙箱隔离）

### 4.3 代码生成调用

```ts
// OpenAI 兼容格式
const response = await fetch(baseUrl + '/v1/chat/completions', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${apiKey}` },
  body: JSON.stringify({
    model: 'deepseek-v4-pro',
    messages: [...],
    tools: [...],     // function definitions
    stream: true,
  })
});
```

### 4.4 沙箱安全

```ts
type SandboxMode = 'read-only' | 'workspace-write' | 'danger-full-access'
// Fail-closed: 无沙箱后端时抛 SandboxUnavailableError，不静默降级
```

---

## 五、参考项目架构分析

### 5.1 obsidian-harness-like 核心设计

```
┌─────────────────────────────────────────┐
│         Obsidian Desktop                │
├─────────────────────────────────────────┤
│  宿主插件 (Host Plugin)                  │
│  ├── Chat 面板（ItemView）               │
│  ├── Agent 引擎（tool-calling 循环）     │
│  ├── 服务层（ctx.*，封装 Obsidian API）  │
│  ├── Plugin Manager（子插件生命周期）     │
│  └── Settings Tab（多通道配置）          │
├─────────────────────────────────────────┤
│  Cordis 运行时                           │
│  ├── 服务注入（inject 声明式）           │
│  └── effect/dispose 自动清理             │
├─────────────────────────────────────────┤
│  子插件 (.obsidian/harness-like-plugins/)│
│  ├── my-tool/package.json + main.js     │
│  └── my-panel/package.json + main.js    │
└─────────────────────────────────────────┘
```

### 5.2 子插件结构

```
.obsidian/harness-like-plugins/my-plugin/
├── package.json    # { name, version, dsh: { entry: "main.js" } }
└── main.js         # CommonJS module
```

```js
module.exports = {
  name: 'my-plugin',
  inject: ['toolsCompat', 'commands', 'notice'],
  apply(ctx) {
    ctx.effect(() => [
      ctx.commands.addCommand({ ... }),
      ctx.toolsCompat.register({ ... }),
    ])
  },
}
```

### 5.3 三种 Agent 模式

| 模式 | 能力 |
|------|------|
| Chat | 只读：read_note, list_notes, search_notes |
| Edit | 读写：+ write_note, insert_to_editor, run_command |
| Create | 完整：+ plugin_guide, create_plugin, write_plugin_file, check_plugin, reload_plugin |

### 5.4 创建插件流程

1. 用户描述需求 → Agent 调用 `plugin_guide`（读取开发指南）
2. Agent 调用 `create_plugin`（创建文件夹 + package.json）
3. Agent 调用 `write_plugin_file`（写入 main.js）
4. Agent 调用 `check_plugin`（AST 语法检查 + 禁用 API 检测）
5. Agent 调用 `reload_plugin`（触发加载，首次需授权）
6. 插件生效，用户立即可用

### 5.5 安全模型（四层审批链）

```
Per-tool policy → Current-note mode → Directory whitelist → Approval dialog
```

---

## 六、设计决策点（待定）

### 6.1 架构路线

| 决策 | 选项 A | 选项 B |
|------|--------|--------|
| AI 集成方式 | 直接 API 调用 + 自建 Agent 循环 | 启动 Harness 子进程通过 SDK |
| 子插件运行时 | 复用 Cordis（同参考项目） | 自建轻量运行时 |
| 子插件格式 | CommonJS module.exports | ESM export |
| 沙箱方案 | 静态 AST 检查（同参考项目） | QuickJS/iframe/Web Worker 真隔离 |
| 模型选择 | 仅 DeepSeek | 多模型（OpenAI/Anthropic/本地） |

### 6.2 定制化方向

相对参考项目，可重点突破的方向：

1. **真正的沙箱隔离** — QuickJS 或 Web Worker 替代静态 AST 检查
2. **子插件版本管理** — git-like 快照，支持回滚
3. **子插件市场/分享** — 社区仓库机制
4. **更丰富的 Obsidian API 暴露** — 不仅限于参考项目的服务子集
5. **多模型支持** — 不限于 OpenAI 兼容协议
6. **移动端策略** — 远程 Agent 代理或轻量模式
7. **插件间通信** — 子插件组合与依赖
8. **导出为原生插件** — 成熟子插件编译为独立 Obsidian 社区插件
9. **API Key 安全存储** — 集成系统 Keychain

---

## 七、参考资源

| 资源 | 链接 |
|------|------|
| Obsidian Plugin API | https://docs.obsidian.md/Plugins |
| DeepSeek Harness GitHub | https://github.com/deepseek-ai/deepseek-harness |
| DeepSeek API 文档 | https://api-docs.deepseek.com |
| 参考项目 | https://github.com/frank6com/obsidian-harness-like |
| 参考项目文档 | https://frank6com.github.io/obsidian-harness-like/ |
| Cordis 框架 | https://github.com/nicepkg/cordis |
| @deepseek-ai/dsh-sdk-client | npm |
