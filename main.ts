import { App, Plugin, TFile, Notice, Modal, Setting, PluginSettingTab } from 'obsidian';

interface FindOrphanedImagesSettings {
    imageExtensions: string;
    maxDeleteCount: number;
}

const DEFAULT_SETTINGS: FindOrphanedImagesSettings = {
    imageExtensions: 'png, jpg, jpeg, gif, svg, bmp',
    maxDeleteCount: -1,
};

export default class FindOrphanedImagesPlugin extends Plugin {
    settings: FindOrphanedImagesSettings;
    ribbonIconEl: HTMLElement | null = null;

    async onload() {
        console.log('Loading Find Orphaned Images Plugin');
        await this.loadSettings();
    
        this.addSettingTab(new FindOrphanedImagesSettingTab(this.app, this));
    
        this.addCommand({
            id: 'find-orphaned-images',
            name: 'Find or delete orphaned images',
            callback: () => this.showOptionsModal(),
        });
    
        // Add the ribbon icon
        this.ribbonIconEl = this.addRibbonIcon('find-orphaned-images-icon', 'Find orphaned images', () => {
            this.showOptionsModal();
        });
    }

    showOptionsModal() {
        const modal = new ImageOptionsModal(this.app, this);
        modal.open();
    }

    async findUnlinkedImages(embedImages: boolean) {
        const { vault, metadataCache } = this.app;
        const imageExtensions = this.settings.imageExtensions.split(',').map(ext => ext.trim());
        const allFiles = vault.getFiles();
        const imageFiles = allFiles.filter(file => imageExtensions.includes(file.extension));
        const unlinkedImages: string[] = [];

        imageFiles.forEach(image => {
            const imagePath = image.path;
            let isLinked = false;

            for (const [filePath, links] of Object.entries(metadataCache.resolvedLinks)) {
                if (links[imagePath]) {
                    isLinked = true;
                    break;
                }
            }

            if (!isLinked) {
                unlinkedImages.push(imagePath);
            }
        });

        if (unlinkedImages.length > 0) {
            await this.createOrUpdateUnlinkedImagesNote(unlinkedImages, embedImages);
            new Notice(`Found ${unlinkedImages.length} orphaned images. Note created or updated with details.`);
        } else {
            new Notice("All images are linked!");
        }
    }

    async deleteFirstUnlinkedImage() {
        const { vault, metadataCache } = this.app;
        const imageExtensions = this.settings.imageExtensions.split(',').map(ext => ext.trim());
        const allFiles = vault.getFiles();
        const imageFiles = allFiles.filter(file => imageExtensions.includes(file.extension));
        const unlinkedImages: string[] = [];

        imageFiles.forEach(image => {
            const imagePath = image.path;
            let isLinked = false;

            for (const [filePath, links] of Object.entries(metadataCache.resolvedLinks)) {
                if (links[imagePath]) {
                    isLinked = true;
                    break;
                }
            }

            if (!isLinked) {
                unlinkedImages.push(imagePath);
            }
        });

        let deleteCount = 0;
        for (const imagePath of unlinkedImages) {
            if (this.settings.maxDeleteCount !== -1 && deleteCount >= this.settings.maxDeleteCount) break;

            try {
                const fileToDelete = vault.getAbstractFileByPath(imagePath);
                if (fileToDelete instanceof TFile) {
                    await vault.delete(fileToDelete);
                    new Notice(`Deleted orphaned image: ${imagePath}`);
                    deleteCount++;
                }
            } catch (error) {
                console.error("Failed to delete the image:", error);
                new Notice("Failed to delete the orphaned image.");
            }
        }

        if (deleteCount === 0) {
            new Notice("No orphaned images found to delete.");
        }
    }

    async createOrUpdateUnlinkedImagesNote(unlinkedImages: string[], embedImages: boolean) {
        const { vault } = this.app;
        const noteContent = `# Orphaned Images\n\nThese images are not linked in any note:\n\n` +
            unlinkedImages.map(imagePath => {
                const encodedPath = this.encodeImagePath(imagePath);
                return embedImages ? `- ![](${encodedPath})` : `- [${imagePath}](${encodedPath})`;
            }).join('\n');

        const noteName = "Orphaned Images Report.md";
        const notePath = `${noteName}`;

        try {
            const existingFile = vault.getAbstractFileByPath(notePath);

            if (existingFile instanceof TFile) {
                await vault.modify(existingFile, noteContent);
            } else {
                await vault.create(notePath, noteContent);
            }

            new Notice(`Note "${noteName}" created or updated with orphaned images.`);
            this.app.workspace.openLinkText(notePath, '', true);
        } catch (error) {
            console.error("Failed to create or update note:", error);
            new Notice("Failed to create or update note with orphaned images.");
        }
    }

    encodeImagePath(imagePath: string): string {
        return imagePath.replace(/ /g, '%20');
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    onunload() {
        console.log('Unloading Find Orphaned Images Plugin');
        if (this.ribbonIconEl) {
            this.ribbonIconEl.remove();
        }
    }
}

class ImageOptionsModal extends Modal {
    plugin: FindOrphanedImagesPlugin;

    constructor(app: App, plugin: FindOrphanedImagesPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Create a report or delete the images?' });

        new Setting(contentEl)
            .setName('Embed images')
            .setDesc('Create a report with embedded images. This will display the images in the note.')
            .addButton(button => button
                .setButtonText('Create')
                .setCta()
                .onClick(() => {
                    this.plugin.findUnlinkedImages(true);
                    this.close();
                }));

        new Setting(contentEl)
            .setName('Text links')
            .setDesc('Create a report with text links to the images. This will not display the images in the note.')
            .addButton(button => button
                .setButtonText('Create')
                .setCta()
                .onClick(() => {
                    this.plugin.findUnlinkedImages(false);
                    this.close();
                }));

        new Setting(contentEl)
            .setName('Delete orphaned images')
            .setDesc('Delete the X images found in the vault. X is the max delete count, defined in the settings.')
            .addButton(button => button
                .setButtonText('Delete')
                .setCta()
                .onClick(() => {
                    this.plugin.deleteFirstUnlinkedImage();
                    this.close();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class FindOrphanedImagesSettingTab extends PluginSettingTab {
    plugin: FindOrphanedImagesPlugin;

    constructor(app: App, plugin: FindOrphanedImagesPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
    
        containerEl.empty();
    
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
            .setName('Max delete count')
            .setDesc('Maximum number of orphaned images to delete (-1 for no limit).')
            .addText(text => text
                .setPlaceholder('-1')
                .setValue(this.plugin.settings.maxDeleteCount.toString())
                .onChange(async (value) => {
                    this.plugin.settings.maxDeleteCount = parseInt(value, 10) || -1;
                    await this.plugin.saveSettings();
                }));
    }
}
