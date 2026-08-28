import { ItemView, Menu, WorkspaceLeaf, setIcon } from "obsidian";
import { Mode } from "../types";
import { renderMarkdown } from "./MarkdownRenderer";
import type { ChatMessage, ToolCallInfo } from "../types";

export const VIEW_TYPE_CHAT = "dshdian-chat-view";

/**
 * Main chat panel view for Dshdian.
 * DSH Web UI-inspired layout: message area with header actions,
 * composer card with context pills, textarea, and toolbar.
 */
export class ChatPanelView extends ItemView {
	private messageListEl: HTMLElement | null = null;
	private inputEl: HTMLTextAreaElement | null = null;
	private suggestionsEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private sessionTitleEl: HTMLElement | null = null;
	private pillContainerEl: HTMLElement | null = null;
	private composerEl: HTMLElement | null = null;
	private modeBtn: HTMLElement | null = null;
	private modelBtn: HTMLElement | null = null;
	private contextMeterEl: HTMLElement | null = null;

	/** The currently streaming assistant message element */
	private streamingMsgEl: HTMLElement | null = null;
	private streamingContentEl: HTMLElement | null = null;
	private streamingText = "";
	private streamRenderTimer: ReturnType<typeof setTimeout> | null = null;

	/** The currently streaming reasoning block element */
	private streamingReasoningEl: HTMLElement | null = null;
	private streamingReasoningText = "";
	private reasoningRenderTimer: ReturnType<typeof setTimeout> | null = null;

	/** Selected file references shown as pills */
	private selectedRefs: string[] = [];

	/** Current mode and model */
	private currentMode: Mode = Mode.Chat;
	private currentModel = "deepseek-chat";

	private static readonly MODE_DISPLAY_NAMES: Record<Mode, string> = {
		[Mode.Chat]: "聊天",
		[Mode.Butler]: "管家",
		[Mode.Creator]: "创造",
	};

	private onSendMessage: ((content: string, refs: string[]) => void) | null = null;
	private onModeChange: ((mode: Mode) => void) | null = null;
	private onModelChange: ((model: string) => void) | null = null;
	private onGetSuggestions: ((query: string) => string[]) | null = null;
	private onGetCommands: (() => string[]) | null = null;
	private onNewChat: (() => void) | null = null;
	private onShowHistory: (() => void) | null = null;
	private onAddContext: (() => void) | null = null;
	private onSaveAsNote: ((content: string) => void) | null = null;
	private onRetryMessage: (() => void) | null = null;

	getViewType(): string {
		return VIEW_TYPE_CHAT;
	}

	getDisplayText(): string {
		return "Dshdian";
	}

