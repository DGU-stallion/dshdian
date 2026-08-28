import { requestUrl } from "obsidian";
import WebSocket from "ws";
import type { ChatMessage } from "../types";

// ─── DSH Protocol Types ────────────────────────────────────────────────
// Aligned with @deepseek-ai/dsh-host-apiproxy/api — we inline the subset
// needed rather than importing the full package (it has cordis/Node deps).

/** The JSON envelope DSH sends over WebSocket downlinks. */
interface ServerRequest {
	type: "server-request";
	rpcId: string;
	method: string;
	payload: MuxFrame | HostFrame;
}

// ─── MuxFrame types ────────────────────────────────────────────────────

type MuxFrame =
	| SessionEventFrame
	| SessionSubscribedFrame
	| ApprovalRequestedFrame
	| ApprovalResolvedFrame
	| QuestionRequestedFrame
	| QuestionResolvedFrame
	| SessionQueueFrame
	| SessionJobsFrame
	| SessionProjectionFrame
	| StreamErrorFrame;

interface SessionEventFrame {
	type: "session/event";
	sessionId: string;
	event: SessionEvent;
	view?: ToolEventView;
}

interface SessionSubscribedFrame {
	type: "session/subscribed";
	sessionId: string;
	lastSeq: number;
}

interface ApprovalRequestedFrame {
	type: "approval/requested";
	sessionId: string;
	approvalId: string;
	toolName: string;
	callId?: string;
	reason?: string;
}

interface ApprovalResolvedFrame {
	type: "approval/resolved";
	sessionId: string;
	approvalId: string;
	outcome: "allowed-once" | "rejected" | "cancelled" | "unavailable";
}

interface QuestionRequestedFrame {
	type: "question/requested";
	sessionId: string;
	questions: Array<{
		id: string;
		question: string;
		header?: string;
		detail?: string;
		options?: Array<{ label: string; description?: string }>;
		multiSelect?: boolean;
	}>;
}

interface QuestionResolvedFrame {
	type: "question/resolved";
	sessionId: string;
	questionRpcId: string;
	outcome: "answered" | "cancelled";
}

interface SessionQueueFrame {
	type: "session/queue";
	sessionId: string;
	items: unknown[];
}

interface SessionJobsFrame {
	type: "session/jobs";
	sessionId: string;
	jobs: unknown[];
}

interface SessionProjectionFrame {
	type: "session/projection";
	sessionId: string;
	key: string;
	value: unknown;
	seq: number;
}

interface StreamErrorFrame {
	type: "stream/error";
	error: { code: string; message: string; details: Record<string, unknown> };
}

// ─── SessionEvent types ────────────────────────────────────────────────

interface SessionEvent {
	type: string;
	[key: string]: unknown;
}

/** StreamChunk within an assistant/chunk event */
export interface StreamChunk {
	type: "text-delta" | "reasoning-delta" | "tool-call-delta" | "block-start" | "block-end" | "usage" | "finish";
	index?: number;
	text?: string;
	id?: string;
	name?: string;
	argumentsDelta?: string;
	block?: ContentBlock;
	usage?: unknown;
	reason?: string;
	blockType?: string;
}

interface ContentBlock {
	type: string;
	[key: string]: unknown;
}

interface ToolEventView {
	for: "call" | "result";
	view: unknown;
}

// ─── HostFrame types ───────────────────────────────────────────────────

type HostFrame =
	| { type: "host/session-added"; sessionId: string; blank: boolean; cwd?: string }
	| { type: "host/session-removed"; sessionId: string }
	| { type: "host/session-status"; sessionId: string; running: boolean }
	| { type: "host/agent-error"; sessionId: string; message: string }
	| { type: "host/workspace-changed"; workspace: unknown }
	| { type: "host/workspace-removed"; workspaceId: string }
	| { type: "host/workspace-order-changed"; workspaceIds: string[] }
	| { type: "host/archived-sessions-changed"; archivedSessionIds: string[] }
	| { type: "host/remote-event"; event: string; args: unknown[] }
	| StreamErrorFrame;

// ─── Connection state ──────────────────────────────────────────────────

export type ConnectionState = "disconnected" | "connecting" | "connected" | "reconnecting";

/** Session list item returned by session.list */
export interface SessionListItem {
	sessionId: string;
	updatedAt: number;
	running: boolean;
	blank: boolean;
	cwd?: string;
	projections?: {
		values?: {
			title?: string;
			[key: string]: unknown;
		};
	};
}

/** Callbacks for frame dispatch — business layer subscribes to these. */
export interface ConnectionSinks {
	onMuxFrame?: (frame: MuxFrame) => void;
	onHostFrame?: (frame: HostFrame) => void;
	onConnected?: () => void;
	onStateChange?: (state: ConnectionState) => void;
}

// ─── Connection config (mirrors DSH ConnectionController) ──────────────

