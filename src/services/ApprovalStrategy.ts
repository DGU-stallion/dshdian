import { App } from "obsidian";
import { ApprovalLevel } from "../types";
import type { ApprovalDecision } from "../types";
import { getVaultPath } from "../utils";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

/** Actions that ALWAYS require confirmation regardless of git state */
const ALWAYS_CONFIRM_ACTIONS = ["delete", "remove", "plugin_install", "plugin_uninstall", "system"];

/** Actions considered read-only (always silent) */
const READ_ACTIONS = ["read", "search", "list", "tags", "backlinks", "stat"];

/**
 * Git-aware approval strategy.
 * Three levels: Silent (read ops), Notify (git + write), Confirm (no git + write, or dangerous ops).
 */
export class ApprovalStrategy {
	private app: App;
	private vaultPath: string;
	private hasGit: boolean | null = null;

	constructor(app: App) {
		this.app = app;
		this.vaultPath = getVaultPath(app);
	}

	/** Check if vault root has a .git directory */
	async isGitRepo(): Promise<boolean> {
		if (this.hasGit !== null) return this.hasGit;
		const gitDir = path.join(this.vaultPath, ".git");
		return new Promise((resolve) => {
			fs.access(gitDir, fs.constants.F_OK, (err) => {
				this.hasGit = !err;
				resolve(this.hasGit);
			});
		});
	}

	/** Determine approval decision for a given action */
	async getDecision(action: string): Promise<ApprovalDecision> {
		const lower = action.toLowerCase();

		// Read ops are always silent
		if (READ_ACTIONS.some((r) => lower.includes(r))) {
			return { level: ApprovalLevel.Silent, action, description: action };
		}

		// Permanent delete and system ops ALWAYS confirm
		if (ALWAYS_CONFIRM_ACTIONS.some((a) => lower.includes(a))) {
			return {
				level: ApprovalLevel.Confirm,
				action,
				description: `Dangerous operation: ${action}`,
			};
		}

		// Write operations: check git state
		const hasGit = await this.isGitRepo();
		if (hasGit) {
			// Has git — notify only
			return {
				level: ApprovalLevel.Notify,
				action,
				description: `Executed: ${action}`,
			};
		}

		// No git — all writes require confirmation
		return {
			level: ApprovalLevel.Confirm,
			action,
			description: `No git backup. Confirm: ${action}`,
		};
	}

	/** Reset cached git state (call if vault changes) */
	resetCache(): void {
		this.hasGit = null;
	}
}
