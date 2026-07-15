import { App, TFile, parseLinktext } from 'obsidian';
import type { CanvasData } from 'obsidian/canvas';
import type { FindOrphanedImagesSettings } from './types';
import { extractEmbeds, extractImgSrcs, extractAdmonitionEmbeds } from './parsing';
import { parseFolderList, isInFolder } from './utils';

// Owns all vault/metadata access for finding orphaned images (pure parsing lives in
// ./parsing). `settings` is held by reference — the plugin mutates it in place, so the
// scanner always sees current values.
export class ReferenceScanner {
    constructor(private app: App, private settings: FindOrphanedImagesSettings) {}

    // Images referenced by no note, frontmatter, canvas, <img> tag, or admonition.
    async getOrphanedImages(): Promise<TFile[]> {
        const { vault, metadataCache } = this.app;
        const imageExtensions = this.settings.imageExtensions
            .split(',')
            .map(ext => ext.trim().toLowerCase())
            .filter(ext => ext.length > 0);

        const includeFolders = parseFolderList(this.settings.includeFolders);
        const excludeFolders = parseFolderList(this.settings.excludeFolders);

        const imageFiles = vault.getFiles().filter(file =>
            imageExtensions.includes(file.extension.toLowerCase())
            && (includeFolders.length === 0 || includeFolders.some(dir => isInFolder(file.path, dir)))
            && !excludeFolders.some(dir => isInFolder(file.path, dir)));

        if (imageFiles.length === 0) return []; // nothing to scan for

        // Merge every reference source into one set for O(1) lookups. The canvas and
        // note-body passes overlap; each writes its own set, so no locking is needed.
        const [canvasRefs, noteBodyRefs] = await Promise.all([
            this.collectCanvasReferences(),
            this.collectNoteBodyReferences(),
        ]);

        const referenced = new Set<string>();
        for (const targets of Object.values(metadataCache.resolvedLinks)) {
            for (const targetPath of Object.keys(targets)) {
                referenced.add(targetPath);
            }
        }
        for (const path of this.collectFrontmatterReferences()) referenced.add(path);
        for (const path of canvasRefs) referenced.add(path);
        for (const path of noteBodyRefs) referenced.add(path);

        return imageFiles.filter(image => !referenced.has(image.path));
    }

    // Drops any image whose filename still appears in a note or canvas — a conservative
    // backstop (case-insensitive substring, over-keeps) for references we can't parse.
    // Streams file-by-file against a shrinking candidate set, stopping once it empties.
    async filterBySafetyScan(files: TFile[]): Promise<TFile[]> {
        const { vault } = this.app;
        const textFiles = vault.getFiles()
            .filter(file => file.extension === 'md' || file.extension === 'canvas');

        // Name -> images. Colliding names across folders keep every match (safe direction).
        const remaining = new Map<string, TFile[]>();
        for (const image of files) {
            const key = image.name.toLowerCase();
            const bucket = remaining.get(key);
            if (bucket) bucket.push(image);
            else remaining.set(key, [image]);
        }

        const keep = new Set<TFile>();

        await this.forEachFileContent(textFiles, (_file, content) => {
            const haystack = content.toLowerCase();
            for (const [name, images] of remaining) {
                if (haystack.includes(name)) {
                    for (const image of images) keep.add(image);
                    remaining.delete(name);
                }
            }
            return remaining.size === 0; // nothing left to look for
        });

        return files.filter(image => !keep.has(image));
    }

    // Reads files in parallel batches (bounded memory, overlapped I/O), calling `handle`
    // on each. `handle` returning true stops early.
    private async forEachFileContent(
        files: TFile[],
        handle: (file: TFile, content: string) => boolean | void,
        batchSize = 50,
    ): Promise<void> {
        const { vault } = this.app;
        for (let i = 0; i < files.length; i += batchSize) {
            const batch = files.slice(i, i + batchSize);
            const contents = await Promise.all(batch.map(file =>
                vault.cachedRead(file).catch(error => {
                    console.error(`Failed to read ${file.path}:`, error);
                    return null;
                })));
            for (let j = 0; j < batch.length; j++) {
                const content = contents[j];
                if (content === null) continue;
                if (handle(batch[j], content) === true) return;
            }
        }
    }

    // Canvas references: file nodes, group backgrounds, and embeds in text cards.
    private async collectCanvasReferences(): Promise<Set<string>> {
        const { vault } = this.app;
        const canvasFiles = vault.getFiles().filter(file => file.extension === 'canvas');
        const referenced = new Set<string>();

        await this.forEachFileContent(canvasFiles, (canvasFile, raw) => {
            let data: CanvasData;
            try {
                data = JSON.parse(raw);
            } catch (error) {
                // Malformed canvas: skip rather than risk a false "orphaned".
                console.error(`Failed to parse canvas file ${canvasFile.path}:`, error);
                return;
            }

            const nodes = Array.isArray(data?.nodes) ? data.nodes : [];
            for (const node of nodes) {
                if (node.type === 'file' && typeof node.file === 'string') {
                    referenced.add(node.file); // already a full vault path
                } else if (node.type === 'group' && typeof node.background === 'string') {
                    this.addResolvedRef(referenced, node.background, canvasFile.path);
                } else if (node.type === 'text' && typeof node.text === 'string') {
                    for (const embed of extractEmbeds(node.text)) {
                        this.addResolvedRef(referenced, embed, canvasFile.path);
                    }
                }
            }
        });

        return referenced;
    }

    // Frontmatter wikilinks (e.g. `cover: "[[image.png]]"`), which live outside resolvedLinks.
    private collectFrontmatterReferences(): Set<string> {
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

    // Raw note-text references Obsidian doesn't index: <img> tags and admonition embeds.
    private async collectNoteBodyReferences(): Promise<Set<string>> {
        const referenced = new Set<string>();

        await this.forEachFileContent(this.app.vault.getMarkdownFiles(), (file, content) => {
            for (const src of extractImgSrcs(content)) {
                this.addResolvedRef(referenced, src, file.path);
            }
            for (const embed of extractAdmonitionEmbeds(content)) {
                this.addResolvedRef(referenced, embed, file.path);
            }
        });

        return referenced;
    }

    // Resolves a link/path against the vault (handling shortest-form links) and records it.
    private addResolvedRef(set: Set<string>, linkText: string, sourcePath: string) {
        const { path } = parseLinktext(linkText);
        const dest = this.app.metadataCache.getFirstLinkpathDest(path, sourcePath);
        set.add(dest ? dest.path : path);
    }
}
