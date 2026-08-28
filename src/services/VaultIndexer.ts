import type { App, TFile } from "obsidian";

/**
 * Indexes vault structure for automatic context injection.
 * Provides a compact summary of the vault: file tree, tags, recent files.
 */
export class VaultIndexer {
	private app: App;
	private cachedIndex: string | null = null;
	private lastIndexTime = 0;
	private readonly CACHE_TTL_MS = 60_000; // Re-index every 60s max

	constructor(app: App) {
		this.app = app;
	}

	/** Get the vault structure summary (cached). */
	getIndex(): string {
		const now = Date.now();
		if (this.cachedIndex && now - this.lastIndexTime < this.CACHE_TTL_MS) {
			return this.cachedIndex;
		}
		this.cachedIndex = this.buildIndex();
		this.lastIndexTime = now;
		return this.cachedIndex;
	}

	/** Force re-index */
	invalidate(): void {
		this.cachedIndex = null;
	}

	private buildIndex(): string {
		const files = this.app.vault.getFiles();
		const mdFiles = files.filter(f => f.extension === "md");

		// File tree (compact, max 100 entries)
		const tree = this.buildTree(mdFiles.slice(0, 100));

		// Tags
		const tags = this.collectTags();

		// Recent files (last 10 modified)
		const recent = [...mdFiles]
			.sort((a, b) => b.stat.mtime - a.stat.mtime)
			.slice(0, 10)
			.map(f => f.path);

		const parts: string[] = [];
		parts.push(`[Vault Structure] ${mdFiles.length} notes total`);
		parts.push("");
		parts.push("File tree (top 100):");
		parts.push(tree);

		if (tags.length > 0) {
			parts.push("");
			parts.push(`Tags: ${tags.slice(0, 30).join(", ")}`);
		}

		parts.push("");
		parts.push("Recently modified:");
		for (const p of recent) {
			parts.push(`  ${p}`);
		}

		return parts.join("\n");
	}

	private buildTree(files: TFile[]): string {
		// Group by top-level folder
		const folders = new Map<string, string[]>();
		for (const f of files) {
			const parts = f.path.split("/");
			const folder = parts.length > 1 ? parts[0] : "/";
			if (!folders.has(folder)) folders.set(folder, []);
			folders.get(folder)!.push(f.path);
		}

		const lines: string[] = [];
		for (const [folder, paths] of folders) {
			if (folder === "/") {
				for (const p of paths.slice(0, 5)) {
					lines.push(`  ${p}`);
				}
			} else {
				lines.push(`  ${folder}/ (${paths.length} files)`);
				for (const p of paths.slice(0, 3)) {
					lines.push(`    ${p}`);
				}
				if (paths.length > 3) {
					lines.push(`    ... and ${paths.length - 3} more`);
				}
			}
		}
		return lines.join("\n");
	}

	private collectTags(): string[] {
		const tagSet = new Set<string>();
		const cache = this.app.metadataCache;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const meta = cache.getFileCache(file);
			if (meta?.tags) {
				for (const t of meta.tags) {
					tagSet.add(t.tag);
				}
			}
			// Also check frontmatter tags
			if (meta?.frontmatter?.tags) {
				const fm = meta.frontmatter.tags;
				const fmTags = Array.isArray(fm) ? fm : typeof fm === "string" ? fm.split(",") : [];
				for (const t of fmTags) {
					const tag = t.trim();
					if (tag) tagSet.add(tag.startsWith("#") ? tag : `#${tag}`);
				}
			}
		}
		return [...tagSet].sort();
	}
}
