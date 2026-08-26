import { Events } from "obsidian";
import { Mode, Permission } from "../types";
import type { ModeConfig } from "../types";
import type { HarnessClient } from "./HarnessClient";

const MODE_CONFIGS: Record<Mode, ModeConfig> = {
	[Mode.Chat]: {
		name: "Chat",
		mode: Mode.Chat,
		systemPrompt:
			"You are a read-only assistant. Answer questions based on the vault content provided. Do not modify any files.",
		permission: Permission.Readonly,
	},
	[Mode.Butler]: {
		name: "Butler",
		mode: Mode.Butler,
		systemPrompt:
			"You are a vault butler. You can create, move, modify, and delete notes and files using the obsidian CLI. Execute operations the user requests.",
		permission: Permission.ReadWrite,
	},
	[Mode.Creator]: {
		name: "Creator",
		mode: Mode.Creator,
		systemPrompt:
			"You are a plugin creator. Generate complete, standalone Obsidian plugins from the user's description. Output TypeScript source that compiles independently.",
		permission: Permission.ReadWritePlugins,
	},
};

/**
 * Manages mutually exclusive operating modes.
 * Switching ends the current session and starts a new one.
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

	/** Switch to a new mode — ends current session, creates new one */
	async switchMode(mode: Mode): Promise<void> {
		if (mode === this.currentMode && this.sessionId !== null) {
			return;
		}
		// End current session by discarding reference
		this.sessionId = null;
		this.currentMode = mode;

		// Start new session with mode-specific system prompt
		const config = MODE_CONFIGS[mode];
		try {
			this.sessionId = await this.client.createSession(config.systemPrompt);
		} catch (e) {
			// Session creation may fail if harness is down
			console.warn("dshdian: failed to create session", e);
			this.sessionId = null;
		}

		this.trigger("mode-changed", mode);
	}

	/** Reset session without switching mode */
	clearSession(): void {
		this.sessionId = null;
	}
}
