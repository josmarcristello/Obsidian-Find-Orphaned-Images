import { App, PluginSettingTab, Setting } from 'obsidian';
import type FindOrphanedImagesPlugin from './main';

export class FindOrphanedImagesSettingTab extends PluginSettingTab {
    plugin: FindOrphanedImagesPlugin;

    constructor(app: App, plugin: FindOrphanedImagesPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;

        containerEl.empty();

        new Setting(containerEl).setName('Scanning').setHeading();

        new Setting(containerEl)
            .setName('Image extensions')
            .setDesc('Comma-separated list of image extensions to look for.')
            .addText(text => text
                .setPlaceholder('Enter image extensions')
                .setValue(this.plugin.settings.imageExtensions)
                .onChange(async (value) => {
                    this.plugin.settings.imageExtensions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Include folders')
            .setDesc('One folder path per line. If set, only images inside these folders are scanned. Leave empty to scan the whole vault.')
            .addTextArea(text => text
                .setPlaceholder('e.g. Attachments/Temp')
                .setValue(this.plugin.settings.includeFolders)
                .onChange(async (value) => {
                    this.plugin.settings.includeFolders = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Exclude folders')
            .setDesc('One folder path per line. Images inside these folders are never reported or deleted. Takes precedence over Include folders.')
            .addTextArea(text => text
                .setPlaceholder('e.g. Assets/Keep')
                .setValue(this.plugin.settings.excludeFolders)
                .onChange(async (value) => {
                    this.plugin.settings.excludeFolders = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Report').setHeading();

        new Setting(containerEl)
            .setName('Report folder')
            .setDesc('Folder for the generated "Orphaned Images Report" note. Created if it does not exist. Leave empty to save it in the vault root.')
            .addText(text => text
                .setPlaceholder('e.g. Reports')
                .setValue(this.plugin.settings.reportFolder)
                .onChange(async (value) => {
                    this.plugin.settings.reportFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Deletion').setHeading();

        new Setting(containerEl)
            .setName('Max delete count')
            .setDesc('Maximum number of orphaned images to delete (-1 for no limit, 0 to disable deletion).')
            .addText(text => text
                .setPlaceholder('-1')
                .setValue(this.plugin.settings.maxDeleteCount.toString())
                .onChange(async (value) => {
                    const parsed = parseInt(value, 10);
                    // Preserve 0; clamp below -1 to -1; invalid input falls back to -1.
                    this.plugin.settings.maxDeleteCount = Number.isNaN(parsed) ? -1 : Math.max(-1, parsed);
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Move to trash')
            .setDesc('If enabled, orphaned images are moved to trash (using your configured deletion preference) instead of being permanently deleted.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.moveToTrash)
                .onChange(async (value) => {
                    this.plugin.settings.moveToTrash = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Safety scan before deleting')
            .setDesc('Before deleting, skip any image whose filename still appears in a note or canvas. Guards against references this plugin cannot detect (raw HTML, other plugins, etc.). Recommended.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.safetyTextScan)
                .onChange(async (value) => {
                    this.plugin.settings.safetyTextScan = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Appearance').setHeading();

        new Setting(containerEl)
            .setName('Show ribbon icon')
            .setDesc('If enabled, a ribbon icon will be added to the left sidebar.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showRibbonIcon)
                .onChange(async (value) => {
                    this.plugin.settings.showRibbonIcon = value;

                    if (this.plugin.ribbonIconEl) {
                        this.plugin.ribbonIconEl.remove();
                        this.plugin.ribbonIconEl = null;
                    }
                    if (value) {
                        this.plugin.addIconToRibbon();
                    }

                    await this.plugin.saveSettings();
                }));
    }
}
