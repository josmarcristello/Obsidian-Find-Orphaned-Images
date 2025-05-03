import { App, Plugin, TFile, Notice, Modal, Setting, PluginSettingTab } from 'obsidian';

interface FindOrphanedImagesSettings {
    imageExtensions: string;
    maxDeleteCount: number;
    moveToTrash: boolean;
    showRibbonIcon: boolean; // New setting
}

const DEFAULT_SETTINGS: FindOrphanedImagesSettings = {
    imageExtensions: 'png, jpg, jpeg, gif, svg, bmp',
    maxDeleteCount: -1,
    moveToTrash: false,
    showRibbonIcon: false, // Default to false
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
    
        // Add the ribbon icon only if enabled in settings
        if (this.settings.showRibbonIcon) {
            this.addIconToRibbon();
        }
    }
    
    // Method to add the ribbon icon with a proper icon
    addIconToRibbon() {
        // Using 'image' which is a standard Obsidian icon
        this.ribbonIconEl = this.addRibbonIcon('image', 'Find orphaned images', () => {
            this.showOptionsModal();
        });
    }

    showOptionsModal() {
        const modal = new ImageOptionsModal(this.app, this);
        modal.open();
    }

    // Helper function to check if an image is referenced in Canvas files
    async isImageInCanvasFiles(imagePath: string): Promise<boolean> {
        const { vault } = this.app;
        const allFiles = vault.getFiles();
        const canvasFiles = allFiles.filter(file => file.extension === 'canvas');
        
        // Create variations of the path to check for (different formats that might be used)
        const pathToCheck = imagePath;
        const pathVariations = [
            pathToCheck,
            pathToCheck.replace(/^\//, ''), // Without leading slash
            pathToCheck.replace(/ /g, '%20'), // URL encoded spaces
            this.encodeImagePath(pathToCheck) // Using our own encoding method
        ];
        
        // Extract just the filename for additional checking
        const fileName = pathToCheck.split('/').pop() || '';
        pathVariations.push(fileName);
        
        console.log(`Checking if image is in canvas files: ${imagePath}`);
        console.log(`Path variations:`, pathVariations);
        
        for (const canvasFile of canvasFiles) {
            try {
                const canvasContent = await vault.read(canvasFile);
                console.log(`Checking canvas file: ${canvasFile.path}`);
                
                // Simply check if the canvas content contains any of our path variations
                // This is more robust than trying to parse the exact structure
                for (const pathVariation of pathVariations) {
                    if (canvasContent.includes(pathVariation)) {
                        console.log(`Found match for ${pathVariation} in ${canvasFile.path}`);
                        return true;
                    }
                }
                
                // Also try parsing the JSON for a more structured approach if the simple check didn't work
                try {
                    const canvasData = JSON.parse(canvasContent);
                    console.log(`Canvas structure for ${canvasFile.path}:`, 
                        Object.keys(canvasData));
                    
                    // If nodes exist, check them
                    if (canvasData.nodes && Array.isArray(canvasData.nodes)) {
                        console.log(`Canvas has ${canvasData.nodes.length} nodes`);
                        
                        // Examine a sample node to understand structure if available
                        if (canvasData.nodes.length > 0) {
                            console.log(`Sample node structure:`, 
                                Object.keys(canvasData.nodes[0]));
                        }
                        
                        // Check each node for image references in different possible properties
                        for (const node of canvasData.nodes) {
                            // Check all string properties in the node for our path variations
                            for (const [key, value] of Object.entries(node)) {
                                if (typeof value === 'string') {
                                    for (const pathVariation of pathVariations) {
                                        if (value.includes(pathVariation)) {
                                            console.log(`Found match in node.${key} for ${pathVariation}`);
                                            return true;
                                        }
                                    }
                                }
                            }
                            
                            // Check if the node itself is a file or image
                            if (node.type === 'file' || node.type === 'image' || node.type === 'media') {
                                if (node.file) {
                                    for (const pathVariation of pathVariations) {
                                        if (node.file.includes(pathVariation)) {
                                            console.log(`Found match in node.file: ${node.file}`);
                                            return true;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    
                    // If we have edges, check them too (they might contain file references)
                    if (canvasData.edges && Array.isArray(canvasData.edges)) {
                        for (const edge of canvasData.edges) {
                            const edgeStr = JSON.stringify(edge);
                            for (const pathVariation of pathVariations) {
                                if (edgeStr.includes(pathVariation)) {
                                    console.log(`Found match in edge: ${pathVariation}`);
                                    return true;
                                }
                            }
                        }
                    }
                } catch (jsonError) {
                    console.error(`Error parsing canvas file JSON for ${canvasFile.path}:`, jsonError);
                    // Continue to the next file even if there's a JSON parsing error
                }
            } catch (error) {
                console.error(`Failed to read canvas file ${canvasFile.path}:`, error);
                continue;
            }
        }
        
        console.log(`No canvas references found for ${imagePath}`);
        return false;
    }

    async findUnlinkedImages(embedImages: boolean) {
        const { vault, metadataCache } = this.app;
        const imageExtensions = this.settings.imageExtensions.split(',').map(ext => ext.trim());
        const allFiles = vault.getFiles();
        const imageFiles = allFiles.filter(file => imageExtensions.includes(file.extension));
        const unlinkedImages: string[] = [];

        for (const image of imageFiles) {
            const imagePath = image.path;
            let isLinked = false;

            // Check if image is linked in regular notes
            for (const [, links] of Object.entries(metadataCache.resolvedLinks)) {
                if (links[imagePath]) {
                    isLinked = true;
                    break;
                }
            }

            // If not linked in regular notes, check Canvas files
            if (!isLinked) {
                isLinked = await this.isImageInCanvasFiles(imagePath);
            }

            if (!isLinked) {
                unlinkedImages.push(imagePath);
            }
        }

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
    
        for (const image of imageFiles) {
            const imagePath = image.path;
            let isLinked = false;
    
            // Check if image is linked in regular notes
            for (const [, links] of Object.entries(metadataCache.resolvedLinks)) {
                if (links[imagePath]) {
                    isLinked = true;
                    break;
                }
            }
    
            // If not linked in regular notes, check Canvas files
            if (!isLinked) {
                isLinked = await this.isImageInCanvasFiles(imagePath);
            }
    
            if (!isLinked) {
                unlinkedImages.push(imagePath);
            }
        }
    
        let deleteCount = 0;
        for (const imagePath of unlinkedImages) {
            if (this.settings.maxDeleteCount !== -1 && deleteCount >= this.settings.maxDeleteCount) break;
    
            try {
                const fileToDelete = vault.getAbstractFileByPath(imagePath);
                if (fileToDelete instanceof TFile) {
                    if (this.settings.moveToTrash) {
                        // Move to system trash (if supported)
                        await vault.trash(fileToDelete, true);
                        new Notice(`Moved orphaned image to trash: ${imagePath}`);
                    } else {
                        // Permanently delete
                        await vault.delete(fileToDelete);
                        new Notice(`Deleted orphaned image: ${imagePath}`);
                    }
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
        
        // --- Add the "Move to Trash" toggle ---
        new Setting(containerEl)
            .setName('Move to Trash')
            .setDesc('If enabled, orphaned images will be moved to the system trash instead of deleted.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.moveToTrash)
                .onChange(async (value) => {
                    this.plugin.settings.moveToTrash = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Show Ribbon Icon')
            .setDesc('If enabled, a ribbon icon will be added to the left sidebar.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.showRibbonIcon)
                .onChange(async (value) => {
                    this.plugin.settings.showRibbonIcon = value;
                    
                    // Remove the existing ribbon icon if it exists
                    if (this.plugin.ribbonIconEl) {
                        this.plugin.ribbonIconEl.remove();
                        this.plugin.ribbonIconEl = null;
                    }
                    
                    // Add the ribbon icon if the setting is enabled
                    if (value) {
                        this.plugin.addIconToRibbon();
                    }
                    
                    await this.plugin.saveSettings();
                }));
    }
}