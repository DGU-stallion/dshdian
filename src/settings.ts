import { App, PluginSettingTab, Setting } from "obsidian";
import { Mode } from "./types";
import type DshdianPlugin from "./main";

export interface DshdianSettings {
	// Connection
	harnessPort: number;
	harnessPath: string;
	autoStartHarness: boolean;
	// Model
	defaultModel: string;
	reasoningEffort: "low" | "medium" | "high";
	// Agent
	defaultMode: Mode;
	customAgentDir: string;
	// System Prompts
	chatSystemPrompt: string;
	butlerSystemPrompt: string;
	creatorSystemPrompt: string;
	// Context
	maxContextLength: number;
	includeFrontmatter: boolean;
	autoContextFiles: string;
	// Approval
	autoApproveReads: boolean;
	alwaysConfirm: boolean;
	dangerKeywords: string;
}

export const DEFAULT_SETTINGS: DshdianSettings = {
	harnessPort: 3180,
	harnessPath: "",
	autoStartHarness: false,
	defaultModel: "deepseek-chat",
	reasoningEffort: "medium",
	defaultMode: Mode.Chat,
	customAgentDir: "",
	chatSystemPrompt: "",
	butlerSystemPrompt: "",
	creatorSystemPrompt: "",
	maxContextLength: 50000,
	includeFrontmatter: true,
	autoContextFiles: "",
	autoApproveReads: true,
	alwaysConfirm: false,
	dangerKeywords: "delete,remove,drop,destroy",
};

export class DshdianSettingTab extends PluginSettingTab {
	plugin: DshdianPlugin;

	constructor(app: App, plugin: DshdianPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ---- Connection ----
		containerEl.createEl("h3", { text: "Connection" });

		new Setting(containerEl)
			.setName("Harness port")
			.setDesc("Port number for the DSH Harness process")
			.addText((text) =>
				text
					.setPlaceholder("3180")
					.setValue(String(this.plugin.settings.harnessPort))
					.onChange(async (value) => {
						const port = parseInt(value, 10);
						if (!isNaN(port) && port > 0 && port < 65536) {
							this.plugin.settings.harnessPort = port;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Harness executable path")
			.setDesc("Path to the DSH Harness binary (leave empty to use system PATH)")
			.addText((text) =>
				text
					.setPlaceholder("/usr/local/bin/dsh-harness")
					.setValue(this.plugin.settings.harnessPath)
					.onChange(async (value) => {
						this.plugin.settings.harnessPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-connect on startup")
			.setDesc("Attempt to connect to the DSH Harness when the plugin loads")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStartHarness)
					.onChange(async (value) => {
						this.plugin.settings.autoStartHarness = value;
						await this.plugin.saveSettings();
					})
			);

		// ---- Model ----
		containerEl.createEl("h3", { text: "Model" });

		new Setting(containerEl)
			.setName("Default model")
			.setDesc("Model identifier to use by default")
			.addText((text) =>
				text
					.setPlaceholder("deepseek-chat")
					.setValue(this.plugin.settings.defaultModel)
					.onChange(async (value) => {
						this.plugin.settings.defaultModel = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Reasoning effort")
			.setDesc("How much compute to allocate for reasoning")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("low", "Low")
					.addOption("medium", "Medium")
					.addOption("high", "High")
					.setValue(this.plugin.settings.reasoningEffort)
					.onChange(async (value) => {
						this.plugin.settings.reasoningEffort = value as "low" | "medium" | "high";
						await this.plugin.saveSettings();
					})
			);

		// ---- Agent ----
		containerEl.createEl("h3", { text: "Agent" });

		new Setting(containerEl)
			.setName("Default mode")
			.setDesc("Mode to activate when the panel first opens")
			.addDropdown((dropdown) =>
				dropdown
					.addOption(Mode.Chat, "Chat (read-only)")
					.addOption(Mode.Butler, "Butler (vault operations)")
					.addOption(Mode.Creator, "Creator (plugin generation)")
					.setValue(this.plugin.settings.defaultMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultMode = value as Mode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Custom agent directory")
			.setDesc("Path to custom agent configurations (leave empty for defaults)")
			.addText((text) =>
				text
					.setPlaceholder("")
					.setValue(this.plugin.settings.customAgentDir)
					.onChange(async (value) => {
						this.plugin.settings.customAgentDir = value;
						await this.plugin.saveSettings();
					})
			);

		// ---- System Prompts ----
		containerEl.createEl("h3", { text: "System Prompts" });

		new Setting(containerEl)
			.setName("Chat system prompt")
			.setDesc("Override for Chat mode system prompt (leave empty for default)")
			.addTextArea((text) =>
				text
					.setPlaceholder("Custom system prompt for Chat mode...")
					.setValue(this.plugin.settings.chatSystemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.chatSystemPrompt = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Butler system prompt")
			.setDesc("Override for Butler mode system prompt (leave empty for default)")
			.addTextArea((text) =>
				text
					.setPlaceholder("Custom system prompt for Butler mode...")
					.setValue(this.plugin.settings.butlerSystemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.butlerSystemPrompt = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Creator system prompt")
			.setDesc("Override for Creator mode system prompt (leave empty for default)")
			.addTextArea((text) =>
				text
					.setPlaceholder("Custom system prompt for Creator mode...")
					.setValue(this.plugin.settings.creatorSystemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.creatorSystemPrompt = value;
						await this.plugin.saveSettings();
					})
			);

		// Set textarea rows
		containerEl.querySelectorAll("textarea").forEach((ta) => {
			ta.rows = 5;
		});

		// ---- Context ----
		containerEl.createEl("h3", { text: "Context" });

		new Setting(containerEl)
			.setName("Max context length")
			.setDesc("Maximum characters to inject from @referenced files (per message)")
			.addText((text) =>
				text
					.setPlaceholder("50000")
					.setValue(String(this.plugin.settings.maxContextLength))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.maxContextLength = n;
							await this.plugin.saveSettings();
						}
					})
			);

		new Setting(containerEl)
			.setName("Include frontmatter")
			.setDesc("Include YAML frontmatter when injecting note content")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeFrontmatter)
					.onChange(async (value) => {
						this.plugin.settings.includeFrontmatter = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Auto-context files")
			.setDesc("Comma-separated paths to always include as context")
			.addText((text) =>
				text
					.setPlaceholder("notes/context.md, templates/prompt.md")
					.setValue(this.plugin.settings.autoContextFiles)
					.onChange(async (value) => {
						this.plugin.settings.autoContextFiles = value;
						await this.plugin.saveSettings();
					})
			);

		// ---- Approval ----
		containerEl.createEl("h3", { text: "Approval" });

		new Setting(containerEl)
			.setName("Auto-approve read operations")
			.setDesc("Skip confirmation for read-only actions (search, list, read file)")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoApproveReads)
					.onChange(async (value) => {
						this.plugin.settings.autoApproveReads = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Always require confirmation")
			.setDesc("Ask for approval on ALL write operations, even with git")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.alwaysConfirm)
					.onChange(async (value) => {
						this.plugin.settings.alwaysConfirm = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("Danger keywords")
			.setDesc("Comma-separated keywords that trigger extra confirmation")
			.addText((text) =>
				text
					.setPlaceholder("delete,remove,drop,destroy")
					.setValue(this.plugin.settings.dangerKeywords)
					.onChange(async (value) => {
						this.plugin.settings.dangerKeywords = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
