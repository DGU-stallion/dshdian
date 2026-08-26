import { Events, request } from "obsidian";
import { spawn } from "child_process";
import type { ChildProcess } from "child_process";

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
	private process: ChildProcess | null = null;

	constructor(port: number) {
		super();
		this.port = port;
	}

	setPort(port: number): void {
		this.port = port;
	}

	/** Attempt to detect or start the harness process */
	async start(harnessPath?: string): Promise<void> {
		const alive = await this.healthCheck();
		if (alive) {
			this.running = true;
			this.backoffMs = 1000;
			this.trigger("started");
			this.scheduleHealthCheck();
			return;
		}

		// Try to start the process
		const cmd = harnessPath || "dsh";
		try {
			this.process = spawn(cmd, ["web", "--port", String(this.port)], {
				detached: true,
				stdio: "ignore",
			});
			this.process.unref();
			this.process.on("error", (err) => {
				console.warn("dshdian: failed to start harness process", err);
				this.trigger("error", "Failed to start DSH Harness: " + err.message);
			});
			// Wait a bit then health check
			setTimeout(async () => {
				const ok = await this.healthCheck();
				if (ok) {
					this.running = true;
					this.backoffMs = 1000;
					this.trigger("started");
					this.scheduleHealthCheck();
				} else {
					this.scheduleReconnect();
				}
			}, 2000);
		} catch (e) {
			this.trigger("error", "Cannot spawn DSH process: " + String(e));
			this.scheduleReconnect();
		}
	}

	/** Stop monitoring and kill spawned process if any */
	stop(): void {
		this.running = false;
		if (this.healthTimer !== null) {
			clearTimeout(this.healthTimer);
			this.healthTimer = null;
		}
		if (this.process) {
			try {
				this.process.kill();
			} catch {
				// Process may have already exited
			}
			this.process = null;
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
