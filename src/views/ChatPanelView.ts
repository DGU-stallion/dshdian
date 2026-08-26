import { ItemView, WorkspaceLeaf } from "obsidian";
import { Mode } from "../types";
import type { ChatMessage } from "../types";

export const VIEW_TYPE_CHAT = "dshdian-chat-view";

/**
 * Main chat panel view for dshdian.
 * Displays mode selector, message list, and input area with @mention support.
 */
export class ChatPanelView extends ItemView {
	private messageListEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private modeSelectEl: HTMLSelectElement | null = null;
	private suggestionsEl: HTMLElement | null = null;

	private onSendMessage: ((content: string) => void) | null = null;
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
		onSendMessage: (content: string) => void;
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

		// Mode selector
		const headerEl = container.createDiv({ cls: "dshdian-header" });
		this.modeSelectEl = headerEl.createEl("select", { cls: "dshdian-mode-select" });
		for (const mode of Object.values(Mode)) {
			this.modeSelectEl.createEl("option", {
				value: mode,
				text: mode.charAt(0).toUpperCase() + mode.slice(1),
			});
		}
		this.modeSelectEl.addEventListener("change", () => {
			if (this.modeSelectEl && this.onModeChange) {
				this.onModeChange(this.modeSelectEl.value as Mode);
			}
		});

		// Message list
		this.messageListEl = container.createDiv({ cls: "dshdian-message-list" });

		// Input area
		const inputArea = container.createDiv({ cls: "dshdian-input-area" });
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
		this.modeSelectEl = null;
		this.suggestionsEl = null;
	}

	/** Set the active mode in the dropdown */
	setMode(mode: Mode): void {
		if (this.modeSelectEl) {
			this.modeSelectEl.value = mode;
		}
	}

	/** Add a message to the chat display */
	addMessage(msg: ChatMessage): void {
		if (!this.messageListEl) return;
		const msgEl = this.messageListEl.createDiv({
			cls: `dshdian-message dshdian-message-${msg.role}`,
		});
		msgEl.createEl("span", { cls: "dshdian-message-role", text: msg.role });
		msgEl.createEl("div", { cls: "dshdian-message-content", text: msg.content });
	}

	/** Clear all messages from the display */
	clearMessages(): void {
		if (this.messageListEl) {
			this.messageListEl.empty();
		}
	}

	private handleSend(): void {
		if (!this.inputEl || !this.onSendMessage) return;
		const content = this.inputEl.value.trim();
		if (content.length === 0) return;
		this.onSendMessage(content);
		this.inputEl.value = "";
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
			const newBefore = before.slice(0, atMatch.index) + "@" + item + " ";
			this.inputEl.value = newBefore + after;
			this.inputEl.selectionStart = newBefore.length;
			this.inputEl.selectionEnd = newBefore.length;
		}
		this.hideSuggestions();
	}
}
