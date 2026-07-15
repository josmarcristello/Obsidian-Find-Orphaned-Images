export interface FindOrphanedImagesSettings {
    imageExtensions: string;
    includeFolders: string;
    excludeFolders: string;
    reportFolder: string;
    maxDeleteCount: number;
    moveToTrash: boolean;
    safetyTextScan: boolean;
    showRibbonIcon: boolean;
}

export const DEFAULT_SETTINGS: FindOrphanedImagesSettings = {
    imageExtensions: 'png, jpg, jpeg, gif, svg, bmp, webp, avif',
    includeFolders: '',
    excludeFolders: '',
    reportFolder: '', // Empty = vault root
    maxDeleteCount: -1,
    moveToTrash: true, // Safer, recoverable default
    safetyTextScan: true, // Conservative backstop before deletion
    showRibbonIcon: false,
};
