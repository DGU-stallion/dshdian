import { Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { ChatPanelView, VIEW_TYPE_CHAT } from "./views/ChatPanelView";
import { DshProcessManager } from "./services/DshProcessManager";
import { HarnessClient } from "./services/HarnessClient";
import { ModeManager } from "./services/ModeManager";
import { ReferenceResolver } from "./services/ReferenceResolver";
import { ApprovalStrategy } from "./services/ApprovalStrategy";
import { PluginGenerator } from "./services/PluginGenerator";
import { DshdianSettingTab, DEFAULT_SETTINGS } from "./settings";
import { Mode } from "./types";
import type { DshdianSettings } from "./settings";
import { ApprovalLevel } from "./types";
import type { MuxFrame, HostFrame, ApprovalRequestedFrame, QuestionRequestedFrame, StreamChunk as StreamChunkType } from "./services/HarnessClient";

export default class DshdianPlugin extends Plugin {
	settings: DshdianSettings = DEFAULT_SETTINGS;

	processManager!: DshProcessManager;
	client!: HarnessClient;
	modeManager!: ModeManager;
	referenceResolver!: ReferenceResolver;
	approvalStrategy!: ApprovalStrategy;
	pluginGenerator!: PluginGenerator;

	/** Track whether a streaming assistant response is in progress */
	private isStreaming = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Initialize services
		this.client = new HarnessClient(this.settings.harnessPort);
		this.processManager = new DshProcessManager(this.settings.harnessPort);
		this.modeManager = new ModeManager(this.client);
		this.referenceResolver = new ReferenceResolver(this.app);
		this.approvalStrategy = new ApprovalStrategy(this.app);
		this.pluginGenerator = new PluginGenerator(this.app);

		// Register the chat view
		this.registerView(VIEW_TYPE_CHAT, (leaf: WorkspaceLeaf) => {
			const view = new ChatPanelView(leaf);
			view.setHandlers({
				onSendMessage: (content, refs) => this.handleSendMessage(content, refs),
				onModeChange: (mode) => this.handleModeChange(mode),
				onModelChange: (model) => this.handleModelChange(model),
				onGetSuggestions: (query) => this.referenceResolver.getSuggestions(query),
				onGetCommands: () => this.getAvailableCommands(),
				onNewChat: () => this.handleNewChat(),
				onShowHistory: () => this.handleShowHistory(),
				onAddContext: () => this.handleAddContext(),
			});
			view.setMode(this.settings.defaultMode);
			view.setModel(this.settings.defaultModel);
			return view;
		});

		// Ribbon icon to open/focus the chat panel
		this.addRibbonIcon("bot", "Open dshdian", () => {
			this.activateView();
		});

		// Settings tab
		this.addSettingTab(new DshdianSettingTab(this.app, this));

		// Start DSH process and connect
		this.processManager.start(this.settings.harnessPath || undefined);

		// When process is up, start the dual-stream connection
		this.processManager.on("started", () => {
			this.startConnection();
		});
		this.processManager.on("stopped", () => {
			this.client.stop();
			const view = this.getChatView();
			if (view) view.setStatus("disconnected");
		});
		this.processManager.on("error", () => {
			const view = this.getChatView();
			if (view) view.setStatus("disconnected");
		});
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);
		this.client.stop();
		this.processManager.stop();
		this.pluginGenerator.stopWatching();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		this.client.setPort(this.settings.harnessPort);
		this.processManager.setPort(this.settings.harnessPort);
	}

	// ─── Connection management ─────────────────────────────────────────

	/**
	 * Start the dual-stream WebSocket connection to DSH.
	 * Frame dispatch happens here — the connection layer is stateless,
	 * the plugin owns the business routing.
	 */
	private startConnection(): void {
		this.client.start({
			onMuxFrame: (frame) => this.handleMuxFrame(frame),
			onHostFrame: (frame) => this.handleHostFrame(frame),
			onConnected: () => {
				const view = this.getChatView();
				if (view) view.setStatus("connected");
			},
			onStateChange: (state) => {
				const view = this.getChatView();
				if (!view) return;
				switch (state) {
					case "connected":
						view.setStatus("connected");
						break;
					case "disconnected":
					case "reconnecting":
					case "connecting":
						view.setStatus("disconnected");
						break;
				}
			},
		});
	}

	// ─── MuxFrame dispatch ─────────────────────────────────────────────

	private handleMuxFrame(frame: MuxFrame): void {
		const view = this.getChatView();
		if (!view) return;

		const currentSessionId = this.modeManager.getSessionId();

		switch (frame.type) {
			case "session/event": {
				// Only process events for our active session
				if (frame.sessionId !== currentSessionId) return;
				this.handleSessionEvent(frame.event, frame.view, view);
				break;
			}
			case "session/subscribed":
				// Connection confirmed for a session — no UI action needed
				break;
			case "approval/requested":
				if (frame.sessionId === currentSessionId) {
					this.handleApprovalRequest(frame as ApprovalRequestedFrame, view);
				}
				break;
			case "question/requested":
				if (frame.sessionId === currentSessionId) {
					this.handleQuestionRequest(frame as QuestionRequestedFrame, view);
				}
				break;
			case "stream/error":
				view.addMessage(
					HarnessClient.buildMessage("system", `Stream error: ${frame.error.message}`)
				);
				break;
			default:
				// session/queue, session/jobs, session/projection, approval/resolved, question/resolved
				// — not needed for MVP
				break;
		}
	}

	/**
	 * Handle a single SessionEvent within a session/event mux frame.
	 * Maps DSH session event types to ChatPanelView UI updates.
	 */
	private handleSessionEvent(
		event: { type: string; [key: string]: unknown },
		_view_hint: unknown,
		view: ChatPanelView
	): void {
		// DSH SessionEvent structure: { type, seq, time, data: { ...business fields } }
		const data = (event.data ?? event) as Record<string, unknown>;

		switch (event.type) {
			case "turn/start":
				if (!this.isStreaming) {
					this.isStreaming = true;
					view.startStreamingMessage();
					view.setInputEnabled(false);
					view.setStatus("streaming");
				}
				break;

			case "assistant/chunk": {
				const chunk = data.chunk as StreamChunkType | undefined;
				if (!chunk) break;

				switch (chunk.type) {
					case "text-delta":
						if (chunk.text) {
							view.appendStreamToken(chunk.text);
						}
						break;
					case "reasoning-delta":
						if (chunk.text) {
							view.appendStreamToken(chunk.text);
						}
						break;
					case "tool-call-delta":
					case "block-start":
					case "block-end":
					case "usage":
					case "finish":
						break;
				}
				break;
			}

			case "assistant/message":
				break;

			case "tool/call": {
				const name = (data.name as string) ?? "unknown";
				view.addToolCall({ name, status: "running" });
				break;
			}

			case "tool/result": {
				const message = data.message as { content?: Array<{ text?: string }> } | undefined;
				const resultText = message?.content?.[0]?.text ?? "";
				const summary = resultText.length > 100 ? resultText.slice(0, 100) + "..." : resultText;
				const callId = (data.callId as string) ?? "tool";
				view.updateToolCall(callId, { name: callId, status: "completed", result: summary });
				break;
			}

			case "step/start":
			case "step/end":
				break;

			case "turn/end": {
				if (this.isStreaming) {
					this.isStreaming = false;
					view.finalizeStreamingMessage();
					view.setInputEnabled(true);
					view.setStatus("connected");
				}
				break;
			}

			case "user/message":
				break;

			default:
				break;
		}
	}

	// ─── HostFrame dispatch ────────────────────────────────────────────

	private handleHostFrame(frame: HostFrame): void {
		const f = frame as { type: string; [key: string]: unknown };
		switch (f.type) {
			case "host/session-status": {
				const running = f.running as boolean;
				const sessionId = f.sessionId as string;
				const view = this.getChatView();
				if (view && sessionId === this.modeManager.getSessionId()) {
					view.setStatus(running ? "streaming" : "connected");
				}
				break;
			}
			case "host/agent-error": {
				const view = this.getChatView();
				if (view && f.sessionId === this.modeManager.getSessionId()) {
					if (this.isStreaming) {
						this.isStreaming = false;
						view.finalizeStreamingMessage();
					}
					view.addMessage(
						HarnessClient.buildMessage("system", `Agent error: ${f.message}`)
					);
					view.setInputEnabled(true);
					view.setStatus("connected");
				}
				break;
			}
			default:
				// Workspace events, session-added/removed — not needed for MVP
				break;
		}
	}

	// ─── Approval handling ─────────────────────────────────────────────

	private async handleApprovalRequest(
		frame: ApprovalRequestedFrame,
		view: ChatPanelView
	): Promise<void> {
		const toolName = frame.toolName;
		const decision = await this.approvalStrategy.getDecision(toolName);

		switch (decision.level) {
			case ApprovalLevel.Silent:
				// Auto-approve
				await this.client.respond(frame.approvalId, {
					type: "approval",
					sessionId: frame.sessionId,
					approvalId: frame.approvalId,
					outcome: "allowed-once",
				});
				break;
			case ApprovalLevel.Notify:
				view.showNotification(`${decision.description}`);
				await this.client.respond(frame.approvalId, {
					type: "approval",
					sessionId: frame.sessionId,
					approvalId: frame.approvalId,
					outcome: "allowed-once",
				});
				break;
			case ApprovalLevel.Confirm: {
				const approved = await view.showApprovalRequest(decision.action, decision.description);
				await this.client.respond(frame.approvalId, {
					type: "approval",
					sessionId: frame.sessionId,
					approvalId: frame.approvalId,
					outcome: approved ? "allowed-once" : "rejected",
				});
				if (!approved) {
					view.addMessage(
						HarnessClient.buildMessage("system", `Rejected: ${toolName}`)
					);
				}
				break;
			}
		}
	}

	// ─── Question handling ─────────────────────────────────────────────

	private async handleQuestionRequest(
		frame: QuestionRequestedFrame,
		view: ChatPanelView
	): Promise<void> {
		// For MVP: show the first question as a system message
		// Full implementation would show interactive question UI
		const q = frame.questions[0];
		if (!q) return;

		const text = q.header ? `${q.header}\n${q.question}` : q.question;
		view.addMessage(HarnessClient.buildMessage("system", `🤔 ${text}`));
		// TODO: implement interactive question answering UI
	}

	// ─── Message send ──────────────────────────────────────────────────

	private async handleSendMessage(content: string, pillRefs: string[]): Promise<void> {
		const view = this.getChatView();
		if (!view) return;

		// Check connectivity
		if (!this.client.isConnected()) {
			view.setStatus("disconnected");
			view.addMessage(
				HarnessClient.buildMessage("system", "DSH Harness is not connected. Check settings or start the harness.")
			);
			return;
		}

		// Parse @references
		const inlineRefs = this.referenceResolver.parseReferences(content);
		const pillParsed = pillRefs.map((p): import("./types").Reference => ({
			raw: p,
			type: p.includes("/") ? "folder-note" : "note",
			path: p,
		}));
		const allRefs = [...inlineRefs, ...pillParsed.filter(
			(pr) => !inlineRefs.some((ir) => ir.path === pr.path)
		)];

		let context: string | undefined;
		if (allRefs.length > 0) {
			context = await this.referenceResolver.buildContext(allRefs);
		}

		// Update context meter
		const contextLen = (context?.length ?? 0) + content.length;
		view.updateContextMeter(contextLen, this.settings.maxContextLength);

		// Show user message in panel
		view.addMessage(HarnessClient.buildMessage("user", content));

		// Ensure session exists
		let sid = this.modeManager.getSessionId();
		if (!sid) {
			await this.modeManager.switchMode(this.modeManager.getCurrentMode(), this.getVaultPath());
			sid = this.modeManager.getSessionId();
			if (!sid) {
				view.addMessage(
					HarnessClient.buildMessage("system", "Failed to create session. Is the DSH Harness running?")
				);
				return;
			}
		}

		// Send message to harness
		const fullContent = context
			? `[Context]\n${context}\n\n[User Message]\n${content}`
			: content;
		try {
			await this.client.sendMessage(sid, fullContent);
		} catch (e) {
			console.warn("dshdian: failed to send message", e);
			view.addMessage(
				HarnessClient.buildMessage("system", "Failed to send message. Check harness connection.")
			);
		}
		// Response arrives via mux WebSocket frames — no polling needed
	}

	// ─── View and mode management ─────────────────────────────────────

	private async activateView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
			this.app.workspace.revealLeaf(leaf);
			this.checkNoGitWarning();
		}
	}

	private async handleModeChange(mode: Mode): Promise<void> {
		const view = this.getChatView();
		if (view) {
			view.clearMessages();
			view.setMode(mode);
		}
		await this.modeManager.switchMode(mode, this.getVaultPath());

		if (mode === Mode.Creator) {
			this.pluginGenerator.watchGeneratedDir((pluginName) => {
				this.handleGeneratedFileChange(pluginName);
			});
		} else {
			this.pluginGenerator.stopWatching();
		}
	}

	private handleModelChange(model: string): void {
		this.settings.defaultModel = model;
	}

	private handleNewChat(): void {
		const view = this.getChatView();
		if (view) {
			view.clearMessages();
			view.updateContextMeter(0, this.settings.maxContextLength);
		}
		this.isStreaming = false;
		this.modeManager.switchMode(this.modeManager.getCurrentMode(), this.getVaultPath());
	}

	private async handleShowHistory(): Promise<void> {
		const view = this.getChatView();
		if (!view) return;

		if (!this.client.isConnected()) {
			new Notice("DSH 未连接");
			return;
		}

		try {
			const sessions = await this.client.listSessions();
			const currentSid = this.modeManager.getSessionId();

			// Filter out blank sessions and format for display
			const items = sessions
				.filter(s => !s.blank)
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.map(s => ({
					sessionId: s.sessionId,
					title: s.projections?.values?.title ?? s.sessionId.slice(8, 20),
					time: this.formatTime(s.updatedAt),
					active: s.sessionId === currentSid,
				}));

			view.showHistoryList(items, (sessionId) => {
				this.switchToSession(sessionId);
			});
		} catch (e) {
			new Notice("加载会话列表失败");
			console.warn("dshdian: failed to list sessions", e);
		}
	}

	/** Switch to an existing session: load its history and display */
	private async switchToSession(sessionId: string): Promise<void> {
		const view = this.getChatView();
		if (!view) return;

		view.clearMessages();
		view.setInputEnabled(false);

		// Update ModeManager's session reference
		this.modeManager.setSessionId(sessionId);
		this.isStreaming = false;

		try {
			const events = await this.client.getHistory(sessionId) as Array<{ event: { type: string; data?: Record<string, unknown>; [key: string]: unknown } }>;

			// Replay history: extract user messages and assistant messages
			for (const entry of events) {
				const ev = entry.event;
				if (!ev) continue;

				if (ev.type === "user/message" || ev.type === "agent/inbox/spliced") {
					// Extract user text from inbox spliced events
					const data = ev.data as Record<string, unknown> | undefined;
					if (ev.type === "agent/inbox/spliced") {
						const inserted = (data?.inserted as Array<{ content?: Array<{ type: string; text?: string }> }>) ?? [];
						for (const msg of inserted) {
							const text = msg.content?.find(c => c.type === "text")?.text;
							if (text) {
								view.addMessage(HarnessClient.buildMessage("user", text));
							}
						}
					}
				} else if (ev.type === "assistant/message") {
					// Complete assistant message
					const data = ev.data as { message?: { content?: Array<{ type: string; text?: string }> } } | undefined;
					const blocks = data?.message?.content ?? [];
					const text = blocks
						.filter(b => b.type === "text")
						.map(b => b.text ?? "")
						.join("");
					if (text) {
						view.addMessage(HarnessClient.buildMessage("assistant", text));
					}
				}
			}
		} catch (e) {
			view.addMessage(
				HarnessClient.buildMessage("system", "加载历史记录失败")
			);
			console.warn("dshdian: failed to load history", e);
		}

		view.setInputEnabled(true);
	}

	private formatTime(timestamp: number): string {
		const d = new Date(timestamp);
		const now = new Date();
		const isToday = d.toDateString() === now.toDateString();
		if (isToday) {
			return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
		}
		return d.toLocaleDateString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
	}

	private handleAddContext(): void {
		const view = this.getChatView();
		if (view) {
			view.addMessage(
				HarnessClient.buildMessage("system", "Use @ in the text field to add file context.")
			);
		}
	}

	private getAvailableCommands(): string[] {
		return ["clear", "mode", "model", "help"];
	}

	private async checkNoGitWarning(): Promise<void> {
		const hasGit = await this.approvalStrategy.isGitRepo();
		if (!hasGit) {
			const view = this.getChatView();
			if (view) view.showNoGitWarning();
		}
	}

	// ─── Creator mode helpers ──────────────────────────────────────────

	private async handleGeneratedFileChange(pluginName: string): Promise<void> {
		const view = this.getChatView();
		if (!view) return;

		try {
			const compiled = await this.pluginGenerator.compileGenerated(pluginName);
			if (!compiled) return;
			await this.pluginGenerator.hotReloadPreview(pluginName);
			view.showPreviewState(pluginName, {
				onInstall: () => this.handlePreviewInstall(pluginName),
				onRetry: () => this.handlePreviewRetry(),
				onAbandon: () => this.handlePreviewAbandon(pluginName),
			});
		} catch (e) {
			view.addMessage(
				HarnessClient.buildMessage("system", `Compile failed for ${pluginName}: ${String(e)}`)
			);
		}
	}

	private async handlePreviewInstall(pluginName: string): Promise<void> {
		const view = this.getChatView();
		try {
			await this.pluginGenerator.installPlugin(pluginName, pluginName);
			if (view) {
				view.addMessage(
					HarnessClient.buildMessage("system", `Plugin "${pluginName}" installed and enabled.`)
				);
			}
		} catch (e) {
			if (view) {
				view.addMessage(
					HarnessClient.buildMessage("system", `Install failed: ${String(e)}`)
				);
			}
		}
	}

	private handlePreviewRetry(): void {
		const view = this.getChatView();
		if (view) {
			view.addMessage(
				HarnessClient.buildMessage("system", "Continuing conversation. Describe your changes.")
			);
		}
	}

	private async handlePreviewAbandon(pluginName: string): Promise<void> {
		const view = this.getChatView();
		try {
			await this.pluginGenerator.abandonPreview(pluginName);
			if (view) {
				view.addMessage(
					HarnessClient.buildMessage("system", `Preview "${pluginName}" abandoned and cleaned up.`)
				);
			}
		} catch (e) {
			if (view) {
				view.addMessage(
					HarnessClient.buildMessage("system", `Abandon failed: ${String(e)}`)
				);
			}
		}
	}

	private getVaultPath(): string {
		return (this.app.vault.adapter as any).basePath ?? "";
	}

	private getChatView(): ChatPanelView | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		if (leaves.length === 0) return null;
		return leaves[0].view as ChatPanelView;
	}
}
