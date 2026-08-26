import { App, TFile } from "obsidian";
import type { Reference, ResolvedReference } from "../types";

/** Pattern to match @references in user input (supports @note, @folder/note, @#tag, @tag/name) */
const REF_PATTERN = /(?:^|\s)@([#\w\-/]+)/g;

/**
 * Resolves @file references from user input.
 * Supports @note-name, @folder/note, and @tag patterns.
 */
export class ReferenceResolver {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/** Find all @mentions in input text */
	parseReferences(text: string): Reference[] {
		const refs: Reference[] = [];
		const seen = new Set<string>();
		let match: RegExpExecArray | null;

		// Reset lastIndex for global regex
		REF_PATTERN.lastIndex = 0;
		while ((match = REF_PATTERN.exec(text)) !== null) {
			const raw = match[1];
			if (seen.has(raw)) continue;
			seen.add(raw);

			if (raw.startsWith("tag/") || raw.startsWith("#")) {
				refs.push({ raw, type: "tag", path: raw.replace(/^(tag\/|#)/, "") });
			} else if (raw.includes("/")) {
				refs.push({ raw, type: "folder-note", path: raw });
			} else {
				refs.push({ raw, type: "note", path: raw });
			}
		}
		return refs;
	}

	/** Resolve a single reference to its file content */
	async resolveReference(ref: Reference): Promise<ResolvedReference | null> {
		if (ref.type === "tag") {
			// Tag references: collect files with that tag
			const files = this.app.vault.getMarkdownFiles();
			const contents: string[] = [];
			for (const file of files) {
				const cache = this.app.metadataCache.getFileCache(file);
				const tags = cache?.tags?.map((t) => t.tag.replace(/^#/, "")) ?? [];
				if (tags.includes(ref.path)) {
					const content = await this.app.vault.cachedRead(file);
					contents.push(`--- ${file.path} ---\n${content}`);
				}
			}
			if (contents.length === 0) return null;
			return { ref, content: contents.join("\n\n") };
		}

		// Note or folder/note reference
		const file = this.findFile(ref.path);
		if (!file) return null;
		const content = await this.app.vault.cachedRead(file);
		return { ref, content };
	}

	/** Get autocomplete suggestions for a partial query */
	getSuggestions(query: string): string[] {
		const lower = query.toLowerCase();
		const files = this.app.vault.getMarkdownFiles();
		const results: string[] = [];

		for (const file of files) {
			const name = file.basename.toLowerCase();
			const path = file.path.toLowerCase().replace(/\.md$/, "");
			if (name.startsWith(lower) || path.includes(lower)) {
				results.push(file.path.replace(/\.md$/, ""));
			}
			if (results.length >= 10) break;
		}
		return results;
	}

	/** Build context string from multiple resolved references */
	async buildContext(refs: Reference[]): Promise<string> {
		const parts: string[] = [];
		for (const ref of refs) {
			const resolved = await this.resolveReference(ref);
			if (resolved) {
				parts.push(`[Referenced: @${ref.raw}]\n${resolved.content}`);
			}
		}
		return parts.join("\n\n---\n\n");
	}

	private findFile(path: string): TFile | null {
		// Try exact path with .md extension
		const withExt = path.endsWith(".md") ? path : path + ".md";
		const file = this.app.vault.getAbstractFileByPath(withExt);
		if (file instanceof TFile) return file;

		// Try finding by basename
		const files = this.app.vault.getMarkdownFiles();
		const target = path.toLowerCase();
		return files.find((f) => f.basename.toLowerCase() === target) ?? null;
	}
}
