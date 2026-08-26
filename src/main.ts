import { Plugin, WorkspaceLeaf } from "obsidian";
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
import type { StreamEvent } from "./types";

export default class DshdianPlugin extends Plugin {
	settings: DshdianSettings = DEFAULT_SETTINGS;

	processManager!: DshProcessManager;
	client!: HarnessClient;
	modeManager!: ModeManager;
	referenceResolver!: ReferenceResolver;
	approvalStrategy!: ApprovalStrategy;
	pluginGenerator!: PluginGenerator;

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
				onSendMessage: (content) => this.handleSendMessage(content),
				onModeChange: (mode) => this.handleModeChange(mode),
				onGetSuggestions: (query) => this.referenceResolver.getSuggestions(query),
			});
			return view;
		});

		// Ribbon icon to open/focus the chat panel
		this.addRibbonIcon("bot", "Open dshdian", () => {
			this.activateView();
		});

		// Settings tab
		this.addSettingTab(new DshdianSettingTab(this.app, this));

		// Start process manager if auto-start enabled
		if (this.settings.autoStartHarness) {
			this.processManager.start();
		}

		// Listen to process manager events to update UI status
		this.processManager.on("started", () => {
			const view = this.getChatView();
			if (view) view.setStatus("connected");
		});
		this.processManager.on("stopped", () => {
			const view = this.getChatView();
			if (view) view.setStatus("disconnected");
		});
		this.processManager.on("error", () => {
			const view = this.getChatView();
			if (view) view.setStatus("disconnected");
		});
	}

	onunload(): void {
		// Detach all chat panel leaves
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_CHAT);
		// Stop process monitoring
		this.processManager.stop();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
		// Update port in services
		this.client.setPort(this.settings.harnessPort);
		this.processManager.setPort(this.settings.harnessPort);
	}

	/** Open or focus the chat panel view */
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
		}
	}

	/** Handle message send from the chat panel */
	private async handleSendMessage(content: string): Promise<void> {
		const view = this.getChatView();
		if (!view) return;

		// Check harness connectivity
		if (!this.processManager.isRunning()) {
			view.setStatus("disconnected");
			view.addMessage(
				HarnessClient.buildMessage("system", "DSH Harness is not connected. Check settings or start the harness.")
			);
			return;
		}

		// Parse @references and build context
		const refs = this.referenceResolver.parseReferences(content);
		let context: string | undefined;
		if (refs.length > 0) {
			context = await this.referenceResolver.buildContext(refs);
		}

		// Show user message in panel
		view.addMessage(HarnessClient.buildMessage("user", content));

		// Ensure session exists
		let sid = this.modeManager.getSessionId();
		if (!sid) {
			await this.modeManager.switchMode(this.modeManager.getCurrentMode());
			sid = this.modeManager.getSessionId();
			if (!sid) {
				view.addMessage(
					HarnessClient.buildMessage("system", "Failed to create session. Is the DSH Harness running?")
				);
				return;
			}
		}

		// Send message to harness
		try {
			await this.client.sendMessage(sid, content, context);
		} catch (e) {
			console.warn("dshdian: failed to send message", e);
			view.addMessage(
				HarnessClient.buildMessage("system", "Failed to send message. Check harness connection.")
			);
			return;
		}

		// Disable input while streaming
		view.setInputEnabled(false);
		view.setStatus("streaming");

		// Start streaming response — render tokens in real-time
		view.startStreamingMessage();
		let currentToolName: string | null = null;

		this.client.streamResponse(
			sid,
			(event: StreamEvent) => {
				switch (event.type) {
					case "message":
						// Token-by-token append to the streaming message
						view.appendStreamToken(event.data);
						break;
					case "tool_call":
						// Parse tool call event: show tool name as running
						try {
							const info = JSON.parse(event.data);
							currentToolName = info.name ?? info.tool ?? "unknown";
						} catch {
							currentToolName = event.data || "unknown";
						}
						view.addToolCall({ name: currentToolName!, status: "running" });
						break;
					case "tool_result":
						// Tool completed — show result summary
						if (currentToolName) {
							const summary = event.data.length > 100
								? event.data.slice(0, 100) + "..."
								: event.data;
							view.updateToolCall(currentToolName, {
								name: currentToolName,
								status: "completed",
								result: summary,
							});
							currentToolName = null;
						}
						break;
					case "error":
						view.addMessage(HarnessClient.buildMessage("system", `Error: ${event.data}`));
						break;
					case "done":
						// Handled in onDone callback
						break;
				}
			},
			() => {
				// Stream complete
				view.finalizeStreamingMessage();
				view.setInputEnabled(true);
				view.setStatus("connected");
			},
			(err: string) => {
				view.finalizeStreamingMessage();
				view.addMessage(HarnessClient.buildMessage("system", `Stream error: ${err}`));
				view.setInputEnabled(true);
				view.setStatus("connected");
			}
		);
	}

	/** Handle mode switch from the chat panel */
	private async handleModeChange(mode: Mode): Promise<void> {
		const view = this.getChatView();
		if (view) {
			view.clearMessages();
		}
		await this.modeManager.switchMode(mode);
	}

	private getChatView(): ChatPanelView | null {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_CHAT);
		if (leaves.length === 0) return null;
		return leaves[0].view as ChatPanelView;
	}
}
