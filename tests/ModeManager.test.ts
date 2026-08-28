import { describe, it, expect, beforeEach, vi } from "vitest";
import { ModeManager } from "../src/services/ModeManager";
import { Mode, Permission } from "../src/types";

// Mock HarnessClient
const mockCreateSession = vi.fn().mockResolvedValue("session-123");
const mockSendMessage = vi.fn().mockResolvedValue(undefined);

const mockClient = {
	createSession: mockCreateSession,
	sendMessage: mockSendMessage,
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
			expect(butler.name).toBe("Standard");
			expect(butler.permission).toBe(Permission.ReadWrite);

			const creator = manager.getConfig(Mode.Creator);
			expect(creator.mode).toBe(Mode.Creator);
			expect(creator.name).toBe("Create");
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

	describe("switchMode() — returns boolean", () => {
		it("returns false when same mode (no-op)", async () => {
			const result = await manager.switchMode(Mode.Chat, "/vault");
			expect(result).toBe(false);
			expect(mockCreateSession).not.toHaveBeenCalled();
		});

		describe("Chat ↔ Butler (same agentPreset)", () => {
			it("Chat → Butler sends /permission command, returns false", async () => {
				// First set up a session
				manager.setSessionId("existing-session");

				const result = await manager.switchMode(Mode.Butler, "/vault");
				expect(result).toBe(false);
				expect(manager.getCurrentMode()).toBe(Mode.Butler);
				expect(manager.getSessionId()).toBe("existing-session");
				expect(mockCreateSession).not.toHaveBeenCalled();
				expect(mockSendMessage).toHaveBeenCalledWith(
					"existing-session",
					"/permission workspace-write"
				);
			});

			it("Butler → Chat sends /permission command, returns false", async () => {
				manager.setSessionId("existing-session");
				// Move to Butler first (from Chat, which triggers sendMessage)
				await manager.switchMode(Mode.Butler, "/vault");
				mockSendMessage.mockClear();

				const result = await manager.switchMode(Mode.Chat, "/vault");
				expect(result).toBe(false);
				expect(manager.getCurrentMode()).toBe(Mode.Chat);
				expect(manager.getSessionId()).toBe("existing-session");
				expect(mockCreateSession).not.toHaveBeenCalled();
				expect(mockSendMessage).toHaveBeenCalledWith(
					"existing-session",
					"/permission read-only"
				);
			});

			it("Chat → Butler with no session skips /permission (no error)", async () => {
				// No session set
				const result = await manager.switchMode(Mode.Butler, "/vault");
				expect(result).toBe(false);
				expect(mockSendMessage).not.toHaveBeenCalled();
				expect(mockCreateSession).not.toHaveBeenCalled();
			});
		});

		describe("Create mode transitions (different agentPreset)", () => {
			it("Chat → Creator creates new session, returns true", async () => {
				const result = await manager.switchMode(Mode.Creator, "/vault");
				expect(result).toBe(true);
				expect(mockCreateSession).toHaveBeenCalledWith(
					"/vault",
					"cordis",
					"danger-full-access"
				);
				expect(manager.getSessionId()).toBe("session-123");
			});

			it("Butler → Creator creates new session, returns true", async () => {
				manager.setSessionId("existing-session");
				await manager.switchMode(Mode.Butler, "/vault");
				mockCreateSession.mockClear();

				const result = await manager.switchMode(Mode.Creator, "/vault");
				expect(result).toBe(true);
				expect(mockCreateSession).toHaveBeenCalledWith(
					"/vault",
					"cordis",
					"danger-full-access"
				);
			});

			it("Creator → Chat creates new session, returns true", async () => {
				await manager.switchMode(Mode.Creator, "/vault");
				mockCreateSession.mockClear();

				const result = await manager.switchMode(Mode.Chat, "/vault");
				expect(result).toBe(true);
				expect(mockCreateSession).toHaveBeenCalledWith(
					"/vault",
					"standard",
					"read-only"
				);
			});

			it("Creator → Butler creates new session, returns true", async () => {
				await manager.switchMode(Mode.Creator, "/vault");
				mockCreateSession.mockClear();

				const result = await manager.switchMode(Mode.Butler, "/vault");
				expect(result).toBe(true);
				expect(mockCreateSession).toHaveBeenCalledWith(
					"/vault",
					"standard",
					"workspace-write"
				);
			});
		});

		it("handles session creation failure gracefully", async () => {
			mockCreateSession.mockRejectedValueOnce(new Error("connection failed"));
			const result = await manager.switchMode(Mode.Creator, "/vault");
			expect(result).toBe(true);
			expect(manager.getSessionId()).toBeNull();
			expect(manager.getCurrentMode()).toBe(Mode.Creator);
		});

		it("handles /permission send failure gracefully", async () => {
			manager.setSessionId("existing-session");
			mockSendMessage.mockRejectedValueOnce(new Error("send failed"));
			const result = await manager.switchMode(Mode.Butler, "/vault");
			expect(result).toBe(false);
			expect(manager.getCurrentMode()).toBe(Mode.Butler);
			// Session preserved despite /permission failure
			expect(manager.getSessionId()).toBe("existing-session");
		});
	});

	describe("ensureSession()", () => {
		it("creates session if none exists", async () => {
			const sid = await manager.ensureSession("/vault");
			expect(sid).toBe("session-123");
			expect(mockCreateSession).toHaveBeenCalledWith(
				"/vault",
				"standard",
				"read-only"
			);
		});

		it("returns existing session without creating", async () => {
			manager.setSessionId("existing-session");
			const sid = await manager.ensureSession("/vault");
			expect(sid).toBe("existing-session");
			expect(mockCreateSession).not.toHaveBeenCalled();
		});

		it("uses correct preset for current mode", async () => {
			// Switch to Creator first (creates session)
			await manager.switchMode(Mode.Creator, "/vault");
			manager.clearSession();
			mockCreateSession.mockClear();

			const sid = await manager.ensureSession("/vault");
			expect(sid).toBe("session-123");
			expect(mockCreateSession).toHaveBeenCalledWith(
				"/vault",
				"cordis",
				"danger-full-access"
			);
		});

		it("handles failure gracefully", async () => {
			mockCreateSession.mockRejectedValueOnce(new Error("fail"));
			const sid = await manager.ensureSession("/vault");
			expect(sid).toBeNull();
		});
	});

	describe("clearSession()", () => {
		it("sets session to null", () => {
			manager.setSessionId("session-123");
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
