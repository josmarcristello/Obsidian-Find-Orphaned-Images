import { Plugin, TFile, TFolder, Notice, WorkspaceLeaf, normalizePath } from 'obsidian';
import { FindOrphanedImagesSettings, DEFAULT_SETTINGS } from './types';
import { ReferenceScanner } from './reference-scanner';
import { ImageOptionsModal, ConfirmDeleteModal } from './modals';
import { FindOrphanedImagesSettingTab } from './settings';
import { OrphanedImagesView, ORPHAN_VIEW_TYPE } from './view';
import { buildReport } from './report';
import { formatBytes, totalSize } from './utils';

export default class FindOrphanedImagesPlugin extends Plugin {
    settings!: FindOrphanedImagesSettings;
    scanner!: ReferenceScanner;
    ribbonIconEl: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();
        this.scanner = new ReferenceScanner(this.app, this.settings);

        this.addSettingTab(new FindOrphanedImagesSettingTab(this.app, this));

        this.registerView(ORPHAN_VIEW_TYPE, leaf => new OrphanedImagesView(leaf, this));

        this.addCommand({
            id: 'find-orphaned-images',
            name: 'Find or delete orphaned images',
            callback: () => this.showOptionsModal(),
        });

        this.addCommand({
            id: 'open-orphaned-images-panel',
            name: 'Open orphaned images panel',
            callback: () => this.activateView(),
        });

        if (this.settings.showRibbonIcon) {
            this.addIconToRibbon();
        }
    }

    addIconToRibbon() {
        this.ribbonIconEl = this.addRibbonIcon('image', 'Find orphaned images', () => {
            this.activateView();
        });
    }

    showOptionsModal() {
        new ImageOptionsModal(this.app, this).open();
    }

    // Opens or reveals the review panel in the right sidebar.
    async activateView() {
        const { workspace } = this.app;
        const existing = workspace.getLeavesOfType(ORPHAN_VIEW_TYPE);
        let leaf: WorkspaceLeaf | null = existing[0] ?? null;

        if (!leaf) {
            leaf = workspace.getRightLeaf(false);
            await leaf?.setViewState({ type: ORPHAN_VIEW_TYPE, active: true });
        }
        if (leaf) workspace.revealLeaf(leaf);
    }

    // Re-scans any open review panels after the vault changes.
    refreshOrphanViews() {
        for (const leaf of this.app.workspace.getLeavesOfType(ORPHAN_VIEW_TYPE)) {
            const view = leaf.view;
            if (view instanceof OrphanedImagesView) void view.refresh();
        }
    }

    getOrphanedImages(): Promise<TFile[]> {
        return this.scanner.getOrphanedImages();
    }

    // `orphans` lets a caller that already scanned (e.g. the modal) skip a second pass.
    async findUnlinkedImages(embedImages: boolean, orphans?: TFile[]) {
        const orphanedImages = orphans ?? await this.getOrphanedImages();

        if (orphanedImages.length > 0) {
            await this.createOrUpdateUnlinkedImagesNote(orphanedImages, embedImages);
            const size = formatBytes(totalSize(orphanedImages));
            new Notice(`Found ${orphanedImages.length} orphaned image${orphanedImages.length === 1 ? '' : 's'} (${size}). Report created or updated.`);
        } else {
            new Notice("All images are linked!");
        }
    }

    async deleteOrphanedImages(orphans?: TFile[]) {
        const orphanedImages = orphans ?? await this.getOrphanedImages();

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

        // Backstop for references we can't parse (see ReferenceScanner.filterBySafetyScan).
        if (this.settings.safetyTextScan) {
            const before = filesToDelete.length;
            filesToDelete = await this.scanner.filterBySafetyScan(filesToDelete);
            const skipped = before - filesToDelete.length;
            if (skipped > 0) {
                new Notice(`Safety scan kept ${skipped} image${skipped === 1 ? '' : 's'} whose name still appears in a note or canvas.`);
            }
            if (filesToDelete.length === 0) {
                new Notice("Safety scan found a possible reference to every candidate; nothing was deleted.");
                return;
            }
        }

        new ConfirmDeleteModal(
            this.app,
            filesToDelete.map(f => f.path),
            formatBytes(totalSize(filesToDelete)),
            this.settings.moveToTrash,
            () => this.performDeletion(filesToDelete),
        ).open();
    }

    async performDeletion(files: TFile[]) {
        let successCount = 0;
        let freedBytes = 0;

        for (const file of files) {
            try {
                const size = file.stat.size; // read before the file is gone
                if (this.settings.moveToTrash) {
                    // Respects the user's "Deleted files" preference.
                    await this.app.fileManager.trashFile(file);
                } else {
                    await this.app.vault.delete(file);
                }
                successCount++;
                freedBytes += size;
            } catch (error) {
                console.error(`Failed to delete orphaned image: ${file.path}`, error);
            }
        }

        if (successCount > 0) {
            const action = this.settings.moveToTrash ? 'Moved to trash' : 'Deleted';
            new Notice(`${action} ${successCount} orphaned image${successCount === 1 ? '' : 's'} (${formatBytes(freedBytes)} freed).`);
        }
        if (successCount < files.length) {
            new Notice(`Failed to delete ${files.length - successCount} image(s). See console for details.`);
        }

        this.refreshOrphanViews();
    }

    async createOrUpdateUnlinkedImagesNote(images: TFile[], embedImages: boolean) {
        const { vault } = this.app;
        const noteContent = buildReport(images, embedImages);

        const noteName = "Orphaned Images Report.md";
        const folder = this.settings.reportFolder.trim().replace(/^\/+|\/+$/g, '');
        const notePath = normalizePath(folder ? `${folder}/${noteName}` : noteName);

        try {
            if (folder && !(vault.getAbstractFileByPath(folder) instanceof TFolder)) {
                await vault.createFolder(folder);
            }

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

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
    // No onunload needed: addRibbonIcon() auto-registers its element for removal.
}
