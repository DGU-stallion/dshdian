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
import type { SseEvent } from "./types";

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

		// Parse @references and build context
		const refs = this.referenceResolver.parseReferences(content);
		let context: string | undefined;
		if (refs.length > 0) {
			context = await this.referenceResolver.buildContext(refs);
		}

		// Show user message in panel
		view.addMessage(HarnessClient.buildMessage("user", content));

		// Ensure session exists
		const sessionId = this.modeManager.getSessionId();
		if (!sessionId) {
			view.addMessage(
				HarnessClient.buildMessage("system", "No active session. Switching mode to reconnect...")
			);
			await this.modeManager.switchMode(this.modeManager.getCurrentMode());
			const newSession = this.modeManager.getSessionId();
			if (!newSession) {
				view.addMessage(
					HarnessClient.buildMessage("system", "Failed to create session. Is the DSH Harness running?")
				);
				return;
			}
		}

		const sid = this.modeManager.getSessionId()!;

		try {
			await this.client.sendMessage(sid, content, context);
		} catch (e) {
			console.warn("dshdian: failed to send message", e);
			view.addMessage(
				HarnessClient.buildMessage("system", "Failed to send message. Check harness connection.")
			);
			return;
		}

		// Stream response
		let assistantContent = "";
		this.client.streamResponse(
			sid,
			(event: SseEvent) => {
				if (event.type === "message") {
					assistantContent += event.data;
					// Update the last assistant message in real-time
				} else if (event.type === "error") {
					view.addMessage(HarnessClient.buildMessage("system", `Error: ${event.data}`));
				}
			},
			() => {
				if (assistantContent.length > 0) {
					view.addMessage(HarnessClient.buildMessage("assistant", assistantContent));
				}
			},
			(err: string) => {
				view.addMessage(HarnessClient.buildMessage("system", `Stream error: ${err}`));
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
