# Changelog / 更新日志

## [0.0.1] - Unreleased / 未发布

### 新增

- 推荐、发现和搜索结果侧栏视图，支持刷新与分页。
- 持久化的无头 Playwright 会话，通过 VS Code 内的官方二维码辅助流程登录。
- VS Code 内笔记阅读页，以及在系统浏览器打开原笔记的入口。
- 用户可控的浏览器会话清理命令。

### 变更

- 浏览器统一使用无头 Chromium，登录入口统一为扫码辅助页。
- 打开笔记使用内置阅读页，保留用户主动打开的外链；外部浏览器操作不共享扩展会话。
- 清理失效的浏览器模式测试、旧接口测试替身和编译产物。
- 登录二维码改为监听页面创建响应并在扩展宿主中生成 PNG，移除页面元素截图和 base64 传输。

### Added

- Home, Explore, and search result sidebar views with refresh and pagination.
- Persistent headless Playwright sessions with an official QR login assistant inside VS Code.
- An in-editor note reader with an option to open the original note in the system browser.
- A command to clear the extension's saved browser session.

### Changed

- Standardized browser sessions on headless Chromium and login entry points on the QR login assistant.
- Open notes in the built-in reader while retaining user-initiated external links; the system browser does not share the extension's session.
- Removed obsolete browser mode tests, legacy API test doubles, and compiled artifacts.
- Generate login QR codes as PNGs in the extension host from the official page's QR creation response, replacing page element screenshots and base64 transfers.
