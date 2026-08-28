import { Events } from "obsidian";
import { Mode, Permission } from "../types";
import type { ModeConfig } from "../types";
import type { HarnessClient } from "./HarnessClient";

/** Tool sets */
const CHAT_TOOLS = ["obsidian_read", "obsidian_search", "obsidian_tags", "obsidian_backlinks"];
const CLI_TOOLS = [
	"obsidian_read", "obsidian_search", "obsidian_tags", "obsidian_backlinks",
	"obsidian_write", "obsidian_create", "obsidian_delete", "obsidian_move",
	"obsidian_rename", "obsidian_list", "obsidian_mkdir",
];
const CREATOR_TOOLS = [...CLI_TOOLS, "esbuild"];

const MODE_CONFIGS: Record<Mode, ModeConfig> = {
	[Mode.Chat]: {
		name: "Chat",
		mode: Mode.Chat,
		systemPrompt: "",
		permission: Permission.Readonly,
		toolWhitelist: CHAT_TOOLS,
	},
	[Mode.Butler]: {
		name: "Standard",
		mode: Mode.Butler,
		systemPrompt: "",
		permission: Permission.ReadWrite,
		toolWhitelist: CLI_TOOLS,
	},
	[Mode.Creator]: {
		name: "Create",
		mode: Mode.Creator,
		systemPrompt: "",
		permission: Permission.ReadWritePlugins,
		toolWhitelist: CREATOR_TOOLS,
	},
};

/** Maps Mode to DSH session.create params */
const MODE_DSH_PARAMS: Record<Mode, { agentPreset: string; permission: string }> = {
	[Mode.Chat]: { agentPreset: "standard", permission: "read-only" },
	[Mode.Butler]: { agentPreset: "standard", permission: "workspace-write" },
	[Mode.Creator]: { agentPreset: "cordis", permission: "danger-full-access" },
};

/** Maps Mode to DSH /permission command value */
const MODE_PERMISSION_CMD: Record<Mode, string> = {
	[Mode.Chat]: "read-only",
	[Mode.Butler]: "workspace-write",
	[Mode.Creator]: "danger-full-access",
};

/**
 * Manages mutually exclusive operating modes.
 * Chat ↔ Standard switches permission within same session.
 * Create requires a new session (different agentPreset).
 */
export class ModeManager extends Events {
	private currentMode: Mode = Mode.Chat;
	private sessionId: string | null = null;
	private client: HarnessClient;

	constructor(client: HarnessClient) {
		super();
		this.client = client;
	}

	getCurrentMode(): Mode {
		return this.currentMode;
	}

	getConfig(mode?: Mode): ModeConfig {
		return MODE_CONFIGS[mode ?? this.currentMode];
	}

	getSessionId(): string | null {
		return this.sessionId;
	}

	getToolWhitelist(): string[] {
		return MODE_CONFIGS[this.currentMode].toolWhitelist;
	}

	/**
	 * Switch mode. Chat ↔ Standard = permission change (same session).
	 * Anything involving Create = new session.
	 */
	async switchMode(mode: Mode, vaultPath?: string): Promise<boolean> {
		if (mode === this.currentMode) return false;

		const oldMode = this.currentMode;
		const needsNewSession = oldMode === Mode.Creator || mode === Mode.Creator;

		this.currentMode = mode;

		if (needsNewSession) {
			// Create requires different agentPreset — must create new session
			this.sessionId = null;
			try {
				const params = MODE_DSH_PARAMS[mode];
				this.sessionId = await this.client.createSession(vaultPath, params.agentPreset, params.permission);
			} catch (e) {
				console.warn("Dshdian: failed to create session", e);
				this.sessionId = null;
			}
			this.trigger("mode-changed", mode);
			return true; // signals: new session created, UI should clear
		} else {
			// Chat ↔ Standard: same session, switch permission
			if (this.sessionId) {
				const permCmd = MODE_PERMISSION_CMD[mode];
				try {
					await this.client.sendMessage(this.sessionId, `/permission ${permCmd}`);
				} catch (e) {
					console.warn("Dshdian: failed to switch permission", e);
				}
			}
			this.trigger("mode-changed", mode);
			return false; // signals: same session, don't clear UI
		}
	}

	/** Create initial session (call on first message if no session exists) */
	async ensureSession(vaultPath?: string): Promise<string | null> {
		if (this.sessionId) return this.sessionId;
		try {
			const params = MODE_DSH_PARAMS[this.currentMode];
			this.sessionId = await this.client.createSession(vaultPath, params.agentPreset, params.permission);
		} catch (e) {
			console.warn("Dshdian: failed to create session", e);
			this.sessionId = null;
		}
		return this.sessionId;
	}

	/** Reset session without switching mode */
	clearSession(): void {
		this.sessionId = null;
	}

	/** Set session ID directly (for switching to an existing session) */
	setSessionId(sessionId: string): void {
		this.sessionId = sessionId;
	}
}
