import type { TFile } from 'obsidian';
import { formatBytes, totalSize } from './utils';

// Report body: summary line, then images grouped by folder with sizes. Uses wikilinks
// (![[ ]] / [[ ]]) so special chars in filenames resolve without URL-encoding. Pure.
export function buildReport(images: TFile[], embedImages: boolean): string {
    const byFolder = new Map<string, TFile[]>();
    for (const image of images) {
        const folder = image.parent?.path ?? '/';
        const bucket = byFolder.get(folder);
        if (bucket) bucket.push(image);
        else byFolder.set(folder, [image]);
    }
    const folders = [...byFolder.keys()].sort((a, b) => a.localeCompare(b));

    const total = formatBytes(totalSize(images));
    const lines = [
        '# Orphaned Images',
        '',
        `These ${images.length} image${images.length === 1 ? ' is' : 's are'} not linked in any note — ${total} reclaimable.`,
    ];

    for (const folder of folders) {
        const bucket = byFolder.get(folder)!;
        const label = folder === '/' ? '(vault root)' : folder;
        const folderSize = formatBytes(totalSize(bucket));
        lines.push('', `## ${label} — ${bucket.length} image${bucket.length === 1 ? '' : 's'}, ${folderSize}`, '');
        for (const image of bucket) {
            const link = embedImages ? `![[${image.path}]]` : `[[${image.path}]]`;
            lines.push(`- ${link} — ${formatBytes(image.stat.size)}`);
        }
    }

    return lines.join('\n');
}
