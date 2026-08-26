import { requestUrl } from "obsidian";
import type { ChatMessage, StreamEvent, StreamEventType } from "../types";

/** Default request timeout in milliseconds */
const REQUEST_TIMEOUT_MS = 30000;

/**
 * HTTP + WebSocket client for communicating with the DSH Harness.
 * POST to send messages, WebSocket /api/events.mux to stream responses.
 * Falls back to SSE /api/events if WebSocket is unavailable.
 */
export class HarnessClient {
	private port: number;
	private ws: WebSocket | null = null;
	private abortController: AbortController | null = null;
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

	/** Create a new session, returns session ID */
	async createSession(systemPrompt?: string): Promise<string> {
		const body: Record<string, string> = {};
		if (systemPrompt) {
			body.system_prompt = systemPrompt;
		}
		const resp = await this.postWithTimeout(
			`${this.baseUrl}/api/open`,
			body
		);
		return resp.session_id ?? resp.sessionId ?? "";
	}

	/** Send a message to an existing session */
	async sendMessage(
		sessionId: string,
		content: string,
		context?: string
	): Promise<void> {
		const body: Record<string, string> = {
			session_id: sessionId,
			content,
		};
		if (context) {
			body.context = context;
		}
		await this.postWithTimeout(`${this.baseUrl}/api/respond`, body);
	}

	/**
	 * Connect to the streaming endpoint for a session.
	 * Tries WebSocket /api/events.mux first; falls back to SSE /api/events.
	 */
	streamResponse(
		sessionId: string,
		onEvent: (event: StreamEvent) => void,
		onDone: () => void,
		onError: (err: string) => void
	): void {
		this.eventHandler = onEvent;
		this.doneHandler = onDone;
		this.errorHandler = onError;

		// Try WebSocket first
		this.connectWebSocket(sessionId);
	}

	/** Connect via WebSocket to /api/events.mux */
	private connectWebSocket(sessionId: string): void {
		const url = `${this.wsUrl}/api/events.mux?session_id=${encodeURIComponent(sessionId)}`;

		try {
			this.ws = new WebSocket(url);
		} catch {
			// WebSocket constructor may throw if URL is invalid
			this.fallbackToSse(sessionId);
			return;
		}

		this.ws.onopen = () => {
			// Connection established
		};

		this.ws.onmessage = (event: MessageEvent) => {
			this.handleStreamData(String(event.data));
		};

		this.ws.onerror = () => {
			// WebSocket failed, fallback to SSE
			this.ws = null;
			this.fallbackToSse(sessionId);
		};

		this.ws.onclose = (event: CloseEvent) => {
			this.ws = null;
			// Normal close (code 1000) means stream completed
			if (event.code === 1000 || event.wasClean) {
				this.doneHandler?.();
			}
			// Abnormal close without prior error — already handled in onerror
		};
	}

	/** Fallback: connect via SSE to /api/events */
	private fallbackToSse(sessionId: string): void {
		this.abortController = new AbortController();
		const url = `${this.baseUrl}/api/events?session_id=${encodeURIComponent(sessionId)}`;

		const fetchSse = async () => {
			try {
				const response = await fetch(url, {
					signal: this.abortController!.signal,
					headers: { Accept: "text/event-stream" },
				});
				if (!response.ok || !response.body) {
					this.abortController = null;
					this.errorHandler?.(`Stream connection failed: ${response.status}`);
					return;
				}
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = "";

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";

					let currentType: StreamEventType = "message";
					for (const line of lines) {
						if (line.startsWith("event:")) {
							currentType = line.slice(6).trim() as StreamEventType;
						} else if (line.startsWith("data:")) {
							const data = line.slice(5).trim();
							this.eventHandler?.({ type: currentType, data });
							currentType = "message";
						}
					}
				}
				this.abortController = null;
				this.doneHandler?.();
			} catch (err: unknown) {
				this.abortController = null;
				if (err instanceof Error && err.name === "AbortError") {
					this.doneHandler?.();
				} else {
					this.errorHandler?.(String(err));
				}
			}
		};

		fetchSse();
	}

	/** Parse a raw WebSocket message into a StreamEvent and dispatch */
	private handleStreamData(raw: string): void {
		try {
			const parsed = JSON.parse(raw);
			const type: StreamEventType = parsed.type ?? parsed.event ?? "message";
			const data = parsed.data ?? parsed.content ?? parsed.text ?? "";
			this.eventHandler?.({ type, data: typeof data === "string" ? data : JSON.stringify(data) });

			if (type === "done") {
				this.doneHandler?.();
			}
		} catch {
			// Non-JSON: treat entire message as a text token
			this.eventHandler?.({ type: "message", data: raw });
		}
	}

	/** Abort the current stream (both WebSocket and SSE) */
	abort(): void {
		if (this.ws) {
			this.ws.close(1000, "Client abort");
			this.ws = null;
		}
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
		this.eventHandler = null;
		this.doneHandler = null;
		this.errorHandler = null;
	}

	/** Check if currently streaming */
	isStreaming(): boolean {
		return this.ws !== null || this.abortController !== null;
	}

	/** POST with timeout — wraps requestUrl */
	private async postWithTimeout(
		url: string,
		body: Record<string, string>
	): Promise<Record<string, any>> {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

		try {
			const resp = await requestUrl({
				url,
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(body),
			});
			clearTimeout(timer);
			return resp.json;
		} catch (e) {
			clearTimeout(timer);
			if (e instanceof Error && e.name === "AbortError") {
				throw new Error(`Request timeout after ${REQUEST_TIMEOUT_MS}ms: ${url}`);
			}
			throw e;
		}
	}

	/** Build a ChatMessage object */
	static buildMessage(role: ChatMessage["role"], content: string): ChatMessage {
		return { role, content, timestamp: Date.now() };
	}
}
