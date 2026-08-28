> ⚠️ 本文档为早期研究归档。Dshdian 最终选择了外部 Harness 进程 + 原生插件生成路线（非进程内 Cordis），详见 docs/adr/。本文档仅作为竞品分析参考保留。

# DeepSeek Harness × Obsidian 集成研究报告

> 研究日期：2026-08-26
> 状态：已确认

---

## 一、DeepSeek Harness SDK 可用性确认

### 结论：✅ 真实存在，developer preview 阶段

| 项目 | 状态 | 地址 |
|------|------|------|
| `deepseek-ai/deepseek-harness` | ✅ 196k stars, MIT | https://github.com/deepseek-ai/deepseek-harness |
| `@deepseek-ai/dsh-sdk-client` | ✅ 0.1.0-rc.6 | npm / `packages/sdk/client/` |
| `@deepseek-ai/dsh-sdk-protocol` | ✅ | npm |
| `@deepseek-ai/cordis` (vendored) | ✅ | npm |
| Cordis 框架源码 | ✅ 7.6k stars | https://github.com/cordiverse/cordis |

### SDK 家族

```
@deepseek-ai/dsh                 # 主 CLI (npx @deepseek-ai/dsh web)
@deepseek-ai/dsh-sdk-client      # TypeScript client (HarnessClient)
@deepseek-ai/dsh-sdk-protocol    # JSON-RPC 协议定义
@deepseek-ai/dsh-llm             # LLM 适配层（LlmAdapter / LlmRuntime）
@deepseek-ai/dsh-agent           # Agent 核心
@deepseek-ai/dsh-agent-loop      # Agent 循环
@deepseek-ai/dsh-session         # 会话管理
@deepseek-ai/dsh-sandbox-policy  # 沙箱策略
@deepseek-ai/dsh-tool-*          # 各种内置工具
@deepseek-ai/cordis              # Cordis 框架 (vendored 4.0.1)
```

### 两种嵌入模式

| 模式 | 机制 | 适用场景 |
|------|------|----------|
| **SDK Client** | `HarnessClient` spawn 子进程 → stdio JSON-RPC | 完整隔离、独立运行 |
| **进程内 Cordis** | 直接 import `@deepseek-ai/cordis` + `dsh-*` 包 | 深度集成、共享上下文 |

obsidian-harness-like 选择了**进程内 Cordis** 模式。

### 时间线

| 日期 | 事件 |
|------|------|
| 2026-07-05 | npm 组织 @deepseek-harness 转让给 DeepSeek |
| 2026-08-10 | 首次发布 npm 0.0.1-rc.1 |
| 2026-08-13 | 0.1.0-rc.6 随 DeepSeek V4-Pro-0813 发布 |

---

## 二、obsidian-harness-like 架构分析

### 2.1 项目概况

- GitHub: https://github.com/frank6com/obsidian-harness-like
- 状态: Beta, 已上架 Obsidian 社区插件目录
- 许可: MIT
- 仅桌面端 (macOS/Windows/Linux)
- 测试: vitest, 129 tests

### 2.2 Monorepo 结构

```
packages/
  harness-base/          # 纯逻辑层
    ├── sandbox/         # 路径白名单沙箱
    ├── approval/        # 审批链
    ├── session-log/     # 会话日志
    └── agent-loop/      # Agent 循环 + 官方 dsh-llm/tools 集成

  obsidian-adapter/      # Obsidian API → Cordis 服务（唯一接触 Obsidian API 的层）
    ├── vault.ts         # read/write/create/delete/rename/list
    ├── workspace.ts     # getActiveFile/onFileOpen
    ├── commands.ts      # addCommand/execute
    ├── views.ts         # registerView/open
    └── ...

  plugin-runtime/        # 子插件加载器
    ├── loader.ts        # new Function() + require shim
    ├── state-machine.ts # stopped → running → error
    └── backups.ts       # 版本快照 + 回滚

apps/plugin/             # 入口
  ├── main.ts            # Obsidian Plugin 入口 → 启动 Cordis
  ├── chat-view.ts       # ItemView 聊天面板
  ├── settings.ts        # 多 Provider 配置
  ├── tools/             # Agent 工具定义
  │   ├── vault-tools.ts # read_note/list_notes/search_notes/write_note
  │   ├── editor-tools.ts
  │   └── plugin-dev.ts  # create_plugin/write_plugin_file/check_plugin/reload_plugin
  └── i18n/
```

