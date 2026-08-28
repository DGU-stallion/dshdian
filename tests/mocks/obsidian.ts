/**
 * Minimal mock of Obsidian API for unit tests.
 * Only stubs what our tested services actually use.
 */

export class Events {
	private handlers: Record<string, Function[]> = {};
	on(event: string, fn: Function): void {
		if (!this.handlers[event]) this.handlers[event] = [];
		this.handlers[event].push(fn);
	}
	trigger(event: string, ...args: unknown[]): void {
		for (const fn of this.handlers[event] ?? []) {
			fn(...args);
		}
	}
}

export class App {
	vault = new Vault();
	metadataCache = new MetadataCache();
}

export class Vault {
	adapter = { basePath: "/mock/vault" };
	private files: TFile[] = [];

	setFiles(files: TFile[]): void {
		this.files = files;
	}

	getFiles(): TFile[] {
		return this.files;
	}

	getMarkdownFiles(): TFile[] {
		return this.files.filter(f => f.extension === "md");
	}

	getAbstractFileByPath(path: string): TFile | null {
		return this.files.find(f => f.path === path) ?? null;
	}
}

export class MetadataCache {
	private cache: Map<string, any> = new Map();

	setCache(path: string, data: any): void {
		this.cache.set(path, data);
	}

	getFileCache(file: TFile): any {
		return this.cache.get(file.path) ?? null;
	}
}

export class TFile {
	path: string;
	name: string;
	extension: string;
	stat: { mtime: number; ctime: number; size: number };
	parent: { path: string } | null;

	constructor(path: string, mtime = Date.now()) {
		this.path = path;
		this.name = path.split("/").pop() ?? path;
		this.extension = this.name.split(".").pop() ?? "";
		this.stat = { mtime, ctime: mtime, size: 100 };
		this.parent = path.includes("/")
			? { path: path.split("/").slice(0, -1).join("/") }
			: null;
	}
}

export function request(_opts: any): Promise<string> {
	return Promise.resolve("");
}

export function requestUrl(_opts: any): Promise<{ json: any; text: string; status: number }> {
	return Promise.resolve({ json: {}, text: "", status: 200 });
}