	getIcon(): string {
		return "dshdian-whale";
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
		onSaveAsNote: (content: string) => void;
		onRetryMessage: () => void;
	}): void {
		this.onSendMessage = handlers.onSendMessage;
		this.onModeChange = handlers.onModeChange;
		this.onModelChange = handlers.onModelChange;
		this.onGetSuggestions = handlers.onGetSuggestions;
		this.onGetCommands = handlers.onGetCommands;
		this.onNewChat = handlers.onNewChat;
		this.onShowHistory = handlers.onShowHistory;
		this.onAddContext = handlers.onAddContext;
		this.onSaveAsNote = handlers.onSaveAsNote;
		this.onRetryMessage = handlers.onRetryMessage;
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("dshdian-chat-container");

		// Header actions: status + [New] [History]
		const headerEl = container.createDiv({ cls: "dshdian-header-actions" });
		this.statusEl = headerEl.createEl("span", { cls: "dshdian-status" });

		// Add session title element
		const titleEl = headerEl.createEl("span", { cls: "dshdian-session-title" });
		this.sessionTitleEl = titleEl;

		const spacer = headerEl.createEl("span");
		spacer.style.flex = "1";

		const newBtn = headerEl.createEl("button", {
			cls: "clickable-icon dshdian-icon-btn",
			attr: { "aria-label": "New chat", title: "New chat" },
		});
		setIcon(newBtn, "message-square-plus");
		newBtn.addEventListener("click", () => {
			if (this.onNewChat) this.onNewChat();
		});

		const histBtn = headerEl.createEl("button", {
			cls: "clickable-icon dshdian-icon-btn",
			attr: { "aria-label": "History", title: "History" },
		});
		setIcon(histBtn, "history");
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
			cls: "clickable-icon dshdian-toolbar-btn",
			attr: { "aria-label": "Add context" },
		});
		setIcon(addCtxBtn, "plus");
		addCtxBtn.addEventListener("click", () => {
			if (this.onAddContext) this.onAddContext();
		});

		// Mode button - shows display name, click opens Menu
		this.modeBtn = toolbar.createEl("button", {
			cls: "dshdian-toolbar-btn dshdian-agent-btn",
		});
		this.modeBtn.textContent = ChatPanelView.MODE_DISPLAY_NAMES[this.currentMode];
		this.modeBtn.addEventListener("click", (e) => {
			const menu = new Menu();
			menu.addItem((item) => item.setTitle("聊天").onClick(() => this.onModeChange?.(Mode.Chat)));
			menu.addItem((item) => item.setTitle("管家").onClick(() => this.onModeChange?.(Mode.Butler)));
			menu.addItem((item) => item.setTitle("创造").onClick(() => this.onModeChange?.(Mode.Creator)));
			menu.showAtMouseEvent(e as unknown as MouseEvent);
		});

		// Model button - shows model name
		this.modelBtn = toolbar.createEl("button", {
			cls: "dshdian-toolbar-btn dshdian-model-btn",
		});
		this.modelBtn.textContent = this.currentModel;

		// Spacer
		toolbar.createEl("span", { cls: "dshdian-toolbar-spacer" });

		// Context meter
		this.contextMeterEl = toolbar.createEl("span", { cls: "dshdian-context-meter" });
		setIcon(this.contextMeterEl, "gauge");
		this.contextMeterEl.title = "Context: 0 / 50,000";

		// Send button
		const sendBtn = toolbar.createEl("button", { cls: "clickable-icon dshdian-send-btn" });
		setIcon(sendBtn, "arrow-up");
		sendBtn.addEventListener("click", () => {
			this.handleSend();
		});
	}

	async onClose(): Promise<void> {
		if (this.streamRenderTimer !== null) {
			clearTimeout(this.streamRenderTimer);
			this.streamRenderTimer = null;
		}
		if (this.reasoningRenderTimer !== null) {
			clearTimeout(this.reasoningRenderTimer);
			this.reasoningRenderTimer = null;
		}
		this.messageListEl = null;
		this.inputEl = null;
		this.suggestionsEl = null;
		this.statusEl = null;
		this.sessionTitleEl = null;
		this.pillContainerEl = null;
		this.composerEl = null;
		this.modeBtn = null;
		this.modelBtn = null;
		this.contextMeterEl = null;
		this.streamingMsgEl = null;
		this.streamingContentEl = null;
		this.streamingText = "";
		this.streamingReasoningEl = null;
		this.streamingReasoningText = "";
		this.selectedRefs = [];
	}

	/** Set the active mode and update toolbar button */
	setMode(mode: Mode): void {
		this.currentMode = mode;
		if (this.modeBtn) {
			this.modeBtn.textContent = ChatPanelView.MODE_DISPLAY_NAMES[mode];
		}
	}

	/** Set the current model and update toolbar button */
	setModel(model: string): void {
		this.currentModel = model;
		if (this.modelBtn) {
			this.modelBtn.textContent = this.currentModel;
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

	/** Update the session title displayed in the header */
	setSessionTitle(title: string): void {
		if (this.sessionTitleEl) {
			this.sessionTitleEl.textContent = title;
		}
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
			// Action buttons
			this.addMessageActions(msgEl, msg.content);
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
		// Show plain text immediately for responsiveness
		this.streamingContentEl.textContent = this.streamingText;
		// Debounced markdown render
		if (this.streamRenderTimer === null) {
			this.streamRenderTimer = setTimeout(() => {
				this.streamRenderTimer = null;
				if (this.streamingContentEl && this.streamingText) {
					renderMarkdown(this.streamingContentEl, this.streamingText, "", this);
				}
			}, 100);
		}
		this.scrollToBottom();
	}

	/** Start or get the collapsible reasoning block within the current streaming message */
	private ensureReasoningBlock(): HTMLElement | null {
		if (this.streamingReasoningEl) return this.streamingReasoningEl;
		if (!this.streamingMsgEl) return null;

		// Insert reasoning block before the content element
		const details = this.streamingMsgEl.createEl("details", { cls: "dshdian-reasoning" });
		details.setAttribute("open", "");
		details.createEl("summary", { cls: "dshdian-reasoning-summary", text: "Thinking..." });
		const content = details.createDiv({ cls: "dshdian-reasoning-content" });
		this.streamingReasoningEl = content;

		// Move it before the message content
		if (this.streamingContentEl) {
			this.streamingMsgEl.insertBefore(details, this.streamingContentEl);
		}
		return content;
	}

	/** Append reasoning token to the collapsible thinking block */
	appendReasoningToken(token: string): void {
		const el = this.ensureReasoningBlock();
		if (!el) return;
		this.streamingReasoningText += token;
		el.textContent = this.streamingReasoningText;
		// Debounced render for reasoning
		if (this.reasoningRenderTimer === null) {
			this.reasoningRenderTimer = setTimeout(() => {
				this.reasoningRenderTimer = null;
				if (this.streamingReasoningEl && this.streamingReasoningText) {
					renderMarkdown(this.streamingReasoningEl, this.streamingReasoningText, "", this);
				}
			}, 150);
		}
		this.scrollToBottom();
	}

	/** Show a tool call card with arguments */
	addToolCallCard(name: string, args?: string): void {
		if (!this.messageListEl) return;
		const el = this.messageListEl.createDiv({ cls: "dshdian-tool-card dshdian-tool-card-running" });
		el.dataset.toolName = name;

		const headerEl = el.createDiv({ cls: "dshdian-tool-card-header" });
		headerEl.createEl("span", { cls: "dshdian-tool-card-icon", text: "⚙️" });
		headerEl.createEl("span", { cls: "dshdian-tool-card-name", text: name });
		headerEl.createEl("span", { cls: "dshdian-tool-card-status", text: "running" });

		if (args) {
			const argsEl = el.createDiv({ cls: "dshdian-tool-card-args" });
			argsEl.textContent = args.length > 200 ? args.slice(0, 200) + "..." : args;
		}

		// Click to toggle expand
		headerEl.addEventListener("click", () => {
			el.toggleClass("dshdian-tool-card-expanded", !el.hasClass("dshdian-tool-card-expanded"));
		});

		this.scrollToBottom();
	}

	/** Update a tool call card with result */
	updateToolCallCard(name: string, status: "completed" | "failed", result?: string): void {
		if (!this.messageListEl) return;
		const cards = this.messageListEl.querySelectorAll(".dshdian-tool-card");
		for (let i = cards.length - 1; i >= 0; i--) {
			const card = cards[i] as HTMLElement;
			if (card.dataset.toolName === name) {
				card.className = `dshdian-tool-card dshdian-tool-card-${status}`;
				const statusEl = card.querySelector(".dshdian-tool-card-status");
				if (statusEl) statusEl.textContent = status;
				const iconEl = card.querySelector(".dshdian-tool-card-icon");
				if (iconEl) iconEl.textContent = status === "completed" ? "✅" : "❌";
				if (result) {
					let resultEl = card.querySelector(".dshdian-tool-card-result") as HTMLElement | null;
					if (!resultEl) {
						resultEl = card.createDiv({ cls: "dshdian-tool-card-result" });
					}
					resultEl.textContent = result;
				}
				break;
			}
		}
	}

	/** Finalize the streaming message — render as markdown */
	finalizeStreamingMessage(): void {
		if (this.streamRenderTimer !== null) {
			clearTimeout(this.streamRenderTimer);
			this.streamRenderTimer = null;
		}
		if (this.reasoningRenderTimer !== null) {
			clearTimeout(this.reasoningRenderTimer);
			this.reasoningRenderTimer = null;
		}
		// Finalize reasoning block
		if (this.streamingReasoningEl && this.streamingReasoningText) {
			renderMarkdown(this.streamingReasoningEl, this.streamingReasoningText, "", this);
			// Collapse reasoning after completion
			const details = this.streamingReasoningEl.parentElement;
			if (details && details.tagName === "DETAILS") {
				details.removeAttribute("open");
				const summary = details.querySelector("summary");
				if (summary) summary.textContent = "Thinking (click to expand)";
			}
		}
		this.streamingReasoningEl = null;
		this.streamingReasoningText = "";
		if (this.streamingMsgEl && this.streamingContentEl) {
			this.streamingMsgEl.removeClass("dshdian-message-streaming");
			const text = this.streamingText;
			const contentEl = this.streamingContentEl;
			renderMarkdown(contentEl, text, "", this);
			// Action buttons
			this.addMessageActions(this.streamingMsgEl, text);
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

	/** Show a mode switch suggestion banner */
	showModeSuggestion(message: string, mode: Mode, onSwitch: () => void): void {
		if (!this.messageListEl) return;
		const el = this.messageListEl.createDiv({ cls: "dshdian-mode-suggestion" });
		el.createEl("span", { cls: "dshdian-mode-suggestion-text", text: message });
		const btn = el.createEl("button", {
			cls: "dshdian-mode-suggestion-btn",
			text: `切换到${ChatPanelView.MODE_DISPLAY_NAMES[mode]}模式`,
		});
		btn.addEventListener("click", () => {
			el.remove();
			onSwitch();
		});
		// Auto-dismiss after 10 seconds
		setTimeout(() => { if (el.parentElement) el.remove(); }, 10000);
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

	/** Update context meter display */
	updateContextMeter(used: number, max: number): void {
		if (!this.contextMeterEl) return;
		const usedK = used >= 1000 ? `${(used / 1000).toFixed(1)}k` : String(used);
		const maxK = max >= 1000 ? `${(max / 1000).toFixed(0)}k` : String(max);
		this.contextMeterEl.title = `Tokens: ${usedK} / ${maxK}`;
		// Show usage text next to icon
		const textEl = this.contextMeterEl.querySelector(".dshdian-meter-text");
		if (textEl) {
			textEl.textContent = usedK;
		} else if (used > 0) {
			const span = document.createElement("span");
			span.className = "dshdian-meter-text";
			span.textContent = usedK;
			this.contextMeterEl.appendChild(span);
		}
		// Change color when near limit (>80%)
		const ratio = used / max;
		if (ratio > 0.8) {
			this.contextMeterEl.addClass("dshdian-context-meter-warn");
		} else {
			this.contextMeterEl.removeClass("dshdian-context-meter-warn");
		}
	}

	/** Add action buttons (Copy / Save as Note / Retry) to an assistant message */
	private addMessageActions(msgEl: HTMLElement, content: string): void {
		const actions = msgEl.createDiv({ cls: "dshdian-message-actions" });

		// Copy button
		const copyBtn = actions.createEl("button", {
			cls: "dshdian-action-btn",
			attr: { "aria-label": "Copy" },
		});
		setIcon(copyBtn, "copy");
		copyBtn.addEventListener("click", () => {
			navigator.clipboard.writeText(content).then(() => {
				setIcon(copyBtn, "check");
				setTimeout(() => setIcon(copyBtn, "copy"), 1500);
			});
		});

		// Save as Note button
		const saveBtn = actions.createEl("button", {
			cls: "dshdian-action-btn",
			attr: { "aria-label": "Save as Note" },
		});
		setIcon(saveBtn, "file-plus");
		saveBtn.addEventListener("click", () => {
			if (this.onSaveAsNote) this.onSaveAsNote(content);
		});

		// Retry button
		const retryBtn = actions.createEl("button", {
			cls: "dshdian-action-btn",
			attr: { "aria-label": "Retry" },
		});
		setIcon(retryBtn, "refresh-cw");
		retryBtn.addEventListener("click", () => {
			if (this.onRetryMessage) this.onRetryMessage();
		});
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

	// ─── Question interaction ──────────────────────────────────────────

	/** Show a question card with options for the user to answer */
	showQuestionCard(
		question: string,
		header: string | undefined,
		detail: string | undefined,
		options: Array<{ label: string; description?: string }> | undefined,
		multiSelect: boolean
	): Promise<string[] | null> {
		return new Promise((resolve) => {
			if (!this.messageListEl) {
				resolve(null);
				return;
			}
			const el = this.messageListEl.createDiv({ cls: "dshdian-question-card" });

			// Header
			if (header) {
				el.createEl("div", { cls: "dshdian-question-header", text: header });
			}

			// Question text
			el.createEl("div", { cls: "dshdian-question-text", text: question });

			// Detail
			if (detail) {
				el.createEl("div", { cls: "dshdian-question-detail", text: detail });
			}

			if (options && options.length > 0) {
				// Render options as clickable items
				const selected = new Set<string>();
				const optionsEl = el.createDiv({ cls: "dshdian-question-options" });

				for (const opt of options) {
					const optEl = optionsEl.createDiv({ cls: "dshdian-question-option" });
					optEl.createEl("span", { cls: "dshdian-question-option-label", text: opt.label });
					if (opt.description) {
						optEl.createEl("span", { cls: "dshdian-question-option-desc", text: opt.description });
					}
					optEl.addEventListener("click", () => {
						if (multiSelect) {
							if (selected.has(opt.label)) {
								selected.delete(opt.label);
								optEl.removeClass("dshdian-question-option-selected");
							} else {
								selected.add(opt.label);
								optEl.addClass("dshdian-question-option-selected");
							}
						} else {
							// Single select — resolve immediately
							el.remove();
							resolve([opt.label]);
						}
					});
				}

				if (multiSelect) {
					// Add confirm button for multi-select
					const btnRow = el.createDiv({ cls: "dshdian-question-buttons" });
					const confirmBtn = btnRow.createEl("button", { cls: "dshdian-question-confirm-btn", text: "Confirm" });
					const cancelBtn = btnRow.createEl("button", { cls: "dshdian-question-cancel-btn", text: "Cancel" });
					confirmBtn.addEventListener("click", () => { el.remove(); resolve([...selected]); });
					cancelBtn.addEventListener("click", () => { el.remove(); resolve(null); });
				}
			} else {
				// Free-text input
				const inputEl = el.createEl("input", {
					cls: "dshdian-question-input",
					attr: { type: "text", placeholder: "Type your answer..." },
				});
				const btnRow = el.createDiv({ cls: "dshdian-question-buttons" });
				const submitBtn = btnRow.createEl("button", { cls: "dshdian-question-confirm-btn", text: "Submit" });
				const cancelBtn = btnRow.createEl("button", { cls: "dshdian-question-cancel-btn", text: "Cancel" });
				submitBtn.addEventListener("click", () => {
					const val = inputEl.value.trim();
					el.remove();
					resolve(val ? [val] : null);
				});
				inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
					if (e.key === "Enter") {
						const val = inputEl.value.trim();
						el.remove();
						resolve(val ? [val] : null);
					}
				});
				cancelBtn.addEventListener("click", () => { el.remove(); resolve(null); });
			}

			this.scrollToBottom();
		});
	}

	// ─── History list ──────────────────────────────────────────────────

	/** Show a dropdown list of sessions. Returns the selected sessionId or null. */
	showHistoryList(
		sessions: Array<{ sessionId: string; title: string; time: string; active: boolean }>,
		onSelect: (sessionId: string) => void
	): void {
		// Remove existing dropdown if any
		const container = this.containerEl.children[1] as HTMLElement;
		const existing = container.querySelector(".dshdian-history-overlay");
		if (existing) existing.remove();

		const overlay = container.createDiv({ cls: "dshdian-history-overlay" });
		const panel = overlay.createDiv({ cls: "dshdian-history-panel" });

		// Header
		const header = panel.createDiv({ cls: "dshdian-history-header" });
		header.createEl("span", { text: "会话历史" });
		const closeBtn = header.createEl("button", {
			cls: "clickable-icon dshdian-history-close",
			attr: { "aria-label": "Close" },
		});
		setIcon(closeBtn, "x");
		closeBtn.addEventListener("click", () => overlay.remove());

		// Session list
		const list = panel.createDiv({ cls: "dshdian-history-list" });

		if (sessions.length === 0) {
			list.createDiv({ cls: "dshdian-history-empty", text: "暂无历史会话" });
		} else {
			for (const s of sessions) {
				const item = list.createDiv({
					cls: `dshdian-history-item ${s.active ? "dshdian-history-item-active" : ""}`,
				});
				item.createDiv({ cls: "dshdian-history-title", text: s.title });
				item.createDiv({ cls: "dshdian-history-time", text: s.time });
				item.addEventListener("click", () => {
					overlay.remove();
					onSelect(s.sessionId);
				});
			}
		}

		// Click overlay to close
		overlay.addEventListener("click", (e) => {
			if (e.target === overlay) overlay.remove();
		});
	}
}