### 2.3 DSH 集成方式：进程内 Cordis + HTTP SSE

**不是子进程，不是 SDK Client 模式。** 直接在 Obsidian 插件进程内：

1. 嵌入 `@deepseek-ai/cordis` 运行时
2. 加载官方 `dsh-llm` / `dsh-agent-loop` / `dsh-sandbox-policy` 等包作为 Cordis 插件
3. 通过标准 HTTP `fetch` + SSE 流式调用外部 LLM API（OpenAI 兼容格式）

```typescript
// main.ts 启动流程
import * as cordis from '@deepseek-ai/cordis'
import { harnessServicesPlugin } from '@harness-like/harness-base'
import { obsidianAdapterPlugin } from '@harness-like/obsidian-adapter'
import { runtimePlugin } from '@harness-like/plugin-runtime'

export default class HarnessLikePlugin extends Plugin {
  async onload() {
    const ctx = new cordis.Context()
    ctx.plugin(obsidianAdapterPlugin, { app: this.app, plugin: this })
    ctx.plugin(harnessServicesPlugin, { llmConfig, sandboxConfig })
    ctx.plugin(runtimePlugin, { pluginsDir, require: cordisShim })
  }
}
```

### 2.4 LLM 调用

```typescript
// DeepSeekAdapter.stream()
const res = await fetch(baseURL + '/chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({
    model,
    messages: toWireMessages(messages, system),
    stream: true,
    stream_options: { include_usage: true },
    tools: tools.map(t => ({ type: 'function', function: { name, description, parameters } })),
  })
})
// SSE 逐行解析 → 产出 StreamChunk
```

- 使用 `@deepseek-ai/dsh-llm` 的 `LlmAdapter` 抽象
- 多 Provider 支持（DeepSeek 预配置，可加 OpenAI/Anthropic/本地）
- 支持 `reasoning_content`（DeepSeek reasoner 推理过程）

### 2.5 Agent 循环

```typescript
for (let turn = 0; turn < maxTurns; turn++) {
  const res = await llm.call({ messages, tools: tools.list(), signal, onDelta, model })
  if (!res.toolCalls?.length) break  // 无工具调用 → 结束
  for (const call of res.toolCalls) {
    const result = await tools.execute(call.name, call.arguments, { approval })
    messages.push({ role: 'tool', tool_call_id: call.id, content: result })
  }
}
```

---

## 三、自然语言创建插件：完整流程

### 3.1 三级 Agent 模式

| 模式 | 能力 | 适用场景 |
|------|------|----------|
| **Chat** | 只读 vault | 问答、搜索笔记 |
| **Edit** | 读写 vault + 执行命令 | 编辑笔记、操作 Obsidian |
| **Create** | 完整 + 创建子插件 | 扩展 Obsidian 能力 |

### 3.2 创建插件的 5 步流程

```
用户自然语言描述 → Agent
  ↓
① plugin_guide()     → 获取开发指南（模板 + API 速查 + 铁律）
  ↓
② create_plugin(id)  → 创建目录 + package.json
  ↓
③ write_plugin_file(id, "main.js", code)  → 写入生成的代码
  ↓
④ check_plugin(id)   → vm.Script 语法检查 + 正则扫描禁用 API
  ↓
⑤ reload_plugin(id)  → 停止旧版本 → 加载新版本（需用户授权）
  ↓
插件即时生效
```

### 3.3 `plugin_guide` 的内容（Agent 的开发参考）

一个大字符串常量，包含：
- **标准工作流**（5 步严格顺序，不可跳过）
- **模板 A**（无界面：工具/命令/状态栏）
- **模板 B**（带面板：ItemView）
- **服务与方法速查**（ctx.vault / ctx.commands / ctx.views / ...）
- **铁律**（违反即加载失败的硬限制）
- **命令命名归一化规则**

### 3.4 子插件代码格式

```javascript
// 纯 CJS，module.exports 导出 Cordis 插件对象
module.exports = {
  name: 'my-plugin',
  inject: ['toolsCompat', 'commands', 'notice'],  // 声明式依赖注入
  apply(ctx) {
    ctx.effect(() => [
      ctx.commands.addCommand({
        id: 'my-command',
        name: 'Do Something',
        callback: () => { ctx.notice('Done!') }
      }),
      ctx.toolsCompat.register({
        name: 'my_tool',
        description: '...',
        input: { type: 'object', properties: { ... } },
        execute: async (input) => { ... }
      }),
    ])
  },
}
```

