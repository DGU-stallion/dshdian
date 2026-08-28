import { Notice, Plugin, WorkspaceLeaf, addIcon } from "obsidian";
import { ChatPanelView, VIEW_TYPE_CHAT } from "./views/ChatPanelView";
import { DshProcessManager } from "./services/DshProcessManager";
import { HarnessClient } from "./services/HarnessClient";
import { ModeManager } from "./services/ModeManager";
import { ReferenceResolver } from "./services/ReferenceResolver";
import { ApprovalStrategy } from "./services/ApprovalStrategy";
import { PluginGenerator } from "./services/PluginGenerator";
import { IntentDetector } from "./services/IntentDetector";
import { VaultIndexer } from "./services/VaultIndexer";
import { DshdianSettingTab, DEFAULT_SETTINGS } from "./settings";
import { Mode } from "./types";
import type { DshdianSettings } from "./settings";
import { ApprovalLevel } from "./types";
import type { MuxFrame, HostFrame, ApprovalRequestedFrame, QuestionRequestedFrame, StreamChunk as StreamChunkType } from "./services/HarnessClient";

/** DSH black whale icon — derived from DeepSeek Harness official favicon (MIT). */
const WHALE_ICON = `<g transform="scale(2)"><path d="M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z" fill="currentColor" fill-rule="nonzero"/></g>`;

const ICON_NAME = "dshdian-whale";

export default class DshdianPlugin extends Plugin {
	settings: DshdianSettings = DEFAULT_SETTINGS;

	processManager!: DshProcessManager;
	client!: HarnessClient;
	modeManager!: ModeManager;
	referenceResolver!: ReferenceResolver;
	approvalStrategy!: ApprovalStrategy;
	pluginGenerator!: PluginGenerator;
	intentDetector!: IntentDetector;
	vaultIndexer!: VaultIndexer;

	/** Track whether a streaming assistant response is in progress */
	private isStreaming = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register custom whale icon
		addIcon(ICON_NAME, WHALE_ICON);

		// Initialize services
		this.client = new HarnessClient(this.settings.harnessPort);
		this.processManager = new DshProcessManager(this.settings.harnessPort);
		this.modeManager = new ModeManager(this.client);
		this.referenceResolver = new ReferenceResolver(this.app);
		this.approvalStrategy = new ApprovalStrategy(this.app, this.settings);
		this.pluginGenerator = new PluginGenerator(this.app);
		this.intentDetector = new IntentDetector();
		this.vaultIndexer = new VaultIndexer(this.app);

