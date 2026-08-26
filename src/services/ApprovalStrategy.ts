import { App } from "obsidian";
import { ApprovalLevel, ActionRisk } from "../types";
import { getVaultPath } from "../utils";
import * as fs from "fs";
import * as path from "path";
import { exec } from "child_process";

/**
 * Git-aware approval strategy.
 * Determines whether actions require user confirmation based on
 * the vault's git state and the action's risk level.
 */
export class ApprovalStrategy {
	private app: App;
	private vaultPath: string;

	constructor(app: App) {
		this.app = app;
		this.vaultPath = getVaultPath(app);
	}

	/** Determine current approval level based on git state */
	async getApprovalLevel(): Promise<ApprovalLevel> {
		const hasGit = await this.isGitRepo();
		if (!hasGit) {
			return ApprovalLevel.ConfirmAll;
		}
		const dirty = await this.isDirty();
		return dirty ? ApprovalLevel.ConfirmRisky : ApprovalLevel.Auto;
	}

	/** Check if vault root has a .git directory */
	async isGitRepo(): Promise<boolean> {
		const gitDir = path.join(this.vaultPath, ".git");
		return new Promise((resolve) => {
			fs.access(gitDir, fs.constants.F_OK, (err) => {
				resolve(!err);
			});
		});
	}

	/** Check if worktree has uncommitted changes */
	async isDirty(): Promise<boolean> {
		return new Promise((resolve) => {
			exec(
				"git status --porcelain",
				{ cwd: this.vaultPath },
				(err, stdout) => {
					if (err) {
						// If git command fails, treat as dirty
						resolve(true);
						return;
					}
					resolve(stdout.trim().length > 0);
				}
			);
		});
	}

	/**
	 * Decide if an action requires user approval.
	 * Returns true if confirmation is needed.
	 */
	async shouldRequireApproval(action: ActionRisk): Promise<boolean> {
		const level = await this.getApprovalLevel();

		switch (level) {
			case ApprovalLevel.Auto:
				// Clean git repo: only high-risk actions need approval
				return action === ActionRisk.High;
			case ApprovalLevel.ConfirmRisky:
				// Dirty worktree: medium and high need approval
				return action === ActionRisk.Medium || action === ActionRisk.High;
			case ApprovalLevel.ConfirmAll:
				// No git: everything except reads needs approval
				return action !== ActionRisk.Low;
		}
	}

	/** Classify an action string into a risk level */
	static classifyRisk(action: string): ActionRisk {
		const lower = action.toLowerCase();
		if (lower.includes("delete") || lower.includes("remove") || lower.includes("plugin")) {
			return ActionRisk.High;
		}
		if (lower.includes("write") || lower.includes("modify") || lower.includes("create") || lower.includes("move")) {
			return ActionRisk.Medium;
		}
		return ActionRisk.Low;
	}
}
