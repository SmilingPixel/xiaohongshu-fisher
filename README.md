# Xiaohongshu Fisher

在 VS Code 中浏览和阅读小红书笔记。当前版本提供推荐、发现、搜索结果视图，以及笔记阅读页和系统浏览器入口。

## 使用

1. 在 Activity Bar 打开“小红书”。
2. 首次使用时运行命令面板中的“打开小红书扫码登录”。扩展始终在后台启动独立的无头 Chromium；在 VS Code 登录辅助页选择“在编辑器中显示二维码”，然后用手机扫码确认。
3. 返回 VS Code，在“推荐”或“发现”视图标题栏选择刷新；在“搜索结果”视图运行“xiaohongshu-fisher: 搜索小红书笔记”。
4. 选择笔记打开内置阅读页。阅读页也提供“在浏览器中打开”入口。

若缺少 Playwright Chromium，运行命令面板中的“安装 Playwright Chromium”。该命令会在 VS Code 终端中启动安装流程；Linux 下同时安装系统依赖，可能需要 sudo 权限，不会在扩展激活时静默下载浏览器。安装完成后重新打开登录页或刷新列表。

扩展使用无头 Chromium；登录辅助页提供临时二维码查看入口，不保存截图，也不会把 Cookie 发送到 WebView。

使用 Remote SSH 或容器时，请检查运行扩展的远程主机或容器所使用的网络；本地电脑的网络可能与其不同。若官方页面提示当前网络存在 IP 风险，扩展会停止本次操作并等待手动重试，不会自动绕过平台限制。

## 数据与隐私

- 登录只在小红书官方网页中由用户自行完成；扩展不收集账号密码或验证码。
- 登录会话保存在 VS Code 扩展全局存储目录下的独立浏览器 profile，不读取系统默认浏览器数据，也不写入工作区设置。
- 使用“xiaohongshu-fisher: 清除小红书会话”关闭浏览器并删除插件保存的 profile。卸载扩展前建议先运行此命令。
- 笔记正文只用于当前阅读页，不保存到工作区或持久缓存。扩展只执行用户触发的只读浏览、搜索和详情读取。
- 页面内容来自小红书网页，网页结构和可读栏目可能变化。遇到登录验证、访问限制或解析失败时，请查看官方提示并稍后手动重试；扩展不会自动处理验证或规避访问限制。

## 运行要求与限制

- 需要桌面版 VS Code 和 Playwright Chromium，支持 VS Code Remote SSH 和容器；不同服务器的 Chromium 系统依赖仍需单独安装和验证。
- 本版本尚未完成真实小红书账号下的端到端验证。推荐、发现、搜索和详情能否读取取决于当前网页行为、登录状态和账号可见内容。
- “发现”视图的网页数据映射仍需真实浏览器验证；若平台页面返回的数据结构变化，相关栏目可能暂不可用。
- 本扩展为社区工具，不代表小红书官方产品。请遵守平台规则并自行判断使用方式。

## 命令

| 命令 | 作用 |
| --- | --- |
| xiaohongshu-fisher: 刷新推荐 | 重新读取推荐列表 |
| xiaohongshu-fisher: 刷新发现 | 重新读取发现列表 |
| xiaohongshu-fisher: 搜索小红书笔记 | 输入关键词搜索 |
| xiaohongshu-fisher: 加载更多 | 继续读取当前列表 |
| xiaohongshu-fisher: 打开小红书扫码登录 | 在 VS Code 登录辅助页启动无头扫码流程 |
| xiaohongshu-fisher: 刷新小红书登录二维码 | 在登录辅助页请求新的官方二维码 |
| xiaohongshu-fisher: 安装 Playwright Chromium | 在终端安装浏览器运行时，Linux 下同时安装系统依赖 |
| xiaohongshu-fisher: 清除小红书会话 | 删除插件专属浏览器 profile |

## 开发

```sh
pnpm install
pnpm run compile
pnpm run lint
pnpm run test:unit
```

完整 `pnpm test` 还需要可启动 VS Code Electron 的图形环境。

## 打包与安装 VSIX

通过 pnpm 使用仓库中已锁定版本的 `vsce` 工具打包。更新仓库后，即使之前已经安装过依赖，也请重新运行 `pnpm install`，使本地依赖布局与仓库配置保持一致。

```sh
pnpm install
pnpm run compile
pnpm run lint
pnpm run test:unit
pnpm run package
```

打包时会自动编译扩展并运行 `test:package`，在仓库外的临时目录中验证待打包的 Playwright 文件能否独立加载。由于 `vsce` 收集依赖时无法保留 pnpm 默认布局中的符号链接关系，仓库通过 `pnpm-workspace.yaml` 的 `nodeLinker: hoisted` 配置使用平铺依赖布局。VSIX 解压后必须能够正常找到 `playwright` 和 `playwright-core`，因此不要使用 `--no-dependencies` 打包。

打包成功后，仓库根目录会生成 `xiaohongshu-fisher-0.0.1.vsix`。可以在 VS Code 扩展视图中选择“从 VSIX 安装…”，或使用以下命令覆盖安装旧版本：

```sh
code --install-extension xiaohongshu-fisher-0.0.1.vsix --force
```

覆盖安装后，请重新加载 VS Code 窗口。发布相关命令和完整要求请参考[扩展发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)。

## 扩展激活故障排查

若安装 VSIX 后出现 `command 'xiaohongshu-fisher.refreshHomeFeed' not found`，请在“输出 → Log (Extension Host)”查看激活错误。若提示找不到 `playwright` 或 `playwright-core`，请按上面的步骤重新安装依赖、打包、覆盖安装 VSIX 并重新加载窗口。扩展在激活前加载这些模块；缺少模块时，所有命令都无法注册，安装 Chromium 不能修复这个问题。

## 浏览器故障排查

若出现“无法启动无头 Chromium”，可在“输出”面板选择 **Xiaohongshu Fisher**，查看平台、错误类别和缺少的动态库名称。

- **缺少系统依赖**（如 `libatk-1.0.so.0`）：运行命令面板中的“安装 Playwright Chromium”。在本仓库开发时，也可在仓库目录执行 `pnpm exec playwright install-deps chromium`，只安装系统依赖。
- **缺少浏览器运行时**：运行“安装 Playwright Chromium”，安装扩展使用的 Chromium headless shell。
- **沙箱、目录权限或会话占用**：根据具体错误检查主机或容器权限，或关闭占用同一会话的浏览器/VS Code 窗口后重试。

Remote SSH、Dev Container 等场景需要在**运行扩展的远程主机或容器内**安装依赖；在本地电脑安装不会修复远程启动失败。Linux 系统依赖通过系统包管理器安装；没有 sudo 权限时，请让管理员安装或将依赖加入容器镜像。