存储位置：`.obsidian/harness-like-plugins/<id>/main.js`

---

## 四、动态加载机制

### 4.1 核心：`new Function()` + require shim

```typescript
async function loadUserPlugin(ctx, dir, deps) {
  const code = await fs.promises.readFile(entryPath, 'utf8')
  const module = { exports: {} }

  // require shim：控制子插件能 require 什么
  const localRequire = (id) => {
    if (id === 'obsidian') return deps.obsidianModule
    if (id === '@deepseek-ai/cordis') return deps.cordisModule  // 共享宿主实例
    throw new Error(`Cannot require '${id}'`)
  }

  // new Function 而非 eval/require
  const fn = new Function('module', 'exports', 'require', '__dirname', '__filename', code)
  fn(module, module.exports, localRequire, dir, entryPath)

  // 作为 Cordis 插件挂载
  const fiber = ctx.plugin(module.exports)
  return { id, fiber, ... }
}
```

### 4.2 为什么选 `new Function()`

| 方案 | 问题 |
|------|------|
| `require()` 原生 | 无法控制模块解析、Node 缓存污染 |
| `eval()` | 无法传入 module/exports 参数 |
| `vm.runInContext()` | Electron 限制多，且隔离太强无法共享宿主对象 |
| **`new Function()`** | ✅ 可控参数注入、无缓存、与宿主共享上下文 |

### 4.3 生命周期状态机

```
         load()           error
stopped ──────→ running ──────→ error
   ↑               │                │
   └── stop() ─────┘    autoRecover │
   ↑                                │
   └────────────────────────────────┘
```

- **load**: 读代码 → new Function 执行 → ctx.plugin 挂载 → 状态 running
- **stop**: fiber.dispose()（Cordis 自动撤销所有 effect）→ 状态 stopped
- **reload**: stop → load
- **error recovery**: 加载失败 → 尝试恢复到最近可用备份版本

---

## 五、安全模型（四层）

### 层 1：代码静态扫描（正则 + vm.Script）

| 检查项 | 方式 | 后果 |
|--------|------|------|
| 语法错误 | `new vm.Script(code)` 编译不执行 | 阻止加载 |
| `this.app` | 正则 `/\bthis\.app\b/` | 阻止加载 |
| `document.querySelector/getElementById` | 正则 | 阻止加载 |
| 不存在的 vault API | 正则匹配已废弃方法名 | 阻止加载 |
| require 非白名单模块 | 正则 | 警告 |
| `document.createElement` | 正则 | 警告（建议 el.createEl） |

**注意：这不是真正的 AST 沙箱，是"君子协议"级别的静态检查。**

### 层 2：require shim（运行时）

只允许 require 两个模块：
- `obsidian` → 宿主已加载的模块
- `@deepseek-ai/cordis` → 宿主同一实例

其他任何 require 直接抛错。

### 层 3：路径白名单沙箱（运行时）

```
允许读：vault 根 + 临时目录
允许写：vault 笔记区 + .obsidian/harness-like/ + .obsidian/harness-like-plugins/ + 临时目录
禁止：vault 外任何路径 + .obsidian/ 内其他目录（plugins/、app.json、workspace.json）
```

### 层 4：审批链（UI）

- reload_plugin 首次加载需用户点击确认
- 版本变更需重新授权
- run_command 每次需审批
- 高风险操作弹出 Modal

### 安全模型的局限性

| 风险 | 说明 |
|------|------|
| 正则可绕过 | 字符串拼接、动态属性访问可规避检查 |
| 无内存隔离 | 子插件与宿主共享同一 V8 隔离区 |
| 无 CPU/时间限制 | 死循环会冻结 Obsidian |
| Cordis 服务泄漏 | inject 声明外的服务理论上可通过 ctx 遍历访问 |

---

## 六、子插件能力边界

### 可用服务（通过 inject 声明式获取）

