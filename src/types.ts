/** Mutually exclusive operating modes */
export enum Mode {
	Chat = "chat",
	Butler = "butler",
	Creator = "creator",
}

/** Permission level per mode */
export enum Permission {
	Readonly = "readonly",
	ReadWrite = "readwrite",
	ReadWritePlugins = "readwrite+plugins",
}

/** Mode configuration */
export interface ModeConfig {
	name: string;
	mode: Mode;
	systemPrompt: string;
	permission: Permission;
}

/** Chat message */
export interface ChatMessage {
	role: "user" | "assistant" | "system";
	content: string;
	timestamp: number;
}

/** SSE/WebSocket event types from the harness */
export type StreamEventType = "message" | "tool_call" | "tool_result" | "done" | "error";

/** Parsed streaming event */
export interface StreamEvent {
	type: StreamEventType;
	data: string;
}

/** Tool call information displayed in chat */
export interface ToolCallInfo {
	name: string;
	status: "running" | "completed" | "failed";
	result?: string;
}

/** Approval levels based on git state */
export enum ApprovalLevel {
	/** Has git, worktree clean — risky actions auto-approved */
	Auto = "auto",
	/** Has git, worktree dirty — risky actions need confirmation */
	ConfirmRisky = "confirm-risky",
	/** No git — all mutating actions need confirmation */
	ConfirmAll = "confirm-all",
}

/** Action risk classification */
export enum ActionRisk {
	Low = "low",
	Medium = "medium",
	High = "high",
}

/** Reference types for @mentions */
export interface Reference {
	raw: string;
	type: "note" | "folder-note" | "tag";
	path: string;
}

/** Resolved reference with content */
export interface ResolvedReference {
	ref: Reference;
	content: string;
}

/** Plugin spec from Creator mode AI output */
export interface PluginSpec {
	id: string;
	name: string;
	description: string;
	version: string;
	sources: Record<string, string>;
}
