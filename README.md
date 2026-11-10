# Xiaohongshu Fisher

English | [简体中文](./README.zh-CN.md)

Browse and read Xiaohongshu notes in VS Code. The current version provides Home, Explore, and Search Results views, an integrated note reader, and links to open notes in your system browser.

## Account risk warning

**Xiaohongshu issued a risk-control warning during debugging with a real account. The exact cause has not been confirmed.** Using this extension may trigger verification, access restrictions, or account suspension; account safety cannot be guaranteed. Users and developers should proceed carefully, avoid using their primary accounts, and avoid frequent logins or refreshes. If you receive a warning, stop immediately and follow the official instructions. Do not repeatedly retry or attempt to bypass restrictions.

## Usage

1. Open **Xiaohongshu** in the Activity Bar.
2. On first use, select **Scan to Log In** on the sidebar welcome page, or use the login icon in any view's title bar. The login page automatically fetches and displays a QR code. Scan it with the Xiaohongshu app and confirm the login; no separate image editor is needed. By default, the extension starts a dedicated headless Chromium instance in the background.
3. Return to VS Code and select Refresh in the **Home** or **Explore** view's title bar. To search, run **xiaohongshu-fisher: Search Xiaohongshu Notes** from the **Search Results** view.
4. Select a note to open the integrated reader. The reader also offers **Open in Browser**.

If Playwright Chromium is missing, run **Install Playwright Chromium** from the Command Palette. This command starts installation in a VS Code terminal. On Linux, it also installs system dependencies and may require sudo privileges. The extension does not silently download a browser during activation. After installation, reopen the login page or refresh a list.

When a QR code expires, select **Refresh QR Code** on the login page to display a new code in the same place. The code is cleared after a successful login, expiration, an error, or closing the page. Opening login again returns to the existing login page. If a list reports that your session has expired, select **Scan to Log In** directly in that list. Users with an existing session can refresh or search from the welcome page.

The login assistant listens for the official page's QR creation response. The extension host validates the login URL, encodes it as a PNG, and displays it through a restricted in-memory image resource. WebView messages carry only display state and a temporary image address, never QR image bytes, cookies, or raw login parameters. QR codes are not written to the workspace.

When using Remote SSH or a container, check the network used by the remote host or container running the extension; it may differ from your local computer's network. If the official page reports an IP risk on the current network, the extension stops the operation and waits for a manual retry. It does not automatically bypass platform restrictions.

## Data and privacy

- You complete login yourself on Xiaohongshu's official website. The extension does not collect passwords or verification codes.
- Login sessions are stored in a dedicated browser profile under the extension's VS Code global storage directory. The extension does not read your default browser's data or write session data to workspace settings.
- Run **xiaohongshu-fisher: Clear Xiaohongshu Session** to close the browser and delete the extension's saved profile. Running this command before uninstalling the extension is recommended.
- Note bodies are used only in the current reader and are not saved to the workspace or a persistent cache. The extension performs only user-triggered, read-only browsing, searching, and note retrieval.
- Content comes from Xiaohongshu web pages, whose structure and available sections may change. If login verification, access restrictions, or parsing failures occur, check the official message and retry manually later. The extension does not automatically handle verification or bypass access restrictions.

## Requirements and limitations

- Desktop VS Code and Playwright Chromium are required. VS Code Remote SSH and containers are supported, but Chromium system dependencies must be installed and verified separately on each host.
- End-to-end validation with a real Xiaohongshu account has not been completed for this version. Access to Home, Explore, search, and note details depends on current website behavior, login state, and the content visible to your account.
- The mapping of website data to the Explore view still requires verification in a real browser. Changes to the platform's response structure may temporarily make some sections unavailable.
- This extension is a community tool and is not an official Xiaohongshu product. Follow the platform's rules and use your own judgment when deciding how to use it.

## Commands

| Command                                               | Purpose                                                                           |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| xiaohongshu-fisher: Refresh Home                      | Reload the Home feed                                                              |
| xiaohongshu-fisher: Refresh Explore                   | Reload the Explore feed                                                           |
| xiaohongshu-fisher: Search Xiaohongshu Notes          | Enter keywords to search for notes                                                |
| xiaohongshu-fisher: Load More                         | Fetch more items for the current list                                             |
| xiaohongshu-fisher: Open Xiaohongshu QR Login         | Start headless QR login in the VS Code login assistant                            |
| xiaohongshu-fisher: Refresh Xiaohongshu Login QR Code | Request a new official QR code in the login assistant                             |
| xiaohongshu-fisher: Install Playwright Chromium       | Install the browser runtime in a terminal, including system dependencies on Linux |
| xiaohongshu-fisher: Clear Xiaohongshu Session         | Delete the extension's dedicated browser profile                                  |

