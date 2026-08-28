import { describe, it, expect, beforeEach } from "vitest";
import { VaultIndexer } from "../src/services/VaultIndexer";
import { App, TFile, Vault, MetadataCache } from "./mocks/obsidian";

describe("VaultIndexer", () => {
	let app: App;
	let indexer: VaultIndexer;

	beforeEach(() => {
		app = new App();
		indexer = new VaultIndexer(app as any);
	});

	describe("getIndex()", () => {
		it("returns vault structure for empty vault", () => {
			const index = indexer.getIndex();
			expect(index).toContain("[Vault Structure] 0 notes total");
			expect(index).toContain("Recently modified:");
		});

		it("includes file tree for populated vault", () => {
			const files = [
				new TFile("notes/daily.md", 1000),
				new TFile("notes/weekly.md", 2000),
				new TFile("projects/readme.md", 3000),
				new TFile("root-note.md", 4000),
			];
			(app.vault as any).setFiles(files);

			const index = indexer.getIndex();
			expect(index).toContain("4 notes total");
			expect(index).toContain("notes/");
			expect(index).toContain("projects/");
			expect(index).toContain("root-note.md");
		});

		it("includes recently modified files sorted by mtime", () => {
			const files = [
				new TFile("old.md", 1000),
				new TFile("newer.md", 5000),
				new TFile("newest.md", 9000),
			];
			(app.vault as any).setFiles(files);

			const index = indexer.getIndex();
			const recentSection = index.split("Recently modified:")[1];
			const lines = recentSection.trim().split("\n").map(l => l.trim());
			// Should be sorted newest first
			expect(lines[0]).toBe("newest.md");
			expect(lines[1]).toBe("newer.md");
			expect(lines[2]).toBe("old.md");
		});

		it("includes tags from metadata cache", () => {
			const files = [new TFile("tagged.md", 1000)];
			(app.vault as any).setFiles(files);
			(app.metadataCache as any).setCache("tagged.md", {
				tags: [{ tag: "#test" }, { tag: "#project" }],
			});

			const index = indexer.getIndex();
			expect(index).toContain("Tags:");
			expect(index).toContain("#test");
			expect(index).toContain("#project");
		});

		it("includes frontmatter tags", () => {
			const files = [new TFile("fm-tags.md", 1000)];
			(app.vault as any).setFiles(files);
			(app.metadataCache as any).setCache("fm-tags.md", {
				frontmatter: { tags: ["alpha", "beta"] },
			});

			const index = indexer.getIndex();
			expect(index).toContain("#alpha");
			expect(index).toContain("#beta");
		});
	});

	describe("caching", () => {
		it("returns cached result on second call", () => {
			const files = [new TFile("note.md", 1000)];
			(app.vault as any).setFiles(files);

			const first = indexer.getIndex();
			// Change files but cache should still return old
			(app.vault as any).setFiles([]);
			const second = indexer.getIndex();
			expect(second).toBe(first);
		});

		it("invalidate() forces re-index", () => {
			const files = [new TFile("note.md", 1000)];
			(app.vault as any).setFiles(files);

			const first = indexer.getIndex();
			expect(first).toContain("1 notes total");

			(app.vault as any).setFiles([]);
			indexer.invalidate();
			const second = indexer.getIndex();
			expect(second).toContain("0 notes total");
		});
	});

	describe("buildTree()", () => {
		it("groups files by top-level folder", () => {
			const files = [
				new TFile("folder-a/note1.md", 1000),
				new TFile("folder-a/note2.md", 2000),
				new TFile("folder-a/note3.md", 3000),
				new TFile("folder-a/note4.md", 4000),
				new TFile("folder-b/other.md", 5000),
			];
			(app.vault as any).setFiles(files);

			const index = indexer.getIndex();
			expect(index).toContain("folder-a/ (4 files)");
			expect(index).toContain("folder-b/ (1 files)");
			// Should truncate folder-a to 3 shown + "and 1 more"
			expect(index).toContain("... and 1 more");
		});
	});
});
