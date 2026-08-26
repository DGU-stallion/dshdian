import { ItemView, WorkspaceLeaf } from "obsidian";
import { Mode } from "../types";
import type { ChatMessage, ToolCallInfo } from "../types";

export const VIEW_TYPE_CHAT = "dshdian-chat-view";

/**
 * Main chat panel view for dshdian.
 * Displays mode selector, message list with streaming rendering,
 * tool call indicators, and input area with @mention support.
 */
export class ChatPanelView extends ItemView {
	private messageListEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private modeButtonsEl: HTMLElement | null = null;
	private suggestionsEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private pillContainerEl: HTMLElement | null = null;

	/** The currently streaming assistant message element (for in-place updates) */
	private streamingMsgEl: HTMLElement | null = null;

	/** Selected file references shown as pills */
	private selectedRefs: string[] = [];

	private onSendMessage: ((content: string, refs: string[]) => void) | null = null;
	private onModeChange: ((mode: Mode) => void) | null = null;
	private onGetSuggestions: ((query: string) => string[]) | null = null;

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
		onGetSuggestions: (query: string) => string[];
	}): void {
		this.onSendMessage = handlers.onSendMessage;
		this.onModeChange = handlers.onModeChange;
		this.onGetSuggestions = handlers.onGetSuggestions;
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("dshdian-chat-container");

		// Header with mode buttons + status
		const headerEl = container.createDiv({ cls: "dshdian-header" });
		this.modeButtonsEl = headerEl.createDiv({ cls: "dshdian-mode-buttons" });
		for (const mode of Object.values(Mode)) {
			const btn = this.modeButtonsEl.createEl("button", {
				cls: "dshdian-mode-btn",
				text: mode.charAt(0).toUpperCase() + mode.slice(1),
				attr: { "data-mode": mode },
			});
			btn.addEventListener("click", () => {
				if (this.onModeChange) {
					this.onModeChange(mode);
				}
			});
		}
		// Highlight first mode by default
		this.highlightModeButton(Mode.Chat);

		this.statusEl = headerEl.createEl("span", { cls: "dshdian-status", text: "" });

		// Message list
		this.messageListEl = container.createDiv({ cls: "dshdian-message-list" });

		// Input area
		const inputArea = container.createDiv({ cls: "dshdian-input-area" });
		this.pillContainerEl = inputArea.createDiv({ cls: "dshdian-pill-container" });
		this.inputEl = inputArea.createEl("textarea", {
			cls: "dshdian-input",
			attr: { placeholder: "Type a message... (@mention to reference files)", rows: "3" },
		});
		this.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				this.handleSend();
			}
		});
		this.inputEl.addEventListener("input", () => {
			this.handleInputChange();
		});

		// Suggestions dropdown
		this.suggestionsEl = inputArea.createDiv({ cls: "dshdian-suggestions", attr: { style: "display:none" } });

		// Send button
		const sendBtn = inputArea.createEl("button", { cls: "dshdian-send-btn", text: "Send" });
		sendBtn.addEventListener("click", () => {
			this.handleSend();
		});
	}

	async onClose(): Promise<void> {
		this.messageListEl = null;
		this.inputEl = null;
		this.modeButtonsEl = null;
		this.suggestionsEl = null;
		this.statusEl = null;
		this.pillContainerEl = null;
		this.streamingMsgEl = null;
		this.selectedRefs = [];
	}

	/** Set the active mode and highlight the corresponding button */
	setMode(mode: Mode): void {
		this.highlightModeButton(mode);
	}

	private highlightModeButton(mode: Mode): void {
		if (!this.modeButtonsEl) return;
		const buttons = this.modeButtonsEl.querySelectorAll(".dshdian-mode-btn");
		buttons.forEach((btn) => {
			const el = btn as HTMLElement;
			if (el.dataset.mode === mode) {
				el.addClass("dshdian-mode-active");
			} else {
				el.removeClass("dshdian-mode-active");
			}
		});
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
		msgEl.createEl("span", { cls: "dshdian-message-role", text: msg.role });
		msgEl.createEl("div", { cls: "dshdian-message-content", text: msg.content });
		this.scrollToBottom();
	}

	/**
	 * Start a streaming assistant message — creates the element and returns it.
	 * Subsequent calls to appendStreamToken() update this element in-place.
	 */
	startStreamingMessage(): void {
		if (!this.messageListEl) return;
		const msgEl = this.messageListEl.createDiv({
			cls: "dshdian-message dshdian-message-assistant dshdian-message-streaming",
		});
		msgEl.createEl("span", { cls: "dshdian-message-role", text: "assistant" });
		msgEl.createEl("div", { cls: "dshdian-message-content" });
		this.streamingMsgEl = msgEl;
		this.scrollToBottom();
	}

	/** Append a token to the currently streaming message */
	appendStreamToken(token: string): void {
		if (!this.streamingMsgEl) return;
		const contentEl = this.streamingMsgEl.querySelector(".dshdian-message-content");
		if (contentEl) {
			contentEl.textContent = (contentEl.textContent ?? "") + token;
		}
		this.scrollToBottom();
	}

	/** Finalize the streaming message (remove streaming indicator) */
	finalizeStreamingMessage(): void {
		if (this.streamingMsgEl) {
			this.streamingMsgEl.removeClass("dshdian-message-streaming");
			this.streamingMsgEl = null;
		}
	}

	/** Display a tool call event in the chat */
	addToolCall(info: ToolCallInfo): void {
		if (!this.messageListEl) return;
		const el = this.messageListEl.createDiv({
			cls: `dshdian-tool-call dshdian-tool-${info.status}`,
		});
		const icon = info.status === "running" ? "⚙️" : info.status === "completed" ? "✓" : "✗";
		el.createEl("span", { cls: "dshdian-tool-icon", text: icon });
		el.createEl("span", { cls: "dshdian-tool-name", text: info.name });
		if (info.result) {
			el.createEl("span", { cls: "dshdian-tool-result", text: info.result });
		}
		this.scrollToBottom();
	}

	/** Update an existing tool call element (e.g., from running → completed) */
	updateToolCall(name: string, info: ToolCallInfo): void {
		if (!this.messageListEl) return;
		// Find the most recent tool call with this name
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
	}

	/** Show persistent no-git warning banner at the top of the panel */
	showNoGitWarning(): void {
		if (!this.messageListEl) return;
		// Don't add duplicate warning
		if (this.messageListEl.querySelector(".dshdian-no-git-warning")) return;
		const banner = document.createElement("div");
		banner.className = "dshdian-no-git-warning";
		banner.textContent = "⚠️ No git repository detected — all write operations will require confirmation.";
		this.messageListEl.insertBefore(banner, this.messageListEl.firstChild);
	}

	/** Show inline approval request with Approve/Reject buttons. Returns promise resolving to user choice. */
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

	/** Show a transient notification in the message list (for Notify level) */
	showNotification(text: string): void {
		if (!this.messageListEl) return;
		const el = this.messageListEl.createDiv({ cls: "dshdian-notification" });
		el.textContent = text;
		this.scrollToBottom();
	}

	/** Show preview state banner with Install/Retry/Abandon buttons */
	showPreviewState(
		pluginName: string,
		callbacks: { onInstall: () => void; onRetry: () => void; onAbandon: () => void }
	): void {
		if (!this.messageListEl) return;
		// Remove any existing preview banner
		const existing = this.messageListEl.querySelector(".dshdian-preview-state");
		if (existing) existing.remove();

		const el = this.messageListEl.createDiv({ cls: "dshdian-preview-state" });
		el.createEl("span", { cls: "dshdian-preview-label", text: `Preview: ${pluginName}` });
		const btnRow = el.createDiv({ cls: "dshdian-preview-buttons" });

		const installBtn = btnRow.createEl("button", { cls: "dshdian-preview-install-btn", text: "Install" });
		const retryBtn = btnRow.createEl("button", { cls: "dshdian-preview-retry-btn", text: "Retry" });
		const abandonBtn = btnRow.createEl("button", { cls: "dshdian-preview-abandon-btn", text: "Abandon" });

		installBtn.addEventListener("click", () => {
			el.remove();
			callbacks.onInstall();
		});
		retryBtn.addEventListener("click", () => {
			el.remove();
			callbacks.onRetry();
		});
		abandonBtn.addEventListener("click", () => {
			el.remove();
			callbacks.onAbandon();
		});
		this.scrollToBottom();
	}

	/** Disable/enable input during streaming */
	setInputEnabled(enabled: boolean): void {
		if (this.inputEl) {
			this.inputEl.disabled = !enabled;
		}
	}

	private scrollToBottom(): void {
		if (this.messageListEl) {
			this.messageListEl.scrollTop = this.messageListEl.scrollHeight;
		}
	}

	private handleSend(): void {
		if (!this.inputEl || !this.onSendMessage) return;
		const content = this.inputEl.value.trim();
		if (content.length === 0 && this.selectedRefs.length === 0) return;
		this.onSendMessage(content, [...this.selectedRefs]);
		this.inputEl.value = "";
		this.selectedRefs = [];
		if (this.pillContainerEl) this.pillContainerEl.empty();
		this.hideSuggestions();
	}

	private handleInputChange(): void {
		if (!this.inputEl || !this.onGetSuggestions || !this.suggestionsEl) return;
		const text = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart;
		const before = text.slice(0, cursorPos);
		const atMatch = before.match(/@([#\w\-/]*)$/);

		if (atMatch) {
			const query = atMatch[1];
			const suggestions = this.onGetSuggestions(query);
			if (suggestions.length > 0) {
				this.showSuggestions(suggestions, atMatch.index ?? 0);
			} else {
				this.hideSuggestions();
			}
		} else {
			this.hideSuggestions();
		}
	}

	private showSuggestions(items: string[], _startIndex: number): void {
		if (!this.suggestionsEl) return;
		this.suggestionsEl.empty();
		this.suggestionsEl.style.display = "block";
		for (const item of items) {
			const el = this.suggestionsEl.createDiv({ cls: "dshdian-suggestion-item", text: item });
			el.addEventListener("click", () => {
				this.insertSuggestion(item);
			});
		}
	}

	private hideSuggestions(): void {
		if (!this.suggestionsEl) return;
		this.suggestionsEl.style.display = "none";
		this.suggestionsEl.empty();
	}

	private insertSuggestion(item: string): void {
		if (!this.inputEl) return;
		const text = this.inputEl.value;
		const cursorPos = this.inputEl.selectionStart;
		const before = text.slice(0, cursorPos);
		const after = text.slice(cursorPos);
		const atMatch = before.match(/@([#\w\-/]*)$/);
		if (atMatch && atMatch.index !== undefined) {
			// Remove the @query from textarea
			const newBefore = before.slice(0, atMatch.index);
			this.inputEl.value = newBefore + after;
			this.inputEl.selectionStart = newBefore.length;
			this.inputEl.selectionEnd = newBefore.length;
		}
		// Add as pill if not already selected
		if (!this.selectedRefs.includes(item)) {
			this.selectedRefs.push(item);
			this.addPill(item);
		}
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
