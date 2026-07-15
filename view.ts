import { ItemView, WorkspaceLeaf, TFile, setIcon } from 'obsidian';
import type FindOrphanedImagesPlugin from './main';
import { formatBytes, totalSize } from './utils';

export const ORPHAN_VIEW_TYPE = 'find-orphaned-images-view';

type SortKey = 'size' | 'path';

// Review panel: lists orphaned images with thumbnails and deletes a selected subset.
export class OrphanedImagesView extends ItemView {
    private plugin: FindOrphanedImagesPlugin;
    private orphans: TFile[] = [];
    private selected = new Set<string>(); // selected image paths
    private sortKey: SortKey = 'size';
    private scanning = false;
    private deleteBarEl: HTMLElement | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: FindOrphanedImagesPlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return ORPHAN_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Orphaned images';
    }

    getIcon(): string {
        return 'image';
    }

    async onOpen() {
        await this.refresh();
    }

    async onClose() {
        this.selected.clear();
    }

    // Re-scans and re-renders. Called on open and after deletions.
    async refresh() {
        this.scanning = true;
        this.render();
        try {
            this.orphans = await this.plugin.getOrphanedImages();
        } catch (error) {
            console.error('Failed to scan for orphaned images:', error);
            this.orphans = [];
        }
        // Drop selections that are no longer orphaned.
        const present = new Set(this.orphans.map(f => f.path));
        for (const path of [...this.selected]) {
            if (!present.has(path)) this.selected.delete(path);
        }
        this.scanning = false;
        this.render();
    }

    private sortedOrphans(): TFile[] {
        const orphans = [...this.orphans];
        if (this.sortKey === 'size') {
            orphans.sort((a, b) => b.stat.size - a.stat.size || a.path.localeCompare(b.path));
        } else {
            orphans.sort((a, b) => a.path.localeCompare(b.path));
        }
        return orphans;
    }

    private render() {
        const root = this.contentEl;
        root.empty();
        this.deleteBarEl = null; // detached by empty(); renderHeader re-creates it
        root.addClass('orphaned-images-view');

        if (this.scanning) {
            root.createEl('p', { cls: 'oiv-status', text: 'Scanning vault…' });
            return;
        }

        this.renderHeader(root);

        if (this.orphans.length === 0) {
            root.createEl('p', { cls: 'oiv-status', text: 'All images are linked — nothing to clean up.' });
            return;
        }

        this.renderList(root);
    }

    private renderHeader(root: HTMLElement) {
        const header = root.createDiv({ cls: 'oiv-header' });

        const count = this.orphans.length;
        const size = formatBytes(totalSize(this.orphans));
        header.createDiv({
            cls: 'oiv-summary',
            text: count === 0
                ? 'No orphaned images'
                : `${count} orphaned image${count === 1 ? '' : 's'} · ${size}`,
        });

        const actions = header.createDiv({ cls: 'oiv-actions' });

        this.iconButton(actions, 'refresh-cw', 'Rescan vault', () => this.refresh());

        if (this.orphans.length > 0) {
            const sortLabel = this.sortKey === 'size' ? 'Sort: size' : 'Sort: name';
            const sortBtn = actions.createEl('button', { cls: 'oiv-btn', text: sortLabel });
            sortBtn.addEventListener('click', () => {
                this.sortKey = this.sortKey === 'size' ? 'path' : 'size';
                this.render();
            });

            const allBtn = actions.createEl('button', { cls: 'oiv-btn', text: 'Select all' });
            allBtn.addEventListener('click', () => {
                for (const orphan of this.orphans) this.selected.add(orphan.path);
                this.render();
            });

            const noneBtn = actions.createEl('button', { cls: 'oiv-btn', text: 'Select none' });
            noneBtn.addEventListener('click', () => {
                this.selected.clear();
                this.render();
            });
        }

        // Rebuilt on its own so a checkbox toggle doesn't re-render (and re-scroll) the list.
        this.deleteBarEl = header.createDiv({ cls: 'oiv-delete-bar' });
        this.updateDeleteBar();
    }

    private updateDeleteBar() {
        const bar = this.deleteBarEl;
        if (!bar) return;
        bar.empty();

        const selectedFiles = this.orphans.filter(f => this.selected.has(f.path));
        const deleteBtn = bar.createEl('button', { cls: 'oiv-btn mod-warning' });
        if (selectedFiles.length === 0) {
            deleteBtn.setText('Delete selected');
            deleteBtn.disabled = true;
        } else {
            deleteBtn.setText(`Delete ${selectedFiles.length} selected (${formatBytes(totalSize(selectedFiles))})`);
            deleteBtn.addEventListener('click', () => {
                // Confirm + safety-scan + delete; the panel refreshes once it completes.
                this.plugin.deleteOrphanedImages(selectedFiles);
            });
        }
    }

    private renderList(root: HTMLElement) {
        const list = root.createDiv({ cls: 'oiv-list' });

        for (const image of this.sortedOrphans()) {
            const item = list.createDiv({ cls: 'oiv-item' });

            const checkbox = item.createEl('input', { type: 'checkbox', cls: 'oiv-check' });
            checkbox.checked = this.selected.has(image.path);
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) this.selected.add(image.path);
                else this.selected.delete(image.path);
                this.updateDeleteBar();
            });

            this.renderThumb(item, image);

            const meta = item.createDiv({ cls: 'oiv-meta' });
            const pathEl = meta.createDiv({ cls: 'oiv-path', text: image.path });
            pathEl.setAttribute('title', image.path);
            pathEl.addEventListener('click', () => {
                this.app.workspace.getLeaf(true).openFile(image);
            });
            meta.createDiv({ cls: 'oiv-size', text: formatBytes(image.stat.size) });
        }
    }

    private renderThumb(item: HTMLElement, image: TFile) {
        const thumb = item.createDiv({ cls: 'oiv-thumb' });
        const img = thumb.createEl('img', { cls: 'oiv-thumb-img' });
        img.loading = 'lazy';
        img.src = this.app.vault.getResourcePath(image);
        img.alt = image.name;
        // Undecodable formats fall back to an extension badge.
        img.addEventListener('error', () => {
            img.remove();
            thumb.createDiv({ cls: 'oiv-thumb-fallback', text: image.extension.toUpperCase() });
        });
        thumb.addEventListener('click', () => {
            this.app.workspace.getLeaf(true).openFile(image);
        });
    }

    private iconButton(parent: HTMLElement, icon: string, tooltip: string, onClick: () => void) {
        const btn = parent.createEl('button', { cls: 'oiv-btn oiv-btn-icon' });
        setIcon(btn, icon);
        btn.setAttribute('aria-label', tooltip);
        btn.addEventListener('click', onClick);
        return btn;
    }
}
