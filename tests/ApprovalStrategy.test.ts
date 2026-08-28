import { describe, it, expect, beforeEach, vi } from "vitest";
import { ApprovalStrategy } from "../src/services/ApprovalStrategy";
import { ApprovalLevel } from "../src/types";
import { App } from "./mocks/obsidian";

// Mock fs module
vi.mock("fs", () => ({
	access: vi.fn((path: string, _mode: number, cb: (err: any) => void) => {
		// Simulate .git exists by default
		if (path.endsWith(".git")) {
			cb(null); // .git exists
		} else {
			cb(new Error("ENOENT"));
		}
	}),
	accessSync: vi.fn((path: string) => {
		// Simulate some files exist
		if (path.includes("existing-note.md")) {
			return; // File exists
		}
		throw new Error("ENOENT");
	}),
	constants: { F_OK: 0 },
}));

describe("ApprovalStrategy", () => {
	let app: App;
	let strategy: ApprovalStrategy;

	beforeEach(() => {
		app = new App();
		strategy = new ApprovalStrategy(app as any, {
			alwaysConfirm: false,
			dangerKeywords: "delete,remove,删除",
			protectedFolders: "templates,system",
		});
		strategy.resetCache();
	});

	describe("read operations", () => {
		it("read actions are always silent", async () => {
			const decision = await strategy.getDecision("obsidian_read");
			expect(decision.level).toBe(ApprovalLevel.Silent);
		});

		it("search actions are silent", async () => {
			const decision = await strategy.getDecision("obsidian_search");
			expect(decision.level).toBe(ApprovalLevel.Silent);
		});

		it("list actions are silent", async () => {
			const decision = await strategy.getDecision("obsidian_list");
			expect(decision.level).toBe(ApprovalLevel.Silent);
		});

		it("tags actions are silent", async () => {
			const decision = await strategy.getDecision("obsidian_tags");
			expect(decision.level).toBe(ApprovalLevel.Silent);
		});
	});

	describe("dangerous operations", () => {
		it("delete always requires confirm", async () => {
			const decision = await strategy.getDecision("obsidian_delete");
			expect(decision.level).toBe(ApprovalLevel.Confirm);
		});

		it("remove always requires confirm", async () => {
			const decision = await strategy.getDecision("file_remove");
			expect(decision.level).toBe(ApprovalLevel.Confirm);
		});

		it("plugin_install always requires confirm", async () => {
			const decision = await strategy.getDecision("plugin_install");
			expect(decision.level).toBe(ApprovalLevel.Confirm);
		});
	});

	describe("custom danger keywords", () => {
		it("triggers confirm for custom keywords", async () => {
			const decision = await strategy.getDecision("删除文件");
			expect(decision.level).toBe(ApprovalLevel.Confirm);
			expect(decision.description).toContain("Dangerous keyword");
		});
	});

	describe("protected folders", () => {
		it("confirms writes to protected folders", async () => {
			const decision = await strategy.getDecision("obsidian_write", "templates/daily.md");
			expect(decision.level).toBe(ApprovalLevel.Confirm);
			expect(decision.description).toContain("Protected folder");
		});

		it("confirms writes to system folder", async () => {
			const decision = await strategy.getDecision("obsidian_write", "system/config.md");
			expect(decision.level).toBe(ApprovalLevel.Confirm);
		});

		it("does not trigger for unprotected folders", async () => {
			const decision = await strategy.getDecision("obsidian_write", "notes/new.md");
			// Should be Notify (has git) not Confirm
			expect(decision.level).toBe(ApprovalLevel.Notify);
		});
	});

	describe("git-aware behavior", () => {
		it("write operations are Notify when git exists", async () => {
			const decision = await strategy.getDecision("obsidian_write", "notes/new.md");
			expect(decision.level).toBe(ApprovalLevel.Notify);
		});

		it("write operations are Confirm when no git", async () => {
			// Mock no git
			const { access } = await import("fs");
			(access as any).mockImplementation((_path: string, _mode: number, cb: Function) => {
				cb(new Error("ENOENT"));
			});
			strategy.resetCache();

			const decision = await strategy.getDecision("obsidian_write", "notes/new.md");
			expect(decision.level).toBe(ApprovalLevel.Confirm);
		});
	});

	describe("alwaysConfirm setting", () => {
		it("forces confirm for all non-read ops when enabled", async () => {
			strategy.updateSettings({
				alwaysConfirm: true,
				dangerKeywords: "",
				protectedFolders: "",
			});

			const decision = await strategy.getDecision("obsidian_write");
			expect(decision.level).toBe(ApprovalLevel.Confirm);
			expect(decision.description).toContain("Manual confirmation");
		});

		it("reads are still silent even with alwaysConfirm", async () => {
			strategy.updateSettings({
				alwaysConfirm: true,
				dangerKeywords: "",
				protectedFolders: "",
			});

			const decision = await strategy.getDecision("obsidian_read");
			expect(decision.level).toBe(ApprovalLevel.Silent);
		});
	});

	describe("overwrite detection", () => {
		it("escalates when overwriting existing file without git", async () => {
			const { access } = await import("fs");
			(access as any).mockImplementation((_path: string, _mode: number, cb: Function) => {
				cb(new Error("ENOENT")); // no .git
			});
			strategy.resetCache();

			const decision = await strategy.getDecision("obsidian_write", "existing-note.md");
			expect(decision.level).toBe(ApprovalLevel.Confirm);
			expect(decision.description).toContain("Overwrite");
		});
	});

	describe("updateSettings()", () => {
		it("updates the settings used for decisions", async () => {
			strategy.updateSettings({
				alwaysConfirm: false,
				dangerKeywords: "nuke",
				protectedFolders: "",
			});

			const decision = await strategy.getDecision("nuke_everything");
			expect(decision.level).toBe(ApprovalLevel.Confirm);
			expect(decision.description).toContain("Dangerous keyword");
		});
	});
});
