import { App, PluginSettingTab, Setting } from "obsidian";
import type DshdianPlugin from "./main";

export interface DshdianSettings {
	harnessPort: number;
	autoStartHarness: boolean;
}

export const DEFAULT_SETTINGS: DshdianSettings = {
	harnessPort: 3180,
	autoStartHarness: false,
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

		containerEl.createEl("h2", { text: "dshdian Settings" });

		new Setting(containerEl)
			.setName("Harness port")
			.setDesc("Port number for the DSH Harness process (default: 3180)")
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
			.setName("Auto-start harness")
			.setDesc("Attempt to start the DSH Harness process when the plugin loads")
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoStartHarness)
					.onChange(async (value) => {
						this.plugin.settings.autoStartHarness = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
