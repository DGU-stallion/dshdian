import { Events, request } from "obsidian";
import { spawn, execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import type { ChildProcess } from "child_process";

/** DSH profile name dedicated to Dshdian */
const PROFILE_NAME = "Dshdian";

/**
 * Manages the DSH Harness process lifecycle.
 * Uses a dedicated 'Dshdian' profile (port 3180) to avoid conflicts
 * with the user's default web profile (port 3080).
 */
export class DshProcessManager extends Events {
	private port: number;
	private running = false;
	private healthTimer: ReturnType<typeof setTimeout> | null = null;
	private backoffMs = 1000;
	private maxBackoffMs = 30000;
	private process: ChildProcess | null = null;
	private dshHome: string;

	constructor(port: number) {
		super();
		this.port = port;
		this.dshHome = process.env.DSH_HOME || join(process.env.HOME || "", ".dsh");
	}

	setPort(port: number): void {
		this.port = port;
	}

	/** Find the dsh binary */
	private findDsh(): string | null {
		// Check npx cache (most common install method)
		try {
			const result = execSync(
				"find ~/.npm/_npx -name 'dsh' -path '*/node_modules/.bin/dsh' 2>/dev/null | head -1",
				{ encoding: "utf-8", timeout: 5000 }
			).trim();
			if (result && existsSync(result)) return result;
		} catch { /* ignore */ }

		// Check PATH
		try {
			const result = execSync("which dsh 2>/dev/null", {
				encoding: "utf-8",
				timeout: 3000,
			}).trim();
			if (result) return result;
		} catch { /* ignore */ }

		return null;
	}

	/**
	 * Ensure the Dshdian profile exists with the correct bundle list.
	 * DSH resolves bundles from its own installAnchor first, so we only need
	 * the profile directory structure + package.json with the right bundles.
	 * No `dsh plugin` call or pnpm install needed.
	 */
	private ensureProfile(): void {
		const profileDir = join(this.dshHome, "profiles", PROFILE_NAME);
		const pkgPath = join(profileDir, "package.json");

		// Required bundles (mirrors DSH's built-in "web" profile template)
		const requiredBundles = ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"];

		if (!existsSync(pkgPath)) {
			// Create profile directory structure from scratch
			const { mkdirSync } = require("fs") as typeof import("fs");
			mkdirSync(profileDir, { recursive: true });

			const pkg = {
				name: `dsh-profile-${PROFILE_NAME}`,
				private: true,
				dependencies: {},
				dsh: { profile: { bundles: requiredBundles } },
			};
			writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");

			// cordis.yml — empty root (bundles compose via patch layers)
			const cordisRoot = join(profileDir, "cordis.yml");
			if (!existsSync(cordisRoot)) {
				writeFileSync(cordisRoot, [
					"# dsh profile root — an empty entry list. The tree is composed as patches:",
					"# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any",
					"# --patch overlays. Edit cordis.patch.yml, not this file.",
					"[]",
					"",
				].join("\n"), "utf-8");
			}

			// cordis.patch.yml — user override layer (empty)
			const patchPath = join(profileDir, "cordis.patch.yml");
			if (!existsSync(patchPath)) {
				writeFileSync(patchPath, [
					"# Your patch layer for this dsh profile, applied after every bundle layer:",
					"# a top-level YAML array of loader patch entries (id-targeted config",
					"# overrides, disables, and insert lists; `!!js` expressions allowed).",
					"[]",
					"",
				].join("\n"), "utf-8");
			}

			// pnpm-workspace.yaml (required by pnpm if user later adds plugins)
			const workspacePath = join(profileDir, "pnpm-workspace.yaml");
			if (!existsSync(workspacePath)) {
				writeFileSync(workspacePath, "packages: []\n", "utf-8");
			}
		} else {
			// Profile exists — ensure bundles list is correct
			try {
				const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
				const bundles: string[] = pkg?.dsh?.profile?.bundles ?? [];
				const missing = requiredBundles.filter(b => !bundles.includes(b));
				if (missing.length > 0) {
					if (!pkg.dsh) pkg.dsh = {};
					if (!pkg.dsh.profile) pkg.dsh.profile = {};
					pkg.dsh.profile.bundles = requiredBundles;
					writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf-8");
				}
			} catch (e) {
				console.warn("Dshdian: failed to update profile package.json", e);
			}
		}
	}

	/** Attempt to detect or start the harness process */
	async start(harnessPath?: string): Promise<void> {
		// First check if already running
		const alive = await this.healthCheck();
		if (alive) {
			this.running = true;
			this.backoffMs = 1000;
			this.trigger("started");
			this.scheduleHealthCheck();
			return;
		}

		// Find dsh binary
		const dshBin = harnessPath || this.findDsh();
		if (!dshBin) {
			this.trigger("error", "DSH binary not found. Install with: npx @deepseek-ai/dsh web");
			this.scheduleReconnect();
			return;
		}

		// Ensure profile exists
		this.ensureProfile();

		// Start DSH with Dshdian profile
		try {
			this.process = spawn(
				dshBin,
				["--profile", PROFILE_NAME, "--port", String(this.port), "--no-open"],
				{
					detached: true,
					stdio: "ignore",
					env: { ...process.env, DSH_HOME: this.dshHome },
				}
			);
			this.process.unref();

			this.process.on("error", (err) => {
				console.warn("Dshdian: spawn failed:", err.message);
				this.process = null;
				this.trigger("error", "Failed to start DSH: " + err.message);
				this.scheduleReconnect();
			});

			// Poll for readiness
			this.waitForReady();
		} catch (e) {
			this.process = null;
			this.trigger("error", "Cannot spawn DSH: " + String(e));
			this.scheduleReconnect();
		}
	}

	/** Poll health check until ready or timeout */
	private waitForReady(): void {
		let attempts = 0;
		const maxAttempts = 15; // up to ~30 seconds

		const poll = (): void => {
			const delay = attempts === 0 ? 3000 : 2000;
			setTimeout(async () => {
				attempts++;
				const ok = await this.healthCheck();
				if (ok) {
					this.running = true;
					this.backoffMs = 1000;
					this.trigger("started");
					this.scheduleHealthCheck();
				} else if (attempts < maxAttempts) {
					poll();
				} else {
					this.trigger("error", "DSH started but not responding on port " + this.port);
					this.scheduleReconnect();
				}
			}, delay);
		};
		poll();
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
				if (this.process.pid) {
					process.kill(-this.process.pid, "SIGTERM");
				}
			} catch {
				try { this.process.kill(); } catch { /* already exited */ }
			}
			this.process = null;
		}
		this.trigger("stopped");
	}

	/** Check if DSH is responding (GET / returns 200) */
	async healthCheck(): Promise<boolean> {
		try {
			const resp = await request({
				url: `http://localhost:${this.port}/`,
				method: "GET",
			});
			if (resp) {
				this.trigger("health-ok");
				return true;
			}
			this.trigger("health-fail");
			return false;
		} catch {
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
