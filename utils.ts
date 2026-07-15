// Pure helpers (no Obsidian dependency), unit-tested directly.

// Anything with an on-disk size (satisfied by Obsidian's TFile).
interface Sized {
    stat: { size: number };
}

export function totalSize(files: readonly Sized[]): number {
    return files.reduce((sum, file) => sum + file.stat.size, 0);
}

// e.g. 90177536 -> "86.0 MB".
export function formatBytes(bytes: number): string {
    if (bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / Math.pow(1024, i);
    return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

// Newline/comma-separated folder list -> normalized, lowercased prefixes.
export function parseFolderList(raw: string): string[] {
    return raw
        .split(/[\r\n,]+/)
        .map(entry => entry.trim().replace(/^\/+|\/+$/g, '').toLowerCase())
        .filter(entry => entry.length > 0);
}

// True if `path` is inside `folder` (the folder itself or any subpath).
// `folder` must already be normalized/lowercased (see parseFolderList).
export function isInFolder(path: string, folder: string): boolean {
    const p = path.toLowerCase();
    return p === folder || p.startsWith(folder + '/');
}
