import { App, Modal, Setting, TFile } from 'obsidian';
import type FindOrphanedImagesPlugin from './main';
import { formatBytes, totalSize } from './utils';

export class ImageOptionsModal extends Modal {
    plugin: FindOrphanedImagesPlugin;
    private orphans: TFile[] = [];

    constructor(app: App, plugin: FindOrphanedImagesPlugin) {
        super(app);
        this.plugin = plugin;
    }

    async onOpen() {
        const { contentEl } = this;
        this.setTitle('Find orphaned images');

        // Scan up front so the choice is informed and the buttons reuse this result.
        const status = contentEl.createEl('p', { text: 'Scanning vault…' });
        try {
            this.orphans = await this.plugin.getOrphanedImages();
        } catch (error) {
            console.error('Failed to scan for orphaned images:', error);
            status.setText('Scan failed — see the developer console for details.');
            return;
        }
        status.remove();

        if (this.orphans.length === 0) {
            contentEl.createEl('p', { text: 'All images are linked — nothing to clean up.' });
            new Setting(contentEl).addButton(button => button
                .setButtonText('Close')
                .setCta()
                .onClick(() => this.close()));
            return;
        }

        const count = this.orphans.length;
        const size = formatBytes(totalSize(this.orphans));
        this.setTitle(`Found ${count} orphaned image${count === 1 ? '' : 's'} (${size})`);

        new Setting(contentEl)
            .setName('Embed images')
            .setDesc('Create a report with embedded images. This will display the images in the note.')
            .addButton(button => button
                .setButtonText('Create')
                .setCta()
                .onClick(() => {
                    this.plugin.findUnlinkedImages(true, this.orphans);
                    this.close();
                }));

        new Setting(contentEl)
            .setName('Text links')
            .setDesc('Create a report with text links to the images. This will not display the images in the note.')
            .addButton(button => button
                .setButtonText('Create')
                .onClick(() => {
                    this.plugin.findUnlinkedImages(false, this.orphans);
                    this.close();
                }));

        new Setting(contentEl)
            .setName('Delete orphaned images')
            .setDesc('Delete the orphaned images found in the vault, up to the max delete count set in the plugin settings.')
            .addButton(button => button
                .setButtonText('Delete')
                .setWarning()
                .onClick(() => {
                    this.close();
                    this.plugin.deleteOrphanedImages(this.orphans);
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class ConfirmDeleteModal extends Modal {
    private imagePaths: string[];
    private sizeLabel: string;
    private moveToTrash: boolean;
    private onConfirm: () => void;

    constructor(app: App, imagePaths: string[], sizeLabel: string, moveToTrash: boolean, onConfirm: () => void) {
        super(app);
        this.imagePaths = imagePaths;
        this.sizeLabel = sizeLabel;
        this.moveToTrash = moveToTrash;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        const count = this.imagePaths.length;
        const plural = count === 1 ? '' : 's';

        this.setTitle(`Delete ${count} orphaned image${plural}?`);

        contentEl.createEl('p', {
            text: this.moveToTrash
                ? `This will move ${count} image${plural} (${this.sizeLabel}) to trash. You can restore them from your trash if needed.`
                : `This will permanently delete ${count} image${plural} (${this.sizeLabel}). This cannot be undone.`,
        });

        // Capped preview.
        const previewLimit = 10;
        const list = contentEl.createEl('ul');
        for (const path of this.imagePaths.slice(0, previewLimit)) {
            list.createEl('li', { text: path });
        }
        if (count > previewLimit) {
            list.createEl('li', { text: `…and ${count - previewLimit} more.` });
        }

        new Setting(contentEl)
            .addButton(button => button
                .setButtonText('Cancel')
                .onClick(() => this.close()))
            .addButton(button => button
                .setButtonText(this.moveToTrash ? 'Move to trash' : 'Delete')
                .setWarning()
                .onClick(() => {
                    this.close();
                    this.onConfirm();
                }));
    }

    onClose() {
        this.contentEl.empty();
    }
}
