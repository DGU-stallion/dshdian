import { describe, it, expect, beforeEach, vi } from "vitest";
import { ModeManager } from "../src/services/ModeManager";
import { Mode, Permission } from "../src/types";

// Mock HarnessClient
const mockCreateSession = vi.fn().mockResolvedValue("session-123");

const mockClient = {
	createSession: mockCreateSession,
} as any;

describe("ModeManager", () => {
	let manager: ModeManager;

	beforeEach(() => {
		vi.clearAllMocks();
		manager = new ModeManager(mockClient);
	});

	describe("initial state", () => {
		it("starts in Chat mode", () => {
			expect(manager.getCurrentMode()).toBe(Mode.Chat);
		});

		it("starts with no session", () => {
			expect(manager.getSessionId()).toBeNull();
		});
	});

	describe("getConfig()", () => {
		it("returns Chat config by default", () => {
			const config = manager.getConfig();
			expect(config.mode).toBe(Mode.Chat);
			expect(config.name).toBe("Chat");
			expect(config.permission).toBe(Permission.Readonly);
		});

		it("returns specific mode config", () => {
			const butler = manager.getConfig(Mode.Butler);
			expect(butler.mode).toBe(Mode.Butler);
			expect(butler.permission).toBe(Permission.ReadWrite);

			const creator = manager.getConfig(Mode.Creator);
			expect(creator.mode).toBe(Mode.Creator);
			expect(creator.permission).toBe(Permission.ReadWritePlugins);
		});
	});

	describe("getToolWhitelist()", () => {
		it("Chat mode has read-only tools", () => {
			const tools = manager.getToolWhitelist();
			expect(tools).toContain("obsidian_read");
			expect(tools).toContain("obsidian_search");
			expect(tools).not.toContain("obsidian_write");
			expect(tools).not.toContain("obsidian_delete");
		});

		it("Butler mode has write tools", async () => {
			await manager.switchMode(Mode.Butler, "/vault");
			const tools = manager.getToolWhitelist();
			expect(tools).toContain("obsidian_read");
			expect(tools).toContain("obsidian_write");
			expect(tools).toContain("obsidian_delete");
			expect(tools).not.toContain("esbuild");
		});

		it("Creator mode has all tools including esbuild", async () => {
			await manager.switchMode(Mode.Creator, "/vault");
			const tools = manager.getToolWhitelist();
			expect(tools).toContain("obsidian_write");
			expect(tools).toContain("esbuild");
		});
	});

	describe("switchMode()", () => {
		it("creates a session with correct preset for Chat", async () => {
			// Force switch by clearing session
			manager.clearSession();
			await manager.switchMode(Mode.Chat, "/vault");
			expect(mockCreateSession).toHaveBeenCalledWith(
				"/vault",
				"standard",
				"read-only"
			);
			expect(manager.getSessionId()).toBe("session-123");
		});

		it("creates a session with correct preset for Butler", async () => {
			await manager.switchMode(Mode.Butler, "/vault");
			expect(mockCreateSession).toHaveBeenCalledWith(
				"/vault",
				"standard",
				"workspace-write"
			);
		});

		it("creates a session with correct preset for Creator", async () => {
			await manager.switchMode(Mode.Creator, "/vault");
			expect(mockCreateSession).toHaveBeenCalledWith(
				"/vault",
				"cordis",
				"danger-full-access"
			);
		});

		it("does not switch if same mode and session exists", async () => {
			await manager.switchMode(Mode.Chat, "/vault");
			mockCreateSession.mockClear();
			await manager.switchMode(Mode.Chat, "/vault");
			expect(mockCreateSession).not.toHaveBeenCalled();
		});

		it("switches if same mode but no session", async () => {
			manager.clearSession();
			await manager.switchMode(Mode.Chat, "/vault");
			expect(mockCreateSession).toHaveBeenCalled();
		});

		it("handles session creation failure gracefully", async () => {
			mockCreateSession.mockRejectedValueOnce(new Error("connection failed"));
			await manager.switchMode(Mode.Butler, "/vault");
			expect(manager.getSessionId()).toBeNull();
			expect(manager.getCurrentMode()).toBe(Mode.Butler);
		});
	});

	describe("clearSession()", () => {
		it("sets session to null", async () => {
			await manager.switchMode(Mode.Chat, "/vault");
			expect(manager.getSessionId()).toBe("session-123");
			manager.clearSession();
			expect(manager.getSessionId()).toBeNull();
		});
	});

	describe("setSessionId()", () => {
		it("sets session directly", () => {
			manager.setSessionId("custom-session");
			expect(manager.getSessionId()).toBe("custom-session");
		});
	});
});