		// Invalidate vault index on file changes
		this.registerEvent(this.app.vault.on("create", () => this.vaultIndexer.invalidate()));
		this.registerEvent(this.app.vault.on("delete", () => this.vaultIndexer.invalidate()));
		this.registerEvent(this.app.vault.on("rename", () => this.vaultIndexer.invalidate()));

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
				onSaveAsNote: (content) => this.handleSaveAsNote(content),
				onRetryMessage: () => this.handleRetryMessage(),
				onOpenFile: (path) => this.handleOpenFile(path),
			});
			view.setMode(this.settings.defaultMode);
			view.setModel(this.settings.defaultModel);
			return view;
		});

		// Ribbon icon to open/focus the chat panel
		this.addRibbonIcon(ICON_NAME, "Open Dshdian", () => {
			this.activateView();
		});

		// Keyboard shortcuts
		this.addCommand({
			id: "focus-input",
			name: "Focus chat input",
			hotkeys: [{ modifiers: ["Mod"], key: "l" }],
			callback: () => {
				const view = this.getChatView();
				if (view) view.focusInput();
			},
		});

		this.addCommand({
			id: "new-chat",
			name: "New chat",
			hotkeys: [{ modifiers: ["Mod"], key: "n" }],
			callback: () => {
				this.handleNewChat();
			},
		});

		this.addCommand({
			id: "cancel-stream",
			name: "Cancel streaming",
			hotkeys: [{ modifiers: [], key: "Escape" }],
			callback: () => {
				if (this.isStreaming) {
					const sid = this.modeManager.getSessionId();
					if (sid) {
						this.client.cancelSession(sid).catch(() => {});
					}
				}
			},
		});

		// Command: open chat in a new split pane (multi-session)
		this.addCommand({
			id: "open-new-pane",
			name: "Open chat in new pane",
			callback: () => {
				this.openNewChatPane();
			},
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
		this.approvalStrategy.updateSettings(this.settings);
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
			case "session/projection": {
				const projFrame = frame as { type: string; sessionId: string; key: string; value: unknown };
				if (projFrame.sessionId !== currentSessionId) break;
				if (projFrame.key === "title") {
					const title = projFrame.value as string;
					if (title) view.setSessionTitle(title);
				} else if (projFrame.key === "tokenUsage") {
					const usage = projFrame.value as { total_tokens?: number; prompt_tokens?: number; completion_tokens?: number } | undefined;
					if (usage) {
						const total = usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
						view.updateContextMeter(total, 128000);
					}
				}
				break;
			}
			default:
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
							view.appendReasoningToken(chunk.text);
						}
						break;
					case "usage": {
						const usage = chunk.usage as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
						if (usage) {
							const total = usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0);
							view.updateContextMeter(total, 128000); // DeepSeek context window
						}
						break;
					}
					case "tool-call-delta":
					case "block-start":
					case "block-end":
					case "finish":
						break;
				}
				break;
			}

			case "assistant/message":
				break;

			case "tool/call": {
				const name = (data.name as string) ?? "unknown";
				const args = data.arguments as string | undefined;
				view.addToolCallCard(name, args);
				break;
			}

			case "tool/result": {
				const message = data.message as { content?: Array<{ text?: string }> } | undefined;
				const resultText = message?.content?.[0]?.text ?? "";
				const summary = resultText.length > 100 ? resultText.slice(0, 100) + "..." : resultText;
				const toolName = (data.name as string) ?? (data.callId as string) ?? "tool";
				view.updateToolCallCard(toolName, "completed", summary);
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
			case "host/remote-event": {
				const event = f.event as string;
				const args = f.args as unknown[];
				this.handleRemoteEvent(event, args);
				break;
			}
			default:
				// Workspace events, session-added/removed — not needed for MVP
				break;
		}
	}

	/** Handle remote events from DSH (GUI Action Bridge) */
	private handleRemoteEvent(event: string, args: unknown[]): void {
		switch (event) {
			case "open-file": {
				const path = args[0] as string;
				if (path) this.app.workspace.openLinkText(path, "", false);
				break;
			}
			case "open-file-split": {
				const path = args[0] as string;
				if (path) this.app.workspace.openLinkText(path, "", true);
				break;
			}
			case "create-note": {
				const path = args[0] as string;
				const content = (args[1] as string) ?? "";
				if (path) {
					this.app.vault.create(path, content).then(() => {
						this.app.workspace.openLinkText(path, "", false);
					}).catch((e) => {
						console.warn("Dshdian: create-note failed", e);
					});
				}
				break;
			}
			case "navigate-heading": {
				const path = args[0] as string;
				const heading = args[1] as string;
				if (path && heading) {
					this.app.workspace.openLinkText(`${path}#${heading}`, "", false);
				}
				break;
			}
			case "reveal-in-explorer": {
				const path = args[0] as string;
				if (path) {
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file) {
						(this.app as any).internalPlugins?.plugins?.["file-explorer"]?.instance?.revealInFolder(file);
					}
				}
				break;
			}
			default:
				console.warn(`Dshdian: unknown remote event: ${event}`);
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
		const rpcId = (frame as any).__rpcId as string | undefined;
		if (!rpcId) {
			// Cannot respond without rpcId — fallback to system message
			const q = frame.questions[0];
			if (q) {
				view.addMessage(HarnessClient.buildMessage("system", `🤔 ${q.question}`));
			}
			return;
		}

		// Process each question sequentially
		const answers: Array<{ id: string; answer: string[] }> = [];
		for (const q of frame.questions) {
			const result = await view.showQuestionCard(
				q.question,
				q.header,
				q.detail,
				q.options,
				q.multiSelect ?? false
			);
			if (result === null) {
				// User cancelled
				await this.client.respond(rpcId, {
					type: "question",
					outcome: "cancelled",
				});
				return;
			}
			answers.push({ id: q.id, answer: result });
		}

		// Send answers back
		await this.client.respond(rpcId, {
			type: "question",
			outcome: "answered",
			answers,
		});
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

		// Handle slash commands
		if (content.startsWith("/")) {
			const handled = await this.handleSlashCommand(content, view);
			if (handled) return;
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

		// Intent detection: suggest mode switch if write intent in Chat mode
		const suggestedMode = this.intentDetector.detect(content, this.modeManager.getCurrentMode());
		if (suggestedMode) {
			const msg = this.intentDetector.getSuggestionMessage(suggestedMode);
			view.showModeSuggestion(msg, suggestedMode, () => {
				this.handleModeChange(suggestedMode);
			});
		}

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

		// Inject vault structure index
		const vaultIndex = this.vaultIndexer.getIndex();
		const contextParts: string[] = [];
		contextParts.push(`[Vault Info]\n${vaultIndex}`);
		if (context) {
			contextParts.push(`[Referenced Files]\n${context}`);
		}
		contextParts.push(`[User Message]\n${content}`);
		const fullContent = contextParts.join("\n\n");
		try {
			await this.client.sendMessage(sid, fullContent);
		} catch (e) {
			console.warn("Dshdian: failed to send message", e);
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
			view.setSessionTitle("");
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
			const vaultPath = this.getVaultPath();

			// Filter out blank sessions and non-vault sessions, then format
			const items = sessions
				.filter(s => !s.blank && s.cwd === vaultPath)
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
			console.warn("Dshdian: failed to list sessions", e);
		}
	}

	/** Switch to an existing session: load its history and display */
	private async switchToSession(sessionId: string): Promise<void> {
		const view = this.getChatView();
		if (!view) return;

		view.clearMessages();
		view.setSessionTitle("");
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
			console.warn("Dshdian: failed to load history", e);
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
		if (!view) return;
		// Trigger the @ suggestion flow by inserting @ into the input
		view.triggerFilePicker();
	}

	private async handleSlashCommand(content: string, view: ChatPanelView): Promise<boolean> {
		const [cmd, ...args] = content.slice(1).split(" ");
		switch (cmd) {
			case "clear":
				view.clearMessages();
				view.setSessionTitle("");
				return true;
			case "suggest": {
				const activeFile = this.app.workspace.getActiveFile();
				if (!activeFile) {
					view.addMessage(HarnessClient.buildMessage("system", "No active note open."));
					return true;
				}
				const noteContent = await this.app.vault.cachedRead(activeFile);
				const prompt = `Analyze this note and suggest improvements (better tags, internal links to create, formatting improvements, missing metadata):\n\nFile: ${activeFile.path}\n\n${noteContent}`;
				view.addMessage(HarnessClient.buildMessage("user", `/suggest ${activeFile.path}`));
				let sid = this.modeManager.getSessionId();
				if (!sid) {
					await this.modeManager.switchMode(this.modeManager.getCurrentMode(), this.getVaultPath());
					sid = this.modeManager.getSessionId();
				}
				if (sid) {
					await this.client.sendMessage(sid, prompt);
				}
				return true;
			}
			case "concept": {
				const topic = args.join(" ") || "the vault structure";
				const vaultIndex = this.vaultIndexer.getIndex();
				const prompt = `Generate a Mermaid concept map diagram showing relationships between the main concepts in: ${topic}\n\nVault context:\n${vaultIndex}\n\nOutput a valid Mermaid flowchart diagram wrapped in a \`\`\`mermaid code block.`;
				view.addMessage(HarnessClient.buildMessage("user", `/concept ${topic}`));
				let sid = this.modeManager.getSessionId();
				if (!sid) {
					await this.modeManager.switchMode(this.modeManager.getCurrentMode(), this.getVaultPath());
					sid = this.modeManager.getSessionId();
				}
				if (sid) {
					await this.client.sendMessage(sid, prompt);
				}
				return true;
			}
			case "batch": {
				const instruction = args.join(" ");
				if (!instruction) {
					view.addMessage(HarnessClient.buildMessage("system", "Usage: /batch <instruction>\nApplies the instruction to all notes in the current folder."));
					return true;
				}
				const activeFile = this.app.workspace.getActiveFile();
				const folder = activeFile?.parent?.path ?? "";
				const files = this.app.vault.getMarkdownFiles()
					.filter(f => f.path.startsWith(folder + "/") || (!folder && !f.path.includes("/")))
					.slice(0, 20); // Limit to 20 files
				const fileList = files.map(f => f.path).join("\n");
				const prompt = `Batch operation on ${files.length} notes in folder "${folder || "/"}":\n\nInstruction: ${instruction}\n\nFiles:\n${fileList}\n\nProcess each file according to the instruction. Show what changes you'll make before executing.`;
				view.addMessage(HarnessClient.buildMessage("user", `/batch ${instruction}`));
				let sid = this.modeManager.getSessionId();
				if (!sid) {
					await this.modeManager.switchMode(this.modeManager.getCurrentMode(), this.getVaultPath());
					sid = this.modeManager.getSessionId();
				}
				if (sid) {
					await this.client.sendMessage(sid, prompt);
				}
				return true;
			}
			case "mode":
			case "model":
			case "help":
				// These are handled by the suggestions UI, not as actual commands
				return false;
			default:
				return false;
		}
	}

	private async handleSaveAsNote(content: string): Promise<void> {
		const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const path = `Dshdian Notes/${timestamp}.md`;
		try {
			const folder = this.app.vault.getAbstractFileByPath("Dshdian Notes");
			if (!folder) {
				await this.app.vault.createFolder("Dshdian Notes");
			}
			await this.app.vault.create(path, content);
			new Notice(`Saved to ${path}`);
		} catch (e) {
			new Notice("Failed to save note");
			console.warn("Dshdian: save as note failed", e);
		}
	}

	private handleRetryMessage(): void {
		// Cancel current and resend last user message
		const view = this.getChatView();
		if (!view) return;
		const sid = this.modeManager.getSessionId();
		if (sid) {
			this.client.cancelSession(sid).catch(() => {});
		}
		view.addMessage(HarnessClient.buildMessage("system", "Retrying..."));
	}

	private handleOpenFile(filePath: string): void {
		const file = this.app.vault.getAbstractFileByPath(filePath);
		if (file) {
			this.app.workspace.openLinkText(filePath, "", false);
		} else {
			new Notice(`File not found: ${filePath}`);
		}
	}

	private getAvailableCommands(): string[] {
		return ["clear", "mode", "model", "suggest", "concept", "batch", "help"];
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
		// Prefer the active leaf if it's a chat view
		const active = this.app.workspace.activeLeaf;
		if (active && leaves.includes(active)) {
			return active.view as ChatPanelView;
		}
		return leaves[0].view as ChatPanelView;
	}

	private async openNewChatPane(): Promise<void> {
		const leaf = this.app.workspace.getLeaf("split");
		await leaf.setViewState({ type: VIEW_TYPE_CHAT, active: true });
		this.app.workspace.revealLeaf(leaf);
	}
}
