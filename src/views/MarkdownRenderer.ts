import { MarkdownRenderer, Component } from "obsidian";

/**
 * Render markdown text into an HTML container using Obsidian's built-in renderer.
 * Falls back to setting textContent if the renderer is unavailable.
 */
export async function renderMarkdown(
	container: HTMLElement,
	text: string,
	sourcePath: string,
	component: Component
): Promise<void> {
	container.empty();
	try {
		await MarkdownRenderer.render(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(component as any).app ?? (window as any).app,
			text,
			container,
			sourcePath,
			component
		);
		// Add copy buttons to code blocks
		addCopyButtons(container);
	} catch {
		// Fallback: plain text
		container.textContent = text;
	}
}

/** Add a copy button to each pre>code block in the container */
function addCopyButtons(container: HTMLElement): void {
	const codeBlocks = container.querySelectorAll("pre > code");
	codeBlocks.forEach((codeEl) => {
		const pre = codeEl.parentElement;
		if (!pre) return;
		// Avoid duplicate buttons
		if (pre.querySelector(".dshdian-copy-btn")) return;
		pre.style.position = "relative";
		const btn = document.createElement("button");
		btn.className = "dshdian-copy-btn";
		btn.textContent = "Copy";
		btn.addEventListener("click", () => {
			const code = codeEl.textContent ?? "";
			navigator.clipboard.writeText(code).then(() => {
				btn.textContent = "Copied!";
				setTimeout(() => {
					btn.textContent = "Copy";
				}, 1500);
			});
		});
		pre.appendChild(btn);
	});
}
