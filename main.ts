import { App, Plugin, TFile, Notice, Modal, Setting, PluginSettingTab, parseLinktext } from 'obsidian';
import type { CanvasData } from 'obsidian/canvas';

interface FindOrphanedImagesSettings {
    imageExtensions: string;
    includeFolders: string;
    excludeFolders: string;
    maxDeleteCount: number;
    moveToTrash: boolean;
    safetyTextScan: boolean;
    showRibbonIcon: boolean;
}

const DEFAULT_SETTINGS: FindOrphanedImagesSettings = {
    imageExtensions: 'png, jpg, jpeg, gif, svg, bmp',
    includeFolders: '',
    excludeFolders: '',
    maxDeleteCount: -1,
    moveToTrash: true, // Safer, recoverable default
    safetyTextScan: true, // Conservative backstop before deletion
    showRibbonIcon: false,
};

export default class FindOrphanedImagesPlugin extends Plugin {
    settings!: FindOrphanedImagesSettings;
    ribbonIconEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();
    
        this.addSettingTab(new FindOrphanedImagesSettingTab(this.app, this));
    
        this.addCommand({
            id: 'find-orphaned-images',
            name: 'Find or delete orphaned images',
            callback: () => this.showOptionsModal(),
        });
    
        if (this.settings.showRibbonIcon) {
            this.addIconToRibbon();
        }
    }

    addIconToRibbon() {
        this.ribbonIconEl = this.addRibbonIcon('image', 'Find orphaned images', () => {
            this.showOptionsModal();
        });
    }

    showOptionsModal() {
        const modal = new ImageOptionsModal(this.app, this);
        modal.open();
    }

    // Parses every canvas once and returns the vault paths of the files it references:
    // file nodes, group background images, and image embeds inside text cards.
    async collectCanvasReferences(): Promise<Set<string>> {
        const { vault } = this.app;
        const canvasFiles = vault.getFiles().filter(file => file.extension === 'canvas');
        const referenced = new Set<string>();

        for (const canvasFile of canvasFiles) {
            let data: CanvasData;
            try {
                data = JSON.parse(await vault.read(canvasFile));
            } catch (error) {
                // Unreadable or malformed canvas: skip it rather than risk a false "orphaned".
                console.error(`Failed to parse canvas file ${canvasFile.path}:`, error);
                continue;
            }

            const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
            for (const node of nodes) {
                if (node.type === 'file' && typeof node.file === 'string') {
                    referenced.add(node.file); // already a full vault path
                } else if (node.type === 'group' && typeof node.background === 'string') {
                    this.addResolvedRef(referenced, node.background, canvasFile.path);
                } else if (node.type === 'text' && typeof node.text === 'string') {
                    for (const embed of this.extractEmbeds(node.text)) {
                        this.addResolvedRef(referenced, embed, canvasFile.path);
                    }
                }
            }
        }

        return referenced;
    }

    // Resolves a link/path against the vault (handling shortest-form links) and records it.
    private addResolvedRef(set: Set<string>, linkText: string, sourcePath: string) {
        const { path } = parseLinktext(linkText);
        const dest = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
        set.add(dest ? dest.path : path);
    }

    // Extracts embed targets from canvas text: wiki (![[target]]) and markdown (![](target)).
    private extractEmbeds(text: string): string[] {
        const targets: string[] = [];

        for (const match of text.matchAll(/!\[\[([^\]|#]+)[^\]]*\]\]/g)) {
            targets.push(match[1].trim());
        }
        for (const match of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
            const raw = match[1].trim();
            try {
                targets.push(decodeURIComponent(raw));
            } catch {
                targets.push(raw);
            }
        }

        return targets;
    }

    // Frontmatter wikilinks (e.g. `cover: "[[image.png]]"`), which live outside resolvedLinks.
    collectFrontmatterReferences(): Set<string> {
        const { vault, metadataCache } = this.app;
        const referenced = new Set<string>();

        for (const file of vault.getMarkdownFiles()) {
            const links = metadataCache.getFileCache(file)?.frontmatterLinks;
            for (const link of links ?? []) {
                this.addResolvedRef(referenced, link.link, file.path);
            }
        }

        return referenced;
    }

    // References Obsidian does not index, scanned from raw note text in one pass:
    //  - raw <img src="..."> HTML tags
    //  - embeds inside legacy Admonitions code blocks (```ad-note … ![[image.png]] … ```),
    //    which Obsidian treats as literal code and therefore never resolves.
    async collectNoteBodyReferences(): Promise<Set<string>> {
        const { vault } = this.app;
        const referenced = new Set<string>();

        for (const file of vault.getMarkdownFiles()) {
            let content: string;
            try {
                content = await vault.cachedRead(file);
            } catch (error) {
                console.error(`Failed to read note ${file.path}:`, error);
                continue;
            }

            // Raw <img src="..."> tags (targeted to the src attribute only).
            for (const match of content.matchAll(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)) {
                const src = match[1].trim();
                if (/^[a-z][a-z0-9+.-]*:\/\//i.test(src)) continue; // skip external/absolute URLs
                let path = src;
                try {
                    path = decodeURIComponent(src);
                } catch { /* keep raw */ }
                this.addResolvedRef(referenced, path.replace(/^\.?\//, ''), file.path);
            }

            // Embeds inside Admonitions code blocks. Only `ad-*` fences (which render
            // their embeds) are scanned — ordinary code blocks are left untouched.
            for (const block of content.matchAll(/(`{3,}|~{3,})[ \t]*ad-[\w-]+[^\n]*\n([\s\S]*?)\r?\n\1/gi)) {
                for (const embed of this.extractEmbeds(block[2])) {
                    this.addResolvedRef(referenced, embed, file.path);
                }
            }
        }

        return referenced;
    }

    // Parses a newline/comma-separated folder list into normalized, lowercased prefixes.
    private parseFolderList(raw: string): string[] {
        return raw
            .split(/[\r\n,]+/)
            .map(entry => entry.trim().replace(/^\/+|\/+$/g, '').toLowerCase())
            .filter(entry => entry.length > 0);
    }

    // True if the vault path sits inside the given folder (the folder itself or any subpath).
    private isInFolder(path: string, folder: string): boolean {
        const p = path.toLowerCase();
        return p === folder || p.startsWith(folder + '/');
    }

    // Returns every image not referenced by any note, frontmatter, canvas, raw <img> tag, or admonition.
    async getOrphanedImages(): Promise<TFile[]> {
        const { vault, metadataCache } = this.app;
        const imageExtensions = this.settings.imageExtensions
            .split(',')
            .map(ext => ext.trim().toLowerCase())
            .filter(ext => ext.length > 0);

        const includeFolders = this.parseFolderList(this.settings.includeFolders);
        const excludeFolders = this.parseFolderList(this.settings.excludeFolders);

        const imageFiles = vault.getFiles().filter(file =>
            imageExtensions.includes(file.extension.toLowerCase())
            && (includeFolders.length === 0 || includeFolders.some(dir => this.isInFolder(file.path, dir)))
            && !excludeFolders.some(dir => this.isInFolder(file.path, dir)));

        // No candidates after folder filtering — skip the expensive reference scan.
        if (imageFiles.length === 0) return [];

        // Union every source of references into one set for O(1) lookups.
        const referenced = new Set<string>();
        for (const targets of Object.values(metadataCache.resolvedLinks)) {
            for (const targetPath of Object.keys(targets)) {
                referenced.add(targetPath);
            }
        }
        for (const path of this.collectFrontmatterReferences()) referenced.add(path);
        for (const path of await this.collectCanvasReferences()) referenced.add(path);
        for (const path of await this.collectNoteBodyReferences()) referenced.add(path);

        return imageFiles.filter(image => !referenced.has(image.path));
    }

    async findUnlinkedImages(embedImages: boolean) {
        const orphanedImages = await this.getOrphanedImages();

        if (orphanedImages.length > 0) {
            await this.createOrUpdateUnlinkedImagesNote(orphanedImages.map(f => f.path), embedImages);
            new Notice(`Found ${orphanedImages.length} orphaned images. Note created or updated with details.`);
        } else {
            new Notice("All images are linked!");
        }
    }

    async deleteOrphanedImages() {
        const orphanedImages = await this.getOrphanedImages();

        if (orphanedImages.length === 0) {
            new Notice("No orphaned images found to delete.");
            return;
        }

        // -1 = no limit, 0 = delete nothing, >0 = cap.
        const limit = this.settings.maxDeleteCount;
        let filesToDelete = limit >= 0 ? orphanedImages.slice(0, limit) : orphanedImages;

        if (filesToDelete.length === 0) {
            new Notice("Max delete count is set to 0, so no images were deleted.");
            return;
        }

        // Conservative backstop for references we can't parse (see filterBySafetyScan).
        if (this.settings.safetyTextScan) {
            const before = filesToDelete.length;
            filesToDelete = await this.filterBySafetyScan(filesToDelete);
            const skipped = before - filesToDelete.length;
            if (skipped > 0) {
                new Notice(`Safety scan kept ${skipped} image${skipped === 1 ? '' : 's'} whose name still appears in a note or canvas.`);
            }
            if (filesToDelete.length === 0) {
                new Notice("Safety scan found a possible reference to every candidate; nothing was deleted.");
                return;
            }
        }

        // Confirm before deleting anything.
        new ConfirmDeleteModal(
            this.app,
            filesToDelete.map(f => f.path),
            this.settings.moveToTrash,
            () => this.performDeletion(filesToDelete),
        ).open();
    }

    // Drops any image whose filename still appears anywhere in a note or canvas.
    // Deliberately conservative (substring, so it over-keeps): missing a real reference
    // could delete an in-use image, whereas keeping a true orphan is harmless.
    async filterBySafetyScan(files: TFile[]): Promise<TFile[]> {
        const { vault } = this.app;
        const textFiles = vault.getFiles()
            .filter(file => file.extension === 'md' || file.extension === 'canvas');

        const contents: string[] = [];
        for (const file of textFiles) {
            try {
                contents.push(await vault.cachedRead(file));
            } catch (error) {
                console.error(`Failed to read ${file.path} during safety scan:`, error);
            }
        }

        return files.filter(image =>
            !contents.some(content => content.includes(image.name)));
    }

    async performDeletion(files: TFile[]) {
        let successCount = 0;

        for (const file of files) {
            try {
                if (this.settings.moveToTrash) {
                    // Respects the user's "Deleted files" preference.
                    await this.app.fileManager.trashFile(file);
                } else {
                    await this.app.vault.delete(file);
                }
                successCount++;
            } catch (error) {
                console.error(`Failed to delete orphaned image: ${file.path}`, error);
            }
        }

        if (successCount > 0) {
            const action = this.settings.moveToTrash ? 'Moved to trash' : 'Deleted';
            new Notice(`${action} ${successCount} orphaned image${successCount === 1 ? '' : 's'}.`);
        }
        if (successCount < files.length) {
            new Notice(`Failed to delete ${files.length - successCount} image(s). See console for details.`);
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
        this.setTitle('Create a report or delete the images?');

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
                .onClick(() => {
                    this.plugin.findUnlinkedImages(false);
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
                    this.plugin.deleteOrphanedImages();
                }));
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class ConfirmDeleteModal extends Modal {
    private imagePaths: string[];
    private moveToTrash: boolean;
    private onConfirm: () => void;

    constructor(app: App, imagePaths: string[], moveToTrash: boolean, onConfirm: () => void) {
        super(app);
        this.imagePaths = imagePaths;
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
                ? `This will move ${count} image${plural} to trash. You can restore them from your trash if needed.`
                : `This will permanently delete ${count} image${plural}. This cannot be undone.`,
        });

        // Capped preview of what will be removed.
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