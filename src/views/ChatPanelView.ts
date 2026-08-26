import { ItemView, WorkspaceLeaf } from "obsidian";
import { Mode } from "../types";
import { renderMarkdown } from "./MarkdownRenderer";
import type { ChatMessage, ToolCallInfo } from "../types";

export const VIEW_TYPE_CHAT = "dshdian-chat-view";

/**
 * Main chat panel view for dshdian.
 * DSH Web UI-inspired layout: message area with header actions,
 * composer card with context pills, textarea, and toolbar.
 */
export class ChatPanelView extends ItemView {
	private messageListEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private suggestionsEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private pillContainerEl: HTMLElement | null = null;
	private composerEl: HTMLElement | null = null;
	private modeBtn: HTMLElement | null = null;
	private modelBtn: HTMLElement | null = null;

	/** The currently streaming assistant message element */
	private streamingMsgEl: HTMLElement | null = null;
	private streamingContentEl: HTMLElement | null = null;
	private streamingText = "";

	/** Selected file references shown as pills */
	private selectedRefs: string[] = [];

	/** Current mode and model */
	private currentMode: Mode = Mode.Chat;
	private currentModel = "deepseek-chat";

	private onSendMessage: ((content: string, refs: string[]) => void) | null = null;
	private onModeChange: ((mode: Mode) => void) | null = null;
	private onModelChange: ((model: string) => void) | null = null;
	private onGetSuggestions: ((query: string) => string[]) | null = null;
	private onGetCommands: (() => string[]) | null = null;
	private onNewChat: (() => void) | null = null;
	private onShowHistory: (() => void) | null = null;
	private onAddContext: (() => void) | null = null;

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return "dshdian";
	}

	getIcon(): string {
		return "bot";
	}

	/** Register external handlers */
	setHandlers(handlers: {
		onSendMessage: (content: string, refs: string[]) => void;
		onModeChange: (mode: Mode) => void;
		onModelChange: (model: string) => void;
		onGetSuggestions: (query: string) => string[];
		onGetCommands: () => string[];
		onNewChat: () => void;
		onShowHistory: () => void;
		onAddContext: () => void;
	}): void {
		this.onSendMessage = handlers.onSendMessage;
		this.onModeChange = handlers.onModeChange;
		this.onModelChange = handlers.onModelChange;
		this.onGetSuggestions = handlers.onGetSuggestions;
		this.onGetCommands = handlers.onGetCommands;
		this.onNewChat = handlers.onNewChat;
		this.onShowHistory = handlers.onShowHistory;
		this.onAddContext = handlers.onAddContext;
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("dshdian-chat-container");

		// Header actions: status + [New] [History]
		const headerEl = container.createDiv({ cls: "dshdian-header-actions" });
		this.statusEl = headerEl.createEl("span", { cls: "dshdian-status" });

		const spacer = headerEl.createEl("span");
		spacer.style.flex = "1";

		const newBtn = headerEl.createEl("button", {
			cls: "dshdian-icon-btn",
			attr: { "aria-label": "New chat", title: "New chat" },
		});
		newBtn.textContent = "✚";
		newBtn.addEventListener("click", () => {
			if (this.onNewChat) this.onNewChat();
		});

		const histBtn = headerEl.createEl("button", {
			cls: "dshdian-icon-btn",
			attr: { "aria-label": "History", title: "History" },
		});
		histBtn.textContent = "☰";
		histBtn.addEventListener("click", () => {
			if (this.onShowHistory) this.onShowHistory();
		});

		// Message list
		this.messageListEl = container.createDiv({ cls: "dshdian-message-list" });

		// Composer card
		this.composerEl = container.createDiv({ cls: "dshdian-composer" });
		this.composerEl.style.position = "relative";

		// Context pills
		this.pillContainerEl = this.composerEl.createDiv({ cls: "dshdian-pill-container" });

		// Textarea
		this.inputEl = this.composerEl.createEl("textarea", {
			cls: "dshdian-input",
			attr: {
				placeholder: "Message dshdian... Use @ to add context, / for commands",
				rows: "2",
			},
		});
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.handleSend();
			}
		});
		this.inputEl.addEventListener("input", () => {
			this.handleInputChange();
			this.autoResize();
		});

		// Suggestions dropdown (inside composer for positioning)
		this.suggestionsEl = this.composerEl.createDiv({
			cls: "dshdian-suggestions",
			attr: { style: "display:none" },
		});

		// Toolbar row
		const toolbar = this.composerEl.createDiv({ cls: "dshdian-toolbar" });

		// [+] Add context
		const addCtxBtn = toolbar.createEl("button", {
			cls: "dshdian-toolbar-btn",
			text: "+",
			attr: { "aria-label": "Add context" },
		});
		addCtxBtn.addEventListener("click", () => {
			if (this.onAddContext) this.onAddContext();
		});

		// Mode dropdown button
		this.modeBtn = toolbar.createEl("button", {
			cls: "dshdian-toolbar-btn",
			text: this.modeBtnLabel(),
		});
		this.modeBtn.addEventListener("click", () => {
			this.showModeMenu();
		});

		// Model dropdown button
		this.modelBtn = toolbar.createEl("button", {
			cls: "dshdian-toolbar-btn",
			text: `Model: ${this.currentModel}`,
		});
		this.modelBtn.addEventListener("click", () => {
			this.showModelMenu();
		});

		// Spacer
		toolbar.createEl("span", { cls: "dshdian-toolbar-spacer" });

		// Send button
		const sendBtn = toolbar.createEl("button", { cls: "dshdian-send-btn" });
		sendBtn.textContent = "↑";
		sendBtn.addEventListener("click", () => {
			this.handleSend();
		});
	}

	async onClose(): Promise<void> {
		this.messageListEl = null;
		this.inputEl = null;
		this.suggestionsEl = null;
		this.statusEl = null;
		this.pillContainerEl = null;
		this.composerEl = null;
		this.modeBtn = null;
		this.modelBtn = null;
		this.streamingMsgEl = null;
		this.streamingContentEl = null;
		this.streamingText = "";
		this.selectedRefs = [];
	}

	/** Set the active mode and update toolbar button */
	setMode(mode: Mode): void {
		this.currentMode = mode;
		if (this.modeBtn) {
			this.modeBtn.textContent = this.modeBtnLabel();
		}
	}

	/** Set the current model and update toolbar button */
	setModel(model: string): void {
		this.currentModel = model;
		if (this.modelBtn) {
			this.modelBtn.textContent = `Model: ${this.currentModel}`;
		}
	}

	/** Update connection status display */
	setStatus(status: "connected" | "disconnected" | "streaming"): void {
		if (!this.statusEl) return;
		this.statusEl.textContent = status === "connected" ? "●"
			: status === "streaming" ? "● streaming..."
			: "○ disconnected";
		this.statusEl.className = `dshdian-status dshdian-status-${status}`;
	}

	/** Add a completed message to the chat display */
	addMessage(msg: ChatMessage): void {
		if (!this.messageListEl) return;
		const msgEl = this.messageListEl.createDiv({
			cls: `dshdian-message dshdian-message-${msg.role}`,
		});

		if (msg.role === "assistant") {
			const contentEl = msgEl.createDiv({ cls: "dshdian-message-content" });
			renderMarkdown(contentEl, msg.content, "", this);
		} else {
			msgEl.createEl("div", { cls: "dshdian-message-content", text: msg.content });
		}
		this.scrollToBottom();
	}

	/** Start a streaming assistant message */
	startStreamingMessage(): void {
		if (!this.messageListEl) return;
		this.streamingText = "";
		const msgEl = this.messageListEl.createDiv({
			cls: "dshdian-message dshdian-message-assistant dshdian-message-streaming",
		});
		this.streamingContentEl = msgEl.createDiv({ cls: "dshdian-message-content" });
		this.streamingMsgEl = msgEl;
		this.scrollToBottom();
	}

	/** Append a token to the currently streaming message */
	appendStreamToken(token: string): void {
		if (!this.streamingContentEl) return;
		this.streamingText += token;
		this.streamingContentEl.textContent = this.streamingText;
		this.scrollToBottom();
	}

	/** Finalize the streaming message — render as markdown */
	finalizeStreamingMessage(): void {
		if (this.streamingMsgEl && this.streamingContentEl) {
			this.streamingMsgEl.removeClass("dshdian-message-streaming");
			const text = this.streamingText;
			const contentEl = this.streamingContentEl;
			renderMarkdown(contentEl, text, "", this);
		}
		this.streamingMsgEl = null;
		this.streamingContentEl = null;
		this.streamingText = "";
	}

	/** Display a tool call event in the chat */
	addToolCall(info: ToolCallInfo): void {
		if (!this.messageListEl) return;
		const el = this.messageListEl.createDiv({
			cls: `dshdian-tool-call dshdian-tool-${info.status}`,
		});
		const icon = info.status === "running" ? "⚙" : info.status === "completed" ? "✓" : "✗";
		el.createEl("span", { cls: "dshdian-tool-icon", text: icon });
		el.createEl("span", { cls: "dshdian-tool-name", text: info.name });
		if (info.result) {
			el.createEl("span", { cls: "dshdian-tool-result", text: info.result });
		}
		// Collapsible detail
		const detailEl = this.messageListEl.createDiv({ cls: "dshdian-tool-detail" });
		detailEl.textContent = info.result ?? "";
		el.addEventListener("click", () => {
			el.toggleClass("dshdian-tool-expanded", !el.hasClass("dshdian-tool-expanded"));
		});
		this.scrollToBottom();
	}

	/** Update an existing tool call element */
	updateToolCall(name: string, info: ToolCallInfo): void {
		if (!this.messageListEl) return;
		const els = this.messageListEl.querySelectorAll(".dshdian-tool-call");
		for (let i = els.length - 1; i >= 0; i--) {
			const nameEl = els[i].querySelector(".dshdian-tool-name");
			if (nameEl && nameEl.textContent === name) {
				const el = els[i] as HTMLElement;
				el.className = `dshdian-tool-call dshdian-tool-${info.status}`;
				const iconEl = el.querySelector(".dshdian-tool-icon");
				if (iconEl) {
					iconEl.textContent = info.status === "completed" ? "✓" : "✗";
				}
				if (info.result) {
					let resultEl = el.querySelector(".dshdian-tool-result") as HTMLElement | null;
					if (!resultEl) {
						resultEl = el.createEl("span", { cls: "dshdian-tool-result" });
					}
					resultEl.textContent = info.result;
					// Update detail
					const nextEl = el.nextElementSibling;
					if (nextEl && nextEl.hasClass("dshdian-tool-detail")) {
						nextEl.textContent = info.result;
					}
				}
				break;
			}
		}
	}

	/** Clear all messages from the display */
	clearMessages(): void {
		if (this.messageListEl) {
			this.messageListEl.empty();
		}
		this.streamingMsgEl = null;
		this.streamingContentEl = null;
		this.streamingText = "";
	}

	/** Show persistent no-git warning banner */
	showNoGitWarning(): void {
		if (!this.messageListEl) return;
		if (this.messageListEl.querySelector(".dshdian-no-git-warning")) return;
		const banner = document.createElement("div");
		banner.className = "dshdian-no-git-warning";
		banner.textContent = "⚠️ No git repository detected — all write operations will require confirmation.";
		this.messageListEl.insertBefore(banner, this.messageListEl.firstChild);
	}

	/** Show inline approval request with Approve/Reject buttons */
	showApprovalRequest(action: string, description: string): Promise<boolean> {
		return new Promise((resolve) => {
			if (!this.messageListEl) {
				resolve(false);
				return;
			}
			const el = this.messageListEl.createDiv({ cls: "dshdian-approval-request" });
			el.createEl("div", { cls: "dshdian-approval-desc", text: description });
			const btnRow = el.createDiv({ cls: "dshdian-approval-buttons" });
			const approveBtn = btnRow.createEl("button", { cls: "dshdian-approve-btn", text: "Approve" });
			const rejectBtn = btnRow.createEl("button", { cls: "dshdian-reject-btn", text: "Reject" });
			approveBtn.addEventListener("click", () => {
				el.remove();
				resolve(true);
			});
			rejectBtn.addEventListener("click", () => {
				el.remove();
				resolve(false);
			});
			this.scrollToBottom();
		});
	}

	/** Show a transient notification */
	showNotification(text: string): void {
		if (!this.messageListEl) return;
		const el = this.messageListEl.createDiv({ cls: "dshdian-notification" });
		el.textContent = text;
		this.scrollToBottom();
	}

	/** Show preview state banner */
	showPreviewState(
		pluginName: string,
		callbacks: { onInstall: () => void; onRetry: () => void; onAbandon: () => void }
	): void {
		if (!this.messageListEl) return;
		const existing = this.messageListEl.querySelector(".dshdian-preview-state");
		if (existing) existing.remove();

		const el = this.messageListEl.createDiv({ cls: "dshdian-preview-state" });
		el.createEl("span", { cls: "dshdian-preview-label", text: `Preview: ${pluginName}` });
		const btnRow = el.createDiv({ cls: "dshdian-preview-buttons" });

		const installBtn = btnRow.createEl("button", { cls: "dshdian-preview-install-btn", text: "Install" });
		const retryBtn = btnRow.createEl("button", { cls: "dshdian-preview-retry-btn", text: "Retry" });
		const abandonBtn = btnRow.createEl("button", { cls: "dshdian-preview-abandon-btn", text: "Abandon" });

		installBtn.addEventListener("click", () => { el.remove(); callbacks.onInstall(); });
		retryBtn.addEventListener("click", () => { el.remove(); callbacks.onRetry(); });
		abandonBtn.addEventListener("click", () => { el.remove(); callbacks.onAbandon(); });
		this.scrollToBottom();
	}

	/** Disable/enable input during streaming */
	setInputEnabled(enabled: boolean): void {
		if (this.inputEl) {
			this.inputEl.disabled = !enabled;
		}
	}

	// ─── Private helpers ───────────────────────────────────────────────

	private modeBtnLabel(): string {
		const name = this.currentMode.charAt(0).toUpperCase() + this.currentMode.slice(1);
		return `Agent: ${name}`;
	}

	private showModeMenu(): void {
		if (!this.modeBtn) return;
		// Simple dropdown via native select behavior
		const modes = Object.values(Mode);
		const currentIndex = modes.indexOf(this.currentMode);
		const nextIndex = (currentIndex + 1) % modes.length;
		const newMode = modes[nextIndex];
		this.currentMode = newMode;
		this.modeBtn.textContent = this.modeBtnLabel();
		if (this.onModeChange) this.onModeChange(newMode);
	}

	private showModelMenu(): void {
		// Cycle through known models for now
		const models = ["deepseek-chat", "deepseek-reasoner", "deepseek-coder"];
		const currentIndex = models.indexOf(this.currentModel);
		const nextIndex = (currentIndex + 1) % models.length;
		this.currentModel = models[nextIndex];
		if (this.modelBtn) {
			this.modelBtn.textContent = `Model: ${this.currentModel}`;
		}
		if (this.onModelChange) this.onModelChange(this.currentModel);
	}

	private scrollToBottom(): void {
		if (this.messageListEl) {
			this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
		}
	}

	private autoResize(): void {
		if (!this.inputEl) return;
		this.inputEl.style.height = "auto";
		this.inputEl.style.height = Math.min(this.inputEl.scrollHeight, 200) + "px";
	}

	private handleSend(): void {
		if (!this.inputEl || !this.onSendMessage) return;
		const content = this.inputEl.value.trim();
		if (content.length === 0 && this.selectedRefs.length === 0) return;
		this.onSendMessage(content, [...this.selectedRefs]);
		this.inputEl.value = "";
		this.inputEl.style.height = "auto";
		this.selectedRefs = [];
		if (this.pillContainerEl) this.pillContainerEl.empty();
		this.hideSuggestions();
	}

	private handleInputChange(): void {
		if (!this.inputEl || !this.suggestionsEl) return;
		const text = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart;
		const before = text.slice(0, cursorPos);

		// Check for / commands at start of input
		const slashMatch = before.match(/^\/(\w*)$/);
		if (slashMatch && this.onGetCommands) {
			const commands = this.onGetCommands();
			const query = slashMatch[1].toLowerCase();
			const filtered = query
				? commands.filter((c) => c.toLowerCase().includes(query))
				: commands;
			if (filtered.length > 0) {
				this.showSuggestions(filtered, true);
				return;
			}
		}

		// Check for @ mentions
		const atMatch = before.match(/@([#\w\-/.]*)$/);
		if (atMatch && this.onGetSuggestions) {
			const query = atMatch[1];
			const suggestions = this.onGetSuggestions(query);
			if (suggestions.length > 0) {
				this.showSuggestions(suggestions, false);
				return;
			}
		}

		this.hideSuggestions();
	}

	private showSuggestions(items: string[], isCommand: boolean): void {
		if (!this.suggestionsEl) return;
		this.suggestionsEl.empty();
		this.suggestionsEl.style.display = "block";
		for (const item of items.slice(0, 10)) {
			const el = this.suggestionsEl.createDiv({ cls: "dshdian-suggestion-item", text: item });
			el.addEventListener("click", () => {
				if (isCommand) {
					this.insertCommand(item);
				} else {
					this.insertSuggestion(item);
				}
			});
		}
	}

	private hideSuggestions(): void {
		if (!this.suggestionsEl) return;
		this.suggestionsEl.style.display = "none";
		this.suggestionsEl.empty();
	}

	private insertCommand(cmd: string): void {
		if (!this.inputEl) return;
		this.inputEl.value = `/${cmd} `;
		this.inputEl.selectionStart = this.inputEl.value.length;
		this.inputEl.selectionEnd = this.inputEl.value.length;
		this.inputEl.focus();
		this.hideSuggestions();
	}

	private insertSuggestion(item: string): void {
		if (!this.inputEl) return;
		const text = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart;
		const before = text.slice(0, cursorPos);
		const after = text.slice(cursorPos);
		const atMatch = before.match(/@([#\w\-/.]*)$/);
		if (atMatch && atMatch.index !== undefined) {
			const newBefore = before.slice(0, atMatch.index);
			this.inputEl.value = newBefore + after;
			this.inputEl.selectionStart = newBefore.length;
			this.inputEl.selectionEnd = newBefore.length;
		}
		if (!this.selectedRefs.includes(item)) {
			this.selectedRefs.push(item);
			this.addPill(item);
		}
		this.inputEl.focus();
		this.hideSuggestions();
	}

	private addPill(ref: string): void {
		if (!this.pillContainerEl) return;
		const pill = this.pillContainerEl.createEl("span", { cls: "dshdian-ref-pill", text: ref });
		const closeBtn = pill.createEl("span", { cls: "dshdian-ref-pill-close", text: "×" });
		closeBtn.addEventListener("click", () => {
			this.selectedRefs = this.selectedRefs.filter((r) => r !== ref);
			pill.remove();
		});
	}
}
