import { requestUrl } from "obsidian";
import type { ChatMessage, SseEvent, SseEventType } from "../types";

/**
 * HTTP + SSE client for communicating with the DSH Harness.
 * POST to send messages, SSE to stream responses.
 */
export class HarnessClient {
	private port: number;
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

	/** Create a new session, returns session ID */
	async createSession(systemPrompt?: string): Promise<string> {
		const body: Record<string, string> = {};
		if (systemPrompt) {
			body.system_prompt = systemPrompt;
		}
		const resp = await requestUrl({
			url: `${this.baseUrl}/api/open`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
		const data = resp.json;
		return data.session_id ?? data.sessionId ?? "";
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
		await requestUrl({
			url: `${this.baseUrl}/api/respond`,
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
		});
	}

	/**
	 * Connect to SSE stream for a session.
	 * Calls onEvent for each parsed event; calls onDone when stream ends.
	 */
	streamResponse(
		sessionId: string,
		onEvent: (event: SseEvent) => void,
		onDone: () => void,
		onError: (err: string) => void
	): void {
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
					onError(`SSE connection failed: ${response.status}`);
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

					let currentType: SseEventType = "message";
					for (const line of lines) {
						if (line.startsWith("event:")) {
							currentType = line.slice(6).trim() as SseEventType;
						} else if (line.startsWith("data:")) {
							const data = line.slice(5).trim();
							onEvent({ type: currentType, data });
							currentType = "message";
						}
					}
				}
				this.abortController = null;
				onDone();
			} catch (err: unknown) {
				this.abortController = null;
				if (err instanceof Error && err.name === "AbortError") {
					onDone();
				} else {
					onError(String(err));
				}
			}
		};

		fetchSse();
	}

	/** Abort the current SSE stream */
	abort(): void {
		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}
	}

	/** Build a ChatMessage object */
	static buildMessage(role: ChatMessage["role"], content: string): ChatMessage {
		return { role, content, timestamp: Date.now() };
	}
}