| 服务名 | 能力 |
|--------|------|
| `vault` | getMarkdownPaths, read, write, create, createFolder, delete, rename, on(modify/create/delete/rename) |
| `views` | registerView(ItemView 子类), open |
| `commands` | addCommand, execute |
| `ribbon` | addRibbonIcon |
| `statusbar` | addStatusBarItem |
| `settingsTab` | register |
| `notice` | notice(消息) |
| `workspace` | getActiveFile, onFileOpen |
| `editor` | getSelection, insertText, replaceSelection |
| `toolsCompat` | register(注册 Agent 可调用的工具) |
| `settings` | get/set(插件本身的配置) |
| `protocol` | register(obsidian:// URI 动作) |
| `dshI18n` | registerLocale |

### 子插件间通信

- **工具注册**：A 插件注册工具 → Agent 可调用 → 间接协调 B 插件
- **命令执行**：A 插件注册命令 → B 插件 `commands.execute(id)`
- **事件广播**：vault/workspace 事件全局可监听
- **无直接互调**：不能 import 另一个子插件的代码

---

## 七、对 Dshdian 项目的启示

### 7.1 可直接复用的设计

1. **进程内 Cordis 模式** — 已验证可行，是最佳集成路径
2. **OpenAI 兼容 API 调用** — 不依赖子进程，简单可靠
3. **`new Function()` + require shim** — 动态加载的最佳方案
4. **Cordis fiber 生命周期** — 天然支持可逆卸载
5. **三级模式分层** — 渐进式权限暴露
6. **plugin_guide 模式** — 给 LLM 明确的开发规范，提高代码生成成功率

### 7.2 可改进的方向

1. **安全模型** — 正则扫描是最大弱点，可升级为：
   - QuickJS 真沙箱（但 API bridge 复杂度高）
   - Web Worker 隔离（但无法共享 Cordis 上下文）
   - **推荐折中**：AST 级检查（用 acorn/babel parser）+ 运行时 Proxy 拦截
2. **子插件 TypeScript 支持** — 参考项目仅 CJS JS，可提供 esbuild 实时编译
3. **插件版本管理** — 参考项目有备份/回滚，可增强为 git-like 快照
4. **子插件市场** — 参考项目无此功能，可做社区分享
5. **导出为原生插件** — 成熟子插件编译为独立 Obsidian 社区插件

### 7.3 风险评估更新

| 风险 | 原评估 | 更新后 |
|------|--------|--------|
| 动态代码执行 | 🟡 | 🟢 已验证可行，参考项目已上架社区插件目录 |
| 安全隔离 | 🔴 | 🟡 参考项目证明"君子协议"已足够上架，但可做更好 |
| 代码生成质量 | 🟡 | 🟢 plugin_guide 模式有效约束 LLM 输出 |
| 生命周期管理 | 🟡 | 🟢 Cordis fiber 天然解决 |
| 移动端 | 🔴 | 🔴 仍然无解，参考项目也放弃了移动端 |

---

## 八、推荐的技术决策

基于研究结果，更新设计研究文档第六节的决策建议：

| 决策 | 推荐 | 理由 |
|------|------|------|
| AI 集成方式 | 进程内 Cordis + HTTP API | 参考项目已验证，复杂度可控 |
| 子插件运行时 | 复用 Cordis（`@deepseek-ai/cordis`） | 天然生命周期 + DI + effect/dispose |
| 子插件格式 | CJS `module.exports`（初期） | LLM 生成成功率高，模板简单 |
| 沙箱方案 | 正则/AST 检查 + Proxy 拦截（初期），QuickJS 可选（进阶） | 平衡安全与开发速度 |
| 模型选择 | 多模型（OpenAI 兼容协议统一） | 用户可能有不同偏好 |
| 官方 DSH 包依赖 | dsh-llm + dsh-agent-loop + cordis（轻量集成） | 不需要全量 SDK |

---

## 附录：关键代码引用

### Cordis 插件结构

```typescript
// 宿主侧：注册服务
ctx.provide('vault', vaultService)
ctx.provide('commands', commandsService)

// 子插件侧：消费服务
module.exports = {
  name: 'xxx',
  inject: ['vault', 'commands'],
  apply(ctx) {
    ctx.effect(() => [ ... ])  // 返回 dispose 函数数组
  }
}
```

### Agent 工具注册模式

```typescript
ctx.toolsCompat.register({
  name: 'tool_name',
  description: '描述',
  input: { type: 'object', properties: { ... }, required: [...] },
  async execute(input, { signal }) {
    // 实现
    return JSON.stringify(result)
  }
})
```
