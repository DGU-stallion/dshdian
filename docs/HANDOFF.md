# Handoff — Dshdian 模式切换修复

> 日期: 2026-08-29
> 分支: main (commit fde6b21)
> 状态: DSH 对齐重构完成，但模式切换存在遗留问题

## 当前状态

Phase 1-5 + DSH 对齐重构已完成。核心架构已正确：
- 审批：响应 DSH 的 `approval/requested` 帧，不自主判断
- 上下文：首条消息注入 vault 结构，后续干净发送
- 渲染：rAF 流式、reasoning 折叠、variant 工具卡片
- UI：DSH 风格 22px 圆角 composer

## 待修复问题

### 问题 1：模式切换触发 /permission 对话（高优先级）

**现象**：切换 Chat ↔ Standard 时，界面上出现一条 `/permission workspace-write` 的用户消息，DSH 把它当正常对话处理。

**根因**：`ModeManager.switchMode()` 在 Chat↔Standard 切换时调用 `client.sendMessage(sessionId, "/permission ...")"`。这会把 slash command 作为用户消息发送，DSH 虽然会处理 permission 变更，但同时在聊天记录中显示了这条消息。

**正确做法调研方向**：
1. DSH 的 `/permission` 命令确实通过 `session.prompt` 发送——但 DSH web 前端可能用了别的方式（例如直接通过 cordis 事件 append）
2. 查看 `dsh-permission-presets` 源码中 `PermissionPresetService.apply()` 方法——它直接调用 `session.append()` 写事件到 session log，不经过 prompt
3. 但 `session.append()` 可能没有暴露为 RPC——需要验证是否有 `session.append` 或类似 RPC
4. 备选方案：如果无法直接 append，可以用 `session.prompt` 发送但在 UI 中不显示（发送前不调用 `view.addMessage`，发送后用户不会看到）

**关键代码位置**：
- `src/services/ModeManager.ts` — `switchMode()` 方法 line ~60
- DSH 源码: `~/.npm/_npx/1e7f6d9597241db0/node_modules/@deepseek-ai/dsh-permission-presets/lib/index.js`
- 参考文档: `docs/research/dsh-behavior-reference.md` §2

### 问题 2：三模式切换状态机不完整

**现象**：Create → Chat 或 Create → Standard 的切换逻辑可能有 edge case。

**当前逻辑**（ModeManager.switchMode）：
```
needsNewSession = (oldMode === Creator) || (newMode === Creator)
if needsNewSession → 新建 session
else → 发送 /permission 命令
```

**需要验证的场景**：
- Chat → Standard ✓（同 session，切 permission）
- Standard → Chat ✓（同 session，切 permission）
- Chat → Create ✓（新 session，preset=cordis）
- Standard → Create ✓（新 session，preset=cordis）
- **Create → Chat**（新 session，preset=standard，permission=read-only）
- **Create → Standard**（新 session，preset=standard，permission=workspace-write）

最后两个需要确认新 session 的初始 permission 是否正确设置。

### 问题 3：DSH 连接稳定性

DSH 3180 实例需要手动启动。`DshProcessManager.start()` 在 Obsidian GUI 环境中可能找不到 dsh 二进制。

**临时 workaround**：在终端运行 `dsh --profile Dshdian --port 3180 --no-open` 保持后台运行。

## 调研建议

在动手修代码之前，先在终端用 `node` 做以下验证：

```bash
cd /Users/a19150/Project/dshdian

# 1. 检查是否有 session.append RPC
node -e "
const http = require('http');
const body = JSON.stringify({
  type: 'client-request',
  rpcId: require('crypto').randomUUID(),
  method: 'session.append',
  payload: { sessionId: '<some-session-id>', type: 'permission/preset', data: { preset: 'workspace-write' } }
});
const req = http.request('http://127.0.0.1:3180/api/session.append', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
}, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>console.log(d)); });
req.write(body); req.end();
"

# 2. 检查 /permission 作为 prompt 是否真的在聊天记录中显示
# (观察 DSH web UI 在 127.0.0.1:3080 中 /permission 命令是否出现在聊天中)
```

## 关键文件

| 文件 | 用途 |
|------|------|
| `src/services/ModeManager.ts` | 模式切换核心逻辑（待修改） |
| `src/main.ts` | 事件分发 + handleModeChange |
| `docs/research/dsh-behavior-reference.md` | DSH 行为参考（§1-§2 最相关） |
| `scripts/test-connection.mjs` | DSH 连接诊断脚本 |

## 参考命令

```bash
# 构建
npm run build

# 类型检查
npx tsc --noEmit

# 测试
npm test

# 部署到 vault
cp main.js manifest.json styles.css "/Users/a19150/Personal Files/ThinkDoKit/.obsidian/plugins/dshdian/"

# 启动 DSH 3180 实例
~/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh --profile Dshdian --port 3180 --no-open
```
