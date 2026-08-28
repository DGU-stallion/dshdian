import { App, PluginSettingTab, Setting } from "obsidian";
import { Mode } from "./types";
import type DshdianPlugin from "./main";

export interface DshdianSettings {
	// 连接
	harnessPort: number;
	harnessPath: string;
	autoStartHarness: boolean;
	// 模型
	defaultModel: string;
	reasoningEffort: "low" | "medium" | "high";
	// Agent 预设
	defaultMode: Mode;
	customAgentDir: string;
	chatSystemPrompt: string;
	butlerSystemPrompt: string;
	creatorSystemPrompt: string;
	// 上下文
	maxContextLength: number;
	includeFrontmatter: boolean;
	autoContextFiles: string;
	// 审批
	autoApproveReads: boolean;
	alwaysConfirm: boolean;
	dangerKeywords: string;
}

export const DEFAULT_SETTINGS: DshdianSettings = {
	harnessPort: 3180,
	harnessPath: "",
	autoStartHarness: true,
	defaultModel: "deepseek-v4",
	reasoningEffort: "medium",
	defaultMode: Mode.Chat,
	customAgentDir: "",
	chatSystemPrompt: "你是一个只读助手。基于 vault 内容回答问题，不修改任何文件。",
	butlerSystemPrompt: "你是 vault 管家。可以创建、移动、修改和删除笔记和文件。使用 Obsidian CLI 执行操作。",
	creatorSystemPrompt: "你是插件创造者。生成完整、独立的 Obsidian 原生插件。输出可独立编译的 TypeScript 源码。",
	maxContextLength: 50000,
	includeFrontmatter: false,
	autoContextFiles: "",
	autoApproveReads: true,
	alwaysConfirm: false,
	dangerKeywords: "delete,remove,删除",
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

		// ──── 连接 ────
		containerEl.createEl("h3", { text: "连接" });

		new Setting(containerEl)
			.setName("Harness 端口")
			.setDesc("DSH Harness 进程监听端口")
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
			.setName("Harness 路径")
			.setDesc("DSH Harness 可执行文件路径（留空则使用系统 PATH 中的 dsh）")
			.addText((text) =>
				text
					.setPlaceholder("dsh")
					.setValue(this.plugin.settings.harnessPath)
					.onChange(async (value) => {
						this.plugin.settings.harnessPath = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("启动时自动连接")
			.setDesc("插件加载时自动启动或连接 DSH Harness")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStartHarness)
					.onChange(async (value) => {
						this.plugin.settings.autoStartHarness = value;
						await this.plugin.saveSettings();
					})
			);

		// ──── 模型 ────
		containerEl.createEl("h3", { text: "模型" });

		new Setting(containerEl)
			.setName("默认模型")
			.setDesc("默认使用的模型标识符")
			.addText((text) =>
				text
					.setPlaceholder("deepseek-v4")
					.setValue(this.plugin.settings.defaultModel)
					.onChange(async (value) => {
						this.plugin.settings.defaultModel = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("推理强度")
			.setDesc("分配给推理的计算量")
			.addDropdown((dropdown) =>
				dropdown
					.addOption("low", "低")
					.addOption("medium", "中")
					.addOption("high", "高")
					.setValue(this.plugin.settings.reasoningEffort)
					.onChange(async (value) => {
						this.plugin.settings.reasoningEffort = value as "low" | "medium" | "high";
						await this.plugin.saveSettings();
					})
			);

		// ──── Agent 预设 ────
		containerEl.createEl("h3", { text: "Agent 预设" });

		new Setting(containerEl)
			.setName("默认模式")
			.setDesc("面板首次打开时激活的模式")
			.addDropdown((dropdown) =>
				dropdown
					.addOption(Mode.Chat, "聊天（只读）")
					.addOption(Mode.Butler, "管家（vault 操作）")
					.addOption(Mode.Creator, "创造（插件生成）")
					.setValue(this.plugin.settings.defaultMode)
					.onChange(async (value) => {
						this.plugin.settings.defaultMode = value as Mode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("自定义 Agent 目录")
			.setDesc("自定义 Agent 配置的 vault 相对路径")
			.addText((text) =>
				text
					.setPlaceholder("")
					.setValue(this.plugin.settings.customAgentDir)
					.onChange(async (value) => {
						this.plugin.settings.customAgentDir = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("聊天模式系统提示词")
			.addTextArea((text) => {
				text
					.setPlaceholder("聊天模式系统提示词...")
					.setValue(this.plugin.settings.chatSystemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.chatSystemPrompt = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 5;
			});

		new Setting(containerEl)
			.setName("管家模式系统提示词")
			.addTextArea((text) => {
				text
					.setPlaceholder("管家模式系统提示词...")
					.setValue(this.plugin.settings.butlerSystemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.butlerSystemPrompt = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 5;
			});

		new Setting(containerEl)
			.setName("创造模式系统提示词")
			.addTextArea((text) => {
				text
					.setPlaceholder("创造模式系统提示词...")
					.setValue(this.plugin.settings.creatorSystemPrompt)
					.onChange(async (value) => {
						this.plugin.settings.creatorSystemPrompt = value;
						await this.plugin.saveSettings();
					});
				text.inputEl.rows = 5;
			});

		// ──── 上下文 ────
		containerEl.createEl("h3", { text: "上下文" });

		new Setting(containerEl)
			.setName("最大上下文长度")
			.setDesc("每条消息注入的最大字符数")
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
			.setName("包含 frontmatter")
			.setDesc("注入笔记内容时是否包含 YAML frontmatter")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.includeFrontmatter)
					.onChange(async (value) => {
						this.plugin.settings.includeFrontmatter = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("自动上下文文件")
			.setDesc("始终作为上下文包含的文件路径，逗号分隔")
			.addText((text) =>
				text
					.setPlaceholder("notes/context.md, templates/prompt.md")
					.setValue(this.plugin.settings.autoContextFiles)
					.onChange(async (value) => {
						this.plugin.settings.autoContextFiles = value;
						await this.plugin.saveSettings();
					})
			);

		// ──── 审批 ────
		containerEl.createEl("h3", { text: "审批" });

		new Setting(containerEl)
			.setName("自动批准读操作")
			.setDesc("跳过只读操作（搜索、列表、读取文件）的确认")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoApproveReads)
					.onChange(async (value) => {
						this.plugin.settings.autoApproveReads = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("始终需要确认")
			.setDesc("对所有写操作都要求审批，即使有 git")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.alwaysConfirm)
					.onChange(async (value) => {
						this.plugin.settings.alwaysConfirm = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("危险关键词")
			.setDesc("触发额外确认的关键词，逗号分隔")
			.addText((text) =>
				text
					.setPlaceholder("delete,remove,删除")
					.setValue(this.plugin.settings.dangerKeywords)
					.onChange(async (value) => {
						this.plugin.settings.dangerKeywords = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
