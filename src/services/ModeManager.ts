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
		systemPrompt:
			"You are a read-only assistant. Answer questions based on the vault content provided. " +
			"Do not modify any files. You have access only to read and search operations.\n\n" +
			"Available tools: obsidian_read, obsidian_search, obsidian_tags, obsidian_backlinks.",
		permission: Permission.Readonly,
		toolWhitelist: CHAT_TOOLS,
	},
	[Mode.Butler]: {
		name: "Butler",
		mode: Mode.Butler,
		systemPrompt:
			"You are a vault butler. You can create, move, modify, and delete notes and files.\n\n" +
			"Obsidian CLI quick-reference:\n" +
			"- obsidian_read(path): Read file content\n" +
			"- obsidian_search(query): Full-text search\n" +
			"- obsidian_tags(): List all tags\n" +
			"- obsidian_backlinks(path): Get backlinks for a note\n" +
			"- obsidian_write(path, content): Write/overwrite file\n" +
			"- obsidian_create(path, content?): Create new file\n" +
			"- obsidian_delete(path): Delete file\n" +
			"- obsidian_move(from, to): Move/rename file\n" +
			"- obsidian_rename(path, newName): Rename file\n" +
			"- obsidian_list(path?): List directory contents\n" +
			"- obsidian_mkdir(path): Create directory",
		permission: Permission.ReadWrite,
		toolWhitelist: CLI_TOOLS,
	},
	[Mode.Creator]: {
		name: "Creator",
		mode: Mode.Creator,
		systemPrompt:
			"You are a plugin creator. Generate complete, standalone Obsidian plugins.\n\n" +
			"Plugin API summary:\n" +
			"- Extend Plugin class with onload()/onunload()\n" +
			"- Register views, commands, settings via this.registerView/addCommand/addSettingTab\n" +
			"- Use app.vault for file ops, app.workspace for UI, app.metadataCache for metadata\n\n" +
			"Obsidian CLI quick-reference:\n" +
			"- obsidian_read, obsidian_search, obsidian_tags, obsidian_backlinks\n" +
			"- obsidian_write, obsidian_create, obsidian_delete, obsidian_move\n" +
			"- obsidian_rename, obsidian_list, obsidian_mkdir\n" +
			"- esbuild: Compile TypeScript plugin source to bundled main.js",
		permission: Permission.ReadWritePlugins,
		toolWhitelist: CREATOR_TOOLS,
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

	/** Get tool whitelist for current mode */
	getToolWhitelist(): string[] {
		return MODE_CONFIGS[this.currentMode].toolWhitelist;
	}

	/** Switch to a new mode — ends current session, creates new one */
	async switchMode(mode: Mode, vaultPath?: string): Promise<void> {
		if (mode === this.currentMode && this.sessionId !== null) {
			return;
		}
		// End current session by discarding reference
		this.sessionId = null;
		this.currentMode = mode;

		// Start new session via DSH RPC (session.create)
		try {
			this.sessionId = await this.client.createSession(vaultPath);
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

	/** Set session ID directly (for switching to an existing session) */
	setSessionId(sessionId: string): void {
		this.sessionId = sessionId;
	}
}
