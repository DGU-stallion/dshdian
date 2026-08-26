import { Events, request } from "obsidian";

/**
 * Manages the DSH Harness process lifecycle.
 * Detects whether it's already running; provides health checks
 * with exponential backoff reconnection.
 */
export class DshProcessManager extends Events {
	private port: number;
	private running = false;
	private healthTimer: ReturnType<typeof setTimeout> | null = null;
	private backoffMs = 1000;
	private maxBackoffMs = 30000;

	constructor(port: number) {
		super();
		this.port = port;
	}

	setPort(port: number): void {
		this.port = port;
	}

	/** Attempt to detect or start the harness process */
	async start(): Promise<void> {
		const alive = await this.healthCheck();
		if (alive) {
			this.running = true;
			this.backoffMs = 1000;
			this.trigger("started");
			this.scheduleHealthCheck();
		} else {
			this.trigger("error", "DSH Harness not reachable on port " + this.port);
			this.scheduleReconnect();
		}
	}

	/** Stop monitoring (does not kill external process) */
	stop(): void {
		this.running = false;
		if (this.healthTimer !== null) {
			clearTimeout(this.healthTimer);
			this.healthTimer = null;
		}
		this.trigger("stopped");
	}

	/** GET /health on the harness */
	async healthCheck(): Promise<boolean> {
		try {
			const resp = await request({
				url: `http://localhost:${this.port}/health`,
				method: "GET",
			});
			if (resp) {
				this.trigger("health-ok");
				return true;
			}
			this.trigger("health-fail");
			return false;
		} catch (e) {
			console.warn("dshdian: health check failed", e);
			this.trigger("health-fail");
			return false;
		}
	}

	isRunning(): boolean {
		return this.running;
	}

	private scheduleHealthCheck(): void {
		this.healthTimer = setTimeout(async () => {
			const alive = await this.healthCheck();
			if (alive) {
				this.backoffMs = 1000;
				if (this.running) {
					this.scheduleHealthCheck();
				}
			} else {
				this.running = false;
				this.trigger("error", "Health check failed");
				this.scheduleReconnect();
			}
		}, 10000);
	}

	private scheduleReconnect(): void {
		this.healthTimer = setTimeout(async () => {
			const alive = await this.healthCheck();
			if (alive) {
				this.running = true;
				this.backoffMs = 1000;
				this.trigger("started");
				this.scheduleHealthCheck();
			} else {
				this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
				this.scheduleReconnect();
			}
		}, this.backoffMs);
	}
}
