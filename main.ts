import { App, Plugin, TFile, Notice, Modal, Setting, PluginSettingTab, addIcon } from 'obsidian';

interface FindOrphanedImagesSettings {
    imageExtensions: string;
    maxDeleteCount: number;
    showSidebarButton: boolean;
}

const DEFAULT_SETTINGS: FindOrphanedImagesSettings = {
    imageExtensions: 'png, jpg, jpeg, gif, svg, bmp',
    maxDeleteCount: -1,
    showSidebarButton: true,
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
            name: 'Find Orphaned Images',
            callback: () => this.showOptionsModal(),
        });

        // Register the custom icon
        addIcon('find-orphaned-images-icon', `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
                <path d="M14.2647 15.9377L12.5473 14.2346C11.758 13.4519 11.3633 13.0605 10.9089 12.9137C10.5092 12.7845 10.079 12.7845 9.67922 12.9137C9.22485 13.0605 8.83017 13.4519 8.04082 14.2346L4.04193 18.2622M14.2647 15.9377L14.606 15.5991C15.412 14.7999 15.8149 14.4003 16.2773 14.2545C16.6839 14.1262 17.1208 14.1312 17.5244 14.2688C17.9832 14.4253 18.3769 14.834 19.1642 15.6515L20 16.5001M14.2647 15.9377L18.22 19.9628M12 4H7.2C6.07989 4 5.51984 4 5.09202 4.21799C4.7157 4.40973 4.40973 4.71569 4.21799 5.09202C4 5.51984 4 6.0799 4 7.2V16.8C4 17.4466 4 17.9066 4.04193 18.2622M4.04193 18.2622C4.07264 18.5226 4.12583 18.7271 4.21799 18.908C4.40973 19.2843 4.7157 19.5903 5.09202 19.782C5.51984 20 6.07989 20 7.2 20H16.8C17.9201 20 18.4802 20 18.908 19.782C19.2843 19.5903 19.5903 19.2843 19.782 18.908C20 18.4802 20 17.9201 20 16.8V12M16 3L18.5 5.5M18.5 5.5L21 8M18.5 5.5L21 3M18.5 5.5L16 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `);

        // Add CSS to handle icon color dynamically based on the theme
        this.addIconStyle();

        // Add the sidebar button if enabled in settings
        if (this.settings.showSidebarButton) {
            this.addSidebarButton();
        }
    }

    addIconStyle() {
        const style = document.createElement('style');
        style.textContent = `
            .find-orphaned-images-ribbon-icon {
                stroke: currentColor;
            }

            /* Make sure the icon adapts to dark and light modes */
            body.theme-dark .find-orphaned-images-ribbon-icon {
                color: white;
            }
            body.theme-light .find-orphaned-images-ribbon-icon {
                color: black;
            }
        `;
        document.head.appendChild(style);
    }

    addSidebarButton() {
        if (this.ribbonIconEl) return;

        this.ribbonIconEl = this.addRibbonIcon('find-orphaned-images-icon', 'Find Orphaned Images', () => {
            this.showOptionsModal();
        });

        this.ribbonIconEl.addClass('find-orphaned-images-ribbon-icon');
    }

    removeSidebarButton() {
        if (this.ribbonIconEl) {
            this.ribbonIconEl.remove();
            this.ribbonIconEl = null;
        }
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
        this.removeSidebarButton();
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
        contentEl.createEl('h2', { text: 'Create a Report or Delete the Images?' });

        new Setting(contentEl)
            .setName('Embed Images')
            .setDesc('Create a report with embedded images. This will display the images in the note.')
            .addButton(button => button
                .setButtonText('Create')
                .setCta()
                .onClick(() => {
                    this.plugin.findUnlinkedImages(true);
                    this.close();
                }));

        new Setting(contentEl)
            .setName('Text Links')
            .setDesc('Create a report with text links to the images. This will not display the images in the note.')
            .addButton(button => button
                .setButtonText('Create')
                .setCta()
                .onClick(() => {
                    this.plugin.findUnlinkedImages(false);
                    this.close();
                }));

        new Setting(contentEl)
            .setName('Delete Orphaned Images')
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
        containerEl.createEl('h2', { text: 'Find Orphaned Images Settings' });

        new Setting(containerEl)
            .setName('Image Extensions')
            .setDesc('Comma-separated list of image extensions to look for.')
            .addText(text => text
                .setPlaceholder('Enter image extensions')
                .setValue(this.plugin.settings.imageExtensions)
                .onChange(async (value) => {
                    this.plugin.settings.imageExtensions = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Max Delete Count')
            .setDesc('Maximum number of orphaned images to delete (-1 for no limit).')
            .addText(text => text
                .setPlaceholder('-1')
                .setValue(this.plugin.settings.maxDeleteCount.toString())
                .onChange(async (value) => {
                    this.plugin.settings.maxDeleteCount = parseInt(value, 10) || -1;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show Sidebar Button')
            .setDesc('Enable or disable the sidebar button to find orphaned images.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showSidebarButton)
                .onChange(async (value) => {
                    this.plugin.settings.showSidebarButton = value;
                    await this.plugin.saveSettings();

                    if (value) {
                        this.plugin.addSidebarButton();
                    } else {
                        this.plugin.removeSidebarButton();
                    }
                }));
    }
}