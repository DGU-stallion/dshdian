import type { App } from "obsidian";

/**
 * Get the vault's absolute filesystem path.
 * Obsidian does not expose this via a typed API — the adapter's basePath
 * property is undocumented but stable. We confine the `as any` cast here.
 */
export function getVaultPath(app: App): string {
	return (app.vault.adapter as any).basePath ?? "";
}
