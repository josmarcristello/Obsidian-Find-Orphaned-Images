<h1 align="center">Find Orphaned Images Plugin for Obsidian</h1>

<p align="center">Utility add-on for <a href="https://obsidian.md/">Obsidian</a> knowledge base.</p>
<p align="center">*Keep your Obsidian vaults tidy with the Find Orphaned Images plugin!*</p>

---
![Obsidian Plugin](https://img.shields.io/badge/Obsidian-Plugin-blueviolet)
![GitHub release (latest by date including pre-releases)](https://img.shields.io/github/v/release/josmarcristello/obsidian-find-orphaned-images)
[![Create Release](https://github.com/josmarcristello/Obsidian-Find-Orphaned-Images/actions/workflows/release.yml/badge.svg)](https://github.com/josmarcristello/Obsidian-Find-Orphaned-Images/actions/workflows/release.yml)


**Find Orphaned Images** is an Obsidian plugin designed to help you keep your vault clean and organized by identifying and managing images that are not linked anywhere in your notes. With this plugin, you can:

1) Generate a note with a report of all the orphaned (not linked) images in your vault.
2) Delete all the orphaned images in your vault.

## Features

- **Identify Orphaned Images**: Scan your vault to find images that are not linked in any note.
- **Generate Reports**: Create a report listing all orphaned images, with options to display images directly or link to them.
- **Delete Orphaned Images**: Remove orphaned images.
- **Customizable Settings**: Define which image extensions to look for and set a maximum number of images to delete.
- **Sidebar Button**: Access the plugin's features using the sidebar button or with the slash command.

## Installation

1. **Download the Plugin**: You can download the latest release from the [GitHub Releases](https://github.com/yourusername/find-orphaned-images/releases) page.

2. **Extract the Files**: Extract the downloaded zip file and copy the files into your Obsidian vault's plugins directory: `.obsidian/plugins/find-orphaned-images/`.

3. **Enable the Plugin**: In Obsidian, go to Settings -> Community plugins, disable safe mode if it's enabled, and then search for "Find Orphaned Images". Enable it to start using the plugin.

4. **Configure Settings**: Go to Settings -> Find or Delete Orphaned Images to configure your preferences.

## Usage

### 1. Using the Sidebar Button

- **Enable Sidebar Button**: Ensure the sidebar button is enabled in the plugin settings.
- **Click the Button**: Click the button in the sidebar to open the options modal. From here, you can choose to create a report, view images, or delete orphaned images.

### 2. Running Commands

You can also access the plugin's features via commands:

- **Find Orphaned Images**: Use the Command Palette (`Ctrl+P` or `Cmd+P`) and type `Find Orphaned Images` to open the options modal. Alternativelly, use the slash command.

### 3. Settings

- **Image Extensions**: Specify which image file extensions to search for. Default: `png, jpg, jpeg, gif, svg, bmp`.
- **Max Delete Count**: Set a limit on how many images can be deleted in one operation. Use `-1` for no limit.
- **Show Sidebar Button**: Toggle the sidebar button on or off for quick access to the plugin's features.

## Screenshots
### Modal Options
![Modal](screenshots/Modal-Options.png)

### Configuration Options
![Configuration-Options](screenshots/Configuration-Options.png)

## Contributing

Contributions are welcome! If you have suggestions for new features or find a bug, please open an issue or submit a pull request.

1. **Fork the Repository**: Click the "Fork" button at the top right of this page to fork this repository.

2. **Clone Your Fork**: Use the command `git clone https://github.com/yourusername/find-orphaned-images.git` to clone your forked repository.

3. **Create a Branch**: Use `git checkout -b your-feature-branch` to create a branch for your feature or bug fix.

4. **Make Changes**: Make your changes and commit them with a descriptive message.

5. **Push to Your Fork**: Use `git push origin your-feature-branch` to push your changes.

6. **Open a Pull Request**: Navigate to your fork on GitHub and click the "New pull request" button.

## License

This project is licensed under the GPL-3. See the [LICENSE](LICENSE) file for more information.

## Acknowledgements
- Thanks to the [Obsidian Community](https://forum.obsidian.md/) for their support and feedback.
- Inspired by the need to keep vaults organized and efficient.

---