interface ConnectionConfig {
	backoffBaseMs: number;
	backoffFactor: number;
	backoffMaxMs: number;
}

const CONNECTION_DEFAULTS: ConnectionConfig = {
	backoffBaseMs: 500,
	backoffFactor: 2,
	backoffMaxMs: 10_000,
};

// ─── HarnessClient ─────────────────────────────────────────────────────

/**
 * DSH Harness API client for Obsidian.
 *
 * Architecture aligned with DSH's own client:
 * - Unary RPC via HTTP POST to /api/<method>
 * - Two downlink-only WebSocket streams (events.mux + events.host)
 * - Reconnect with exponential backoff (from DSH ConnectionController)
 * - Node.js `ws` module bypasses Electron Origin trust fence
 */
export class HarnessClient {
	private port: number;
	private muxSocket: WebSocket | null = null;
	private hostSocket: WebSocket | null = null;
	private sinks: ConnectionSinks = {};
	private running = false;
	private generation = 0;
	private attempt = 0;
	private config: ConnectionConfig = { ...CONNECTION_DEFAULTS };
	private state: ConnectionState = "disconnected";
	private abortController: AbortController | null = null;

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

	private rpcId(): string {
		return crypto.randomUUID();
	}

	// ─── RPC Layer ───────────────────────────────────────────────────────

