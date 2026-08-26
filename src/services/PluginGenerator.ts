import { App } from "obsidian";
import { getVaultPath } from "../utils";
import * as path from "path";
import * as fs from "fs";
import type { PluginSpec } from "../types";

const PREVIEW_DIR = "_dshdian_preview";

/**
 * Generates, compiles, previews, and installs Obsidian plugins
 * from AI-produced TypeScript source in Creator mode.
 */
export class PluginGenerator {
	private app: App;
	private vaultPath: string;

	constructor(app: App) {
		this.app = app;
		this.vaultPath = getVaultPath(app);
	}

	/** Create TypeScript source files from an AI-produced spec */
	async generatePlugin(spec: PluginSpec): Promise<string> {
		const pluginDir = path.join(this.vaultPath, PREVIEW_DIR, spec.id);
		await this.ensureDir(pluginDir);

		// Write each source file
		for (const [filename, content] of Object.entries(spec.sources)) {
			const filePath = path.join(pluginDir, filename);
			await this.ensureDir(path.dirname(filePath));
			fs.writeFileSync(filePath, content, "utf-8");
		}

		// Write manifest
		const manifest = {
			id: spec.id,
			name: spec.name,
			description: spec.description,
			version: spec.version,
			minAppVersion: "1.5.0",
			isDesktopOnly: false,
		};
		fs.writeFileSync(
			path.join(pluginDir, "manifest.json"),
			JSON.stringify(manifest, null, 2),
			"utf-8"
		);

		return pluginDir;
	}

	/** Compile TypeScript source to a bundled main.js using esbuild */
	async compilePlugin(pluginDir: string): Promise<boolean> {
		const entryPoint = path.join(pluginDir, "main.ts");
		if (!fs.existsSync(entryPoint)) {
			return false;
		}

		// Dynamic require esbuild — Creator mode requires esbuild installed
		try {
			const esbuild = require("esbuild");
			await esbuild.build({
				entryPoints: [entryPoint],
				bundle: true,
				external: ["obsidian", "electron"],
				format: "cjs",
				target: "es2018",
				outfile: path.join(pluginDir, "main.js"),
				logLevel: "silent",
			});
			return true;
		} catch (e) {
			console.error("dshdian: plugin compilation failed —", e);
			throw new Error(
				"esbuild is required for Creator mode plugin compilation. " +
				"Ensure esbuild is available: " + String(e)
			);
		}
	}

	/** Preview: the plugin is already in _dshdian_preview/{id} after generate+compile */
	async previewPlugin(id: string): Promise<string> {
		const pluginDir = path.join(this.vaultPath, PREVIEW_DIR, id);
		if (!fs.existsSync(path.join(pluginDir, "main.js"))) {
			throw new Error(`Plugin ${id} has not been compiled yet`);
		}
		return pluginDir;
	}

	/** Install: move from preview to .obsidian/plugins/ */
	async installPlugin(id: string): Promise<void> {
		const srcDir = path.join(this.vaultPath, PREVIEW_DIR, id);
		const destDir = path.join(this.vaultPath, ".obsidian", "plugins", id);

		if (!fs.existsSync(srcDir)) {
			throw new Error(`Preview plugin ${id} not found`);
		}

		await this.ensureDir(destDir);
		this.copyDirSync(srcDir, destDir);
		this.removeDirSync(srcDir);
	}

	/** Remove preview directory for a plugin */
	removePreview(id: string): void {
		const dir = path.join(this.vaultPath, PREVIEW_DIR, id);
		if (fs.existsSync(dir)) {
			this.removeDirSync(dir);
		}
	}

	/** Scaffold a minimal plugin template */
	scaffoldPlugin(name: string): PluginSpec {
		const id = name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "");

		const mainTs = `import { Plugin } from "obsidian";

export default class ${this.toPascalCase(name)}Plugin extends Plugin {
\tasync onload() {
\t\tconsole.log("Loading ${name}");
\t}

\tonunload() {
\t\tconsole.log("Unloading ${name}");
\t}
}
`;

		return {
			id,
			name,
			description: `Generated plugin: ${name}`,
			version: "0.0.1",
			sources: { "main.ts": mainTs },
		};
	}

	private toPascalCase(str: string): string {
		return str
			.split(/[\s\-_]+/)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
			.join("");
	}

	private async ensureDir(dir: string): Promise<void> {
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir, { recursive: true });
		}
	}

	private copyDirSync(src: string, dest: string): void {
		const entries = fs.readdirSync(src, { withFileTypes: true });
		for (const entry of entries) {
			const srcPath = path.join(src, entry.name);
			const destPath = path.join(dest, entry.name);
			if (entry.isDirectory()) {
				if (!fs.existsSync(destPath)) {
					fs.mkdirSync(destPath, { recursive: true });
				}
				this.copyDirSync(srcPath, destPath);
			} else {
				fs.copyFileSync(srcPath, destPath);
			}
		}
	}

	private removeDirSync(dir: string): void {
		if (fs.existsSync(dir)) {
			const entries = fs.readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const fullPath = path.join(dir, entry.name);
				if (entry.isDirectory()) {
					this.removeDirSync(fullPath);
				} else {
					fs.unlinkSync(fullPath);
				}
			}
			fs.rmdirSync(dir);
		}
	}
}
