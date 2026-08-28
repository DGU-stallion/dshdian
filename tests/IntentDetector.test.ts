import { describe, it, expect } from "vitest";
import { IntentDetector } from "../src/services/IntentDetector";
import { Mode } from "../src/types";

describe("IntentDetector", () => {
	const detector = new IntentDetector();

	describe("detect()", () => {
		it("returns null when not in Chat mode", () => {
			expect(detector.detect("create a note", Mode.Butler)).toBeNull();
			expect(detector.detect("create a note", Mode.Creator)).toBeNull();
		});

		it("returns null for regular questions in Chat mode", () => {
			expect(detector.detect("what is this note about?", Mode.Chat)).toBeNull();
			expect(detector.detect("summarize this", Mode.Chat)).toBeNull();
			expect(detector.detect("explain the concept", Mode.Chat)).toBeNull();
		});

		it("detects write intent → suggests Butler", () => {
			expect(detector.detect("create a new note", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("delete this file", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("rename the note", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("move it to another folder", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("organize my vault", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("modify the frontmatter", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("edit the content", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("tag all notes", Mode.Chat)).toBe(Mode.Butler);
		});

		it("detects Chinese write intent → suggests Butler", () => {
			expect(detector.detect("创建一个新笔记", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("删除这个文件", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("重命名笔记", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("移动到其他文件夹", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("整理我的 vault", Mode.Chat)).toBe(Mode.Butler);
			expect(detector.detect("修改内容", Mode.Chat)).toBe(Mode.Butler);
		});

		it("detects creator intent → suggests Creator (higher priority)", () => {
			expect(detector.detect("create a plugin for me", Mode.Chat)).toBe(Mode.Creator);
			expect(detector.detect("生成一个插件", Mode.Chat)).toBe(Mode.Creator);
			expect(detector.detect("generate some typescript code", Mode.Chat)).toBe(Mode.Creator);
			expect(detector.detect("build an extension", Mode.Chat)).toBe(Mode.Creator);
		});

		it("creator intent takes priority over write intent", () => {
			// "create a plugin" matches both write (create) and creator (plugin)
			expect(detector.detect("create a plugin", Mode.Chat)).toBe(Mode.Creator);
		});
	});

	describe("getSuggestionMessage()", () => {
		it("returns Butler message", () => {
			const msg = detector.getSuggestionMessage(Mode.Butler);
			expect(msg).toContain("管家模式");
			expect(msg.length).toBeGreaterThan(0);
		});

		it("returns Creator message", () => {
			const msg = detector.getSuggestionMessage(Mode.Creator);
			expect(msg).toContain("创造模式");
			expect(msg.length).toBeGreaterThan(0);
		});

		it("returns empty string for Chat mode", () => {
			expect(detector.getSuggestionMessage(Mode.Chat)).toBe("");
		});
	});
});