	/**
	 * Call a DSH RPC method via POST /api/{method}.
	 * Protocol: { type: "client-request", rpcId, method, payload }
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

	/** Respond to an answerable frame (approval, question) */
	async respond(rpcId: string, payload: Record<string, unknown>): Promise<void> {
		const body = {
			type: "client-response",
			rpcId,
			result: { ok: true, value: payload },
		};

		await requestUrl({
			url: `${this.baseUrl}/api/respond`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	// ─── Session API ─────────────────────────────────────────────────────

	async createSession(cwd?: string, agentPreset?: string, permission?: string): Promise<string> {
		const payload: Record<string, unknown> = {};
		if (cwd) payload.cwd = cwd;
		if (agentPreset) payload.agentPreset = agentPreset;
		if (permission) payload.permission = permission;

		const result = await this.rpc<{ sessionId: string }>(
			"session.create",
			payload
		);
		return result.sessionId;
	}

	async sendMessage(sessionId: string, content: string, instructions?: string): Promise<void> {
		const payload: Record<string, unknown> = {
			sessionId,
			mode: "queue",
			content: [{ type: "text", text: content }],
		};
		if (instructions) {
			payload.instructions = instructions;
		}
		await this.rpc<{ accepted: true }>("session.prompt", payload);
	}

	async getHistory(sessionId: string): Promise<unknown[]> {
		const result = await this.rpc<{ events: unknown[]; hasMore: boolean }>(
			"session.history",
			{ sessionId }
		);
		return result.events;
	}

	async listSessions(): Promise<Array<SessionListItem>> {
		const result = await this.rpc<{ items: Array<SessionListItem> }>(
			"session.list",
			{}
		);
		return result.items;
	}

	async cancelSession(sessionId: string): Promise<void> {
		await this.rpc<{ accepted: true }>("session.cancel", { sessionId });
	}

	// ─── Connection Layer (dual WebSocket streams + reconnect) ───────────

	/**
	 * Start the dual-stream connection loop.
	 * Mirrors DSH's ConnectionController: open both streams, pump frames,
	 * reconnect with exponential backoff on loss.
	 */
	start(sinks: ConnectionSinks): void {
		if (this.running) return;
		this.sinks = sinks;
		this.running = true;
		this.attempt = 0;
		void this.connectionLoop();
	}

	/** Stop the connection loop and close all sockets. */
	stop(): void {
		this.running = false;
		this.abortController?.abort();
		this.abortController = null;
		this.closeSocket(this.muxSocket);
		this.closeSocket(this.hostSocket);
		this.muxSocket = null;
		this.hostSocket = null;
		this.emitState("disconnected");
	}

	/** Whether the dual streams are connected. */
	isConnected(): boolean {
		return this.state === "connected";
	}

	getConnectionState(): ConnectionState {
		return this.state;
	}

	/**
	 * Main connection loop — mirrors DSH ConnectionController.loop().
	 * Each iteration = one "generation": open both sockets, pump until
	 * either closes, then backoff and retry.
	 */
	private async connectionLoop(): Promise<void> {
		while (this.running) {
			++this.generation;
			this.abortController = new AbortController();
			const { signal } = this.abortController;

			this.emitState("connecting");

			try {
				// Open both sockets in parallel
				const [muxOk, hostOk] = await Promise.all([
					this.openStream("mux", signal),
					this.openStream("host", signal),
				]);

				if (!muxOk || !hostOk || signal.aborted) {
					throw new Error("stream open failed");
				}

				// Verify reachability with host.describe
				await this.rpc<unknown>("host.describe", {});

				if (signal.aborted) throw new Error("aborted during handshake");

				// Connected!
				this.attempt = 0;
				this.emitState("connected");
				this.callSink(() => this.sinks.onConnected?.());

				// Wait until either stream closes
				await this.waitForStreamEnd(signal);
			} catch (e) {
				// Generation failed — close any open sockets
				this.closeSocket(this.muxSocket);
				this.closeSocket(this.hostSocket);
				this.muxSocket = null;
				this.hostSocket = null;
			}

			if (!this.running) return;

			this.emitState("reconnecting");
			this.attempt++;
			console.warn(`[Dshdian] connection lost, retry #${this.attempt}`);
			await this.backoffSleep(this.attempt);
		}
	}

	/**
	 * Open one WebSocket downlink stream.
	 * Uses Node.js `ws` module — no Origin header, bypasses DSH trust fence.
	 */
	private openStream(
		kind: "mux" | "host",
		signal: AbortSignal
	): Promise<boolean> {
		return new Promise<boolean>((resolve) => {
			if (signal.aborted) {
				resolve(false);
				return;
			}

			const path = kind === "mux" ? "/api/events.mux" : "/api/events.host";
			const socket = new WebSocket(`${this.wsUrl}${path}`);

			const onAbort = (): void => {
				socket.close();
				resolve(false);
			};
			signal.addEventListener("abort", onAbort, { once: true });

			socket.on("open", () => {
				signal.removeEventListener("abort", onAbort);
				if (kind === "mux") {
					this.muxSocket = socket;
				} else {
					this.hostSocket = socket;
				}
				this.attachMessageHandler(socket, kind);
				resolve(true);
			});

			socket.on("error", (err: Error) => {
				signal.removeEventListener("abort", onAbort);
				console.error(`[Dshdian] ${kind} WebSocket error:`, err.message);
				resolve(false);
			});
		});
	}

	/**
	 * Attach the message handler that parses ServerRequest envelopes
	 * and dispatches the typed payload to the appropriate sink.
	 */
	private attachMessageHandler(socket: WebSocket, kind: "mux" | "host"): void {
		socket.on("message", (data: WebSocket.Data) => {
			const raw = typeof data === "string" ? data : data.toString("utf-8");
			try {
				const envelope = JSON.parse(raw) as ServerRequest;
				if (envelope.type !== "server-request") return;

				const payload = envelope.payload;

				if (kind === "mux") {
					const muxPayload = payload as MuxFrame;
					// Attach rpcId for frames that need responses (approval, question)
					if ('sessionId' in muxPayload) {
						(muxPayload as any).__rpcId = envelope.rpcId;
					}
					this.callSink(() => this.sinks.onMuxFrame?.(muxPayload));
				} else {
					this.callSink(() => this.sinks.onHostFrame?.(payload as HostFrame));
				}
			} catch (err) {
				console.error(`[Dshdian] dropping malformed ${kind} frame:`, err);
			}
		});
	}

	/**
	 * Wait until either mux or host socket closes, then abort the generation.
	 * Mirrors DSH's "either stream loss fails the whole generation" semantics.
	 */
	private waitForStreamEnd(signal: AbortSignal): Promise<void> {
		return new Promise<void>((resolve) => {
			const done = (): void => {
				this.muxSocket?.removeAllListeners("close");
				this.hostSocket?.removeAllListeners("close");
				signal.removeEventListener("abort", done);
				resolve();
			};

			this.muxSocket?.on("close", done);
			this.hostSocket?.on("close", done);
			signal.addEventListener("abort", done, { once: true });
		});
	}

	// ─── Helpers ─────────────────────────────────────────────────────────

	private closeSocket(socket: WebSocket | null): void {
		if (!socket) return;
		socket.removeAllListeners();
		if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
			socket.close();
		}
	}

	private emitState(state: ConnectionState): void {
		if (this.state === state) return;
		this.state = state;
		this.callSink(() => this.sinks.onStateChange?.(state));
	}

	/** Exponential backoff with jitter — directly from DSH ConnectionController. */
	private backoffSleep(attempt: number): Promise<void> {
		const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config;
		const cap = Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1));
		const delay = cap / 2 + Math.random() * (cap / 2);
		return new Promise((resolve) => setTimeout(resolve, delay));
	}

	/** Sink exception isolation — same pattern as DSH. */
	private callSink(fn: () => void): void {
		try {
			fn();
		} catch (error) {
			console.error("[Dshdian] connection sink threw:", error);
		}
	}

	// ─── Static helpers ──────────────────────────────────────────────────

	static buildMessage(role: ChatMessage["role"], content: string): ChatMessage {
		return { role, content, timestamp: Date.now() };
	}
}

// ─── Re-exports for frame type consumers ───────────────────────────────

export type { MuxFrame, HostFrame, SessionEventFrame, StreamErrorFrame };
export type { ApprovalRequestedFrame, QuestionRequestedFrame };
export type { SessionEvent, StreamChunk as StreamChunkType };
