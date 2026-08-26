import { requestUrl } from "obsidian";
import type { ChatMessage, StreamEvent, StreamEventType } from "../types";

/**
 * DSH Harness API client.
 * Uses the actual DSH JSON-RPC protocol:
 * - POST /api/session.create → create session
 * - POST /api/session.prompt → send message
 * - WebSocket /api/events.mux → streaming events
 */
export class HarnessClient {
	private port: number;
	private ws: WebSocket | null = null;
	private eventHandler: ((event: StreamEvent) => void) | null = null;
	private doneHandler: (() => void) | null = null;
	private errorHandler: ((err: string) => void) | null = null;

	constructor(port: number) {
		this.port = port;
	}

	setPort(port: number): void {
		this.port = port;
	}

	private get baseUrl(): string {
		return `http://localhost:${this.port}`;
	}

	private get wsUrl(): string {
		return `ws://localhost:${this.port}`;
	}

	/** Generate a unique RPC ID */
	private rpcId(): string {
		return crypto.randomUUID();
	}

	/**
	 * Call a DSH RPC method via POST /api/{method}
	 * DSH protocol: { type: "client-request", rpcId, method, payload }
	 * Response: { type: "server-response", rpcId, result: { ok, value } }
	 */
	private async rpc<T>(method: string, payload: Record<string, unknown>): Promise<T> {
		const rpcId = this.rpcId();
		const body = {
			type: "client-request",
			rpcId,
			method,
			payload,
		};

		const resp = await requestUrl({
			url: `${this.baseUrl}/api/${method}`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});

		const data = resp.json;
		if (!data.result?.ok) {
			const errMsg = data.result?.error?.message ?? data.result?.error?.code ?? "RPC call failed";
			throw new Error(`${method}: ${errMsg}`);
		}
		return data.result.value as T;
	}

	/** Create a new session, returns session ID */
	async createSession(cwd?: string, agentPreset?: string): Promise<string> {
		const payload: Record<string, unknown> = {};
		if (cwd) payload.cwd = cwd;
		if (agentPreset) payload.agentPreset = agentPreset;

		const result = await this.rpc<{ sessionId: string; agentPreset?: string }>(
			"session.create",
			payload
		);
		return result.sessionId;
	}

	/** Send a message to an existing session */
	async sendMessage(sessionId: string, content: string): Promise<void> {
		await this.rpc<{ accepted: true }>("session.prompt", {
			sessionId,
			mode: "queue",
			content: [{ type: "text", text: content }],
		});
	}

	/** Get session history */
	async getHistory(sessionId: string): Promise<unknown[]> {
		const result = await this.rpc<{ events: unknown[]; hasMore: boolean }>(
			"session.history",
			{ sessionId }
		);
		return result.events;
	}

	/** List all sessions */
	async listSessions(): Promise<Array<{ sessionId: string; updatedAt: number; blank: boolean }>> {
		const result = await this.rpc<{ items: Array<{ sessionId: string; updatedAt: number; blank: boolean }> }>(
			"session.list",
			{}
		);
		return result.items;
	}

	/** Cancel (stop) a running session */
	async cancelSession(sessionId: string): Promise<void> {
		await this.rpc<{ accepted: true }>("session.cancel", { sessionId });
	}

	/**
	 * Connect to the mux event stream via WebSocket.
	 * DSH sends JSON frames: { type: "server-request", rpcId, payload: { ... } }
	 * Payload contains session events (message chunks, tool calls, etc.)
	 */
	connectMux(
		onEvent: (event: StreamEvent) => void,
		onDone: () => void,
		onError: (err: string) => void
	): void {
		this.eventHandler = onEvent;
		this.doneHandler = onDone;
		this.errorHandler = onError;

		const url = `${this.wsUrl}/api/events.mux`;

		try {
			this.ws = new WebSocket(url);
		} catch (e) {
			onError("Failed to connect WebSocket: " + String(e));
			return;
		}

		this.ws.onmessage = (event: MessageEvent) => {
			this.handleMuxFrame(String(event.data));
		};

		this.ws.onerror = () => {
			this.errorHandler?.("WebSocket connection error");
		};

		this.ws.onclose = (event: CloseEvent) => {
			this.ws = null;
			if (event.code === 1000 || event.wasClean) {
				this.doneHandler?.();
			}
		};
	}

	/** Parse a mux WebSocket frame */
	private handleMuxFrame(raw: string): void {
		try {
			const frame = JSON.parse(raw);
			const payload = frame.payload ?? frame;

			// DSH mux frames contain session events
			// Common payload types: message/chunk, tool/call, tool/result, turn/end, etc.
			const eventType = payload.type ?? payload.event ?? payload.kind ?? "message";

			if (eventType === "turn/end" || eventType === "session/idle") {
				this.doneHandler?.();
				return;
			}

			// Map DSH event types to our StreamEvent types
			let type: StreamEventType = "message";
			let data = "";

			if (eventType === "message/chunk" || eventType === "assistant/chunk") {
				type = "message";
				data = payload.content ?? payload.text ?? payload.chunk ?? "";
			} else if (eventType === "tool/call" || eventType === "tool/invoke") {
				type = "tool_call";
				data = JSON.stringify({ name: payload.name ?? payload.tool, input: payload.input ?? payload.args });
			} else if (eventType === "tool/result" || eventType === "tool/return") {
				type = "tool_result";
				data = typeof payload.output === "string" ? payload.output : JSON.stringify(payload.output ?? payload.result);
			} else if (eventType === "error" || eventType === "turn/error") {
				type = "error";
				data = payload.message ?? payload.error ?? String(payload);
			} else if (eventType === "message/text") {
				type = "message";
				data = payload.text ?? "";
			}

			if (data || type !== "message") {
				this.eventHandler?.({ type, data });
			}
		} catch {
			// Non-JSON or unrecognized frame — ignore
		}
	}

	/** Disconnect the mux WebSocket */
	disconnectMux(): void {
		if (this.ws) {
			this.ws.close(1000, "Client disconnect");
			this.ws = null;
		}
		this.eventHandler = null;
		this.doneHandler = null;
		this.errorHandler = null;
	}

	/** Check if mux is connected */
	isMuxConnected(): boolean {
		return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
	}

	/** Abort current streaming (alias for disconnectMux) */
	abort(): void {
		this.disconnectMux();
	}

	/** Build a ChatMessage object */
	static buildMessage(role: ChatMessage["role"], content: string): ChatMessage {
		return { role, content, timestamp: Date.now() };
	}
}