## Development

Follow the [account risk warning](#account-risk-warning) when developing or debugging. Prefer mock data, and do not use real login sessions in automated tests or CI.

```sh
pnpm install
pnpm run compile
pnpm run lint
pnpm run test:unit
```

The full `pnpm test` command also requires a graphical environment capable of launching VS Code Electron.

The project uses **ESLint** for code quality and readability and **Prettier** for consistent formatting. `pnpm run lint` runs both checks and fails on warnings.

Use `pnpm run format` to format source files and tool and editor configuration. Use `pnpm run lint:fix` to apply available automatic fixes and format files. `pnpm run format:check` checks formatting without changing files.

The workspace recommends the ESLint and Prettier extensions and enables format on save for TypeScript, JavaScript, and JSON. See [AGENTS.md](./AGENTS.md#code-style-and-readability) for code style and comment requirements.

## Packaging and installing a VSIX

Use pnpm to package the extension with the version of `vsce` locked in this repository. After updating the repository, run `pnpm install` again even if dependencies were previously installed, so that the local dependency layout matches the repository configuration.

```sh
pnpm install
pnpm run compile
pnpm run lint
pnpm run test:unit
pnpm run package
```

Packaging automatically compiles the extension and runs `test:package`, which verifies that the Playwright files selected for packaging can load independently in a temporary directory outside the repository. Because `vsce` cannot preserve symlink relationships from pnpm's default dependency layout, this repository uses a flat layout through `nodeLinker: hoisted` in `pnpm-workspace.yaml`. The extracted VSIX must be able to resolve `playwright` and `playwright-core`, so do not package with `--no-dependencies`.

After successful packaging, `xiaohongshu-fisher-0.0.1.vsix` is created in the repository root. Choose **Install from VSIX…** in the VS Code Extensions view, or use the following command to replace an older installation:

```sh
code --install-extension xiaohongshu-fisher-0.0.1.vsix --force
```

Reload the VS Code window after replacing the installation. See the [extension publishing documentation](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) for publishing commands and full requirements.

## Troubleshooting extension activation

If installing the VSIX results in `command 'xiaohongshu-fisher.refreshHomeFeed' not found`, check **Output → Log (Extension Host)** for activation errors. If `playwright` or `playwright-core` cannot be found, reinstall dependencies, package the extension, replace the installed VSIX, and reload the window as described above. These modules are loaded before activation; if they are missing, no commands can be registered. Installing Chromium does not fix this issue.

## Troubleshooting the browser

If headless Chromium cannot start, select **Xiaohongshu Fisher** in the Output panel to inspect the platform, error category, and names of missing shared libraries.

- **Missing system dependencies** (such as `libatk-1.0.so.0`): run **Install Playwright Chromium** from the Command Palette. When developing in this repository, you can also run `pnpm exec playwright install-deps chromium` from the repository directory to install only system dependencies.
- **Missing browser runtime**: run **Install Playwright Chromium** to install the Chromium headless shell used by the extension.
- **Sandbox, directory permissions, or session conflicts**: check host or container permissions based on the error, or close browser or VS Code windows using the same session before retrying.

For Remote SSH and Dev Containers, install dependencies **on the remote host or inside the container running the extension**. Installing them on your local computer will not fix remote startup failures. Linux system dependencies are installed through the system package manager. If you do not have sudo privileges, ask an administrator to install them or include them in the container image.

## Interface language

The extension supports English and Simplified Chinese and follows the VS Code display language automatically. Run **Configure Display Language** in VS Code to switch languages, then restart when prompted. Unsupported languages and missing translations fall back to English. The extension does not provide a separate language setting.

Commands, settings, sidebar views, QR login controls, and reader controls are localized. Xiaohongshu notes, nicknames, and official page content remain in their original language. Diagnostic logs in the `Xiaohongshu Fisher` output channel are always in English.

## License

This project is licensed under the [Apache License 2.0](./LICENSE).
