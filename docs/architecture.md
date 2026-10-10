# Xiaohongshu Fisher 架构

本文档描述仓库当前实现的模块边界、数据流和安全约束。产品范围见 [phase-1-features.md](./phase-1-features.md)，社区项目与网页接口调研见 [community-api-research.md](./community-api-research.md)。

## 当前范围

扩展提供推荐、发现、搜索结果三个 TreeView，支持按需刷新、分页、打开笔记阅读页和跳转至小红书官方网页。数据由扩展宿主中的 Playwright 页面适配器读取。运行目标分为桌面可见模式和远程无头模式：桌面模式用于直接观察官方登录页，远程模式用于 VS Code Remote SSH、容器等没有图形桌面的扩展宿主。无头模式仍需完成平台行为验证后才进入实现。

当前没有发帖、评论、点赞、收藏、关注、私信等互动功能。扩展不会导入用户日常浏览器的 Cookie，也不会自动处理验证码或访问限制。

## 模块关系

```mermaid
flowchart TB
    Contributions[package.json commands and views] --> Extension[Extension activation and command handlers]
    Extension --> Providers[Three TreeView providers]
    Extension --> App[ContentApplicationService]
    Extension --> Reader[NoteReader]
    Providers <--> App
    Reader --> App
    App --> Source[ContentSource]
    Source --> PageSource[XiaohongshuPageSource]
    PageSource --> Session[BrowserSession]
    Session --> Chromium[Playwright Chromium]
    PageSource --> Normalize[Response normalization]
    Normalize --> Models[FeedItem and NoteDetail]
    Reader --> Security[Reader HTML and message validation]
    Security --> Webview[VS Code WebviewPanel]
```

`ContentSource` 是页面读取与应用服务之间的边界。当前扩展激活时选择 `XiaohongshuPageSource`；`FakeContentSource` 提供虚构数据，可用于开发和测试，不会自动作为生产数据源启用。

## 模块职责

### 扩展宿主与视图

`src/extension.ts` 创建浏览器会话、网页 source、应用服务、阅读器和三个 TreeView provider，并注册命令。视图只展示应用服务提供的状态和条目；命令层负责 VS Code 输入框、Quick Pick、提示消息和系统浏览器跳转。

三个列表分别维护状态。条目包含标题、可选作者和媒体类型；有下一页游标时显示“加载更多”。

### 应用服务

`src/application/content-service.ts` 负责推荐、发现和搜索列表的请求状态、分页游标、取消、重复请求保护、按 ID 去重和错误归一化。刷新成功后替换首屏数据；加载更多成功后合并数据。它不依赖 Playwright，也不实现持久缓存。

### 数据模型与网页 source

`src/models/content.ts` 定义 `FeedItem`、`NoteDetail`、`MediaItem`、分页结果和会话状态等内部模型。`src/sources/content-source.ts` 定义数据源接口。

`src/sources/xiaohongshu-page-source.ts` 使用小红书官方网页作为浏览入口，并等待该页面自身发出的、路径受限的只读 JSON 响应。推荐和发现入口使用首页与发现页；搜索使用搜索结果页；分页在保留的页面会话中滚动后读取下一次响应；详情通过笔记页面读取。响应仅允许官方小红书域名，限制响应大小，并检查状态和响应结构。它不实现独立的私有 API 签名请求。

`src/sources/normalize.ts` 将网页响应转换为内部模型，过滤缺少实体 ID 或结构不匹配的条目，并校验媒体链接为 HTTPS。平台字段名不应泄漏到 TreeView 或 WebView。

### 浏览器会话

`src/session/browser-session.ts` 通过 Playwright 启动独立、持久化的 Chromium 上下文，profile 存放在 VS Code `globalStorageUri` 下的 `browser-profile` 目录。用户通过官方网页自行登录；“清除会话”会关闭上下文并删除该目录。

`BrowserSession` resolves `auto`, `visible`, or `headless` from configuration and the extension host environment before launching the persistent context. Both modes use the same extension-owned profile and page source. Launch failures do not silently switch modes.

`src/session/browser-startup.ts` classifies launch failures into missing runtime, missing system dependencies, display, sandbox, profile lock, permission, or unknown errors. Playwright validates the executable selected for the active mode because headless Chromium uses a separate runtime. Logs contain only the mode, platform, category, and missing library basenames; raw launch arguments and profile paths never leave the classifier. On Linux, the user-triggered runtime installation command includes `--with-deps` and runs in the extension host terminal, where the system package manager may request sudo privileges.

无头模式不把小红书页面嵌进 WebView，也不把 Cookie 发送给前端。登录页仍在 Playwright 页面中运行，扩展只定时检查页面状态，并把官方页面的短时截图作为登录辅助显示在 VS Code WebView 中。二维码过期、扫码失败或出现滑块/二次验证时，扩展停止轮询并提示用户在官方页面完成处理；不实现验证码识别或规避。

### 阅读 WebView

`src/webview/note-reader.ts` 复用阅读面板，向应用服务请求笔记详情，并只把规范化详情传给 WebView。详情读取失败时显示错误和官方网页入口。

`src/webview/reader-security.ts` 转义文本，限制图片为允许的小红书/CDN HTTPS 域名，生成带随机 nonce 的 Content Security Policy，并校验 WebView 消息命令。WebView 不接收 Cookie、浏览器对象或原始平台响应，也不加载远程脚本。

## 主要流程

### 运行模式选择

```mermaid
flowchart TD
    Start[打开登录或读取命令] --> Config{浏览器模式}
    Config -->|visible| Visible[启动可见持久化 Chromium]
    Config -->|headless| Headless[启动无头持久化 Chromium]
    Config -->|auto| Detect{扩展宿主有可用图形环境?}
    Detect -->|是| Visible
    Detect -->|否| Headless
    Visible --> Session[复用扩展 profile]
    Headless --> Session
    Session --> Read[官方页面读取]
    Headless --> LoginUI[扫码登录辅助 WebView]
```

`auto` 只能作为便捷默认值；诊断信息必须显示最终选择的模式。若 Chromium 缺少系统库、沙箱权限或其他启动依赖，应报告具体原因并提供安装说明，不把所有错误都归类为登录失败。

### 远程无头登录

```mermaid
sequenceDiagram
    actor User as 用户
    participant Command as VS Code 命令
    participant Session as BrowserSession
    participant Page as 无头官方登录页
    participant Login as 登录辅助 WebView
    participant Site as 小红书

    User->>Command: 选择“远程登录/打开登录页”
    Command->>Session: 创建 headless 持久化上下文
    Session->>Page: 导航官方登录页
    loop 直到扫码成功、过期或验证失败
        Page-->>Session: 页面状态与二维码区域
        Session->>Login: 发送短时截图、过期时间和状态
        User->>Login: 用手机扫描二维码
        Page->>Site: 官方登录流程
        Session->>Page: 低频检查登录状态
    end
    Page-->>Session: 已登录或需要人工验证
    Session->>Login: 显示结果和下一步
    Session->>Command: 允许用户刷新推荐/搜索
```

二维码辅助视图只接收截图、状态、倒计时和“刷新二维码/关闭/打开官方网页”等固定消息。截图应在内存中短暂保存，登录完成、过期或关闭面板后立即丢弃；不写入工作区、日志或持久化缓存。登录成功后，数据读取继续使用浏览器上下文，WebView 不持有会话材料。

### 刷新列表与翻页

```mermaid
sequenceDiagram
    actor User as 用户
    participant VSCode as VS Code 命令/TreeView
    participant App as ContentApplicationService
    participant Source as XiaohongshuPageSource
    participant Session as BrowserSession
    participant Page as Chromium 页面

    User->>VSCode: 刷新推荐/发现或搜索
    VSCode->>App: 调用对应列表用例
    App->>Source: 请求首屏
    Source->>Session: 打开页面
    Session->>Page: 复用或启动持久化浏览器
    Source->>Page: 导航到官方页面并等待指定只读响应
    Page-->>Source: 页面自身的 JSON 响应
    Source->>Source: 校验并规范化
    Source-->>App: PageResult<FeedItem>
    App-->>VSCode: 发布列表状态
    VSCode-->>User: 更新 TreeView
    User->>VSCode: 加载更多
    VSCode->>App: 使用 nextCursor
    App->>Source: 对同一页面会话滚动并读取下一页
    Source-->>App: 下一页条目
    App-->>VSCode: 去重并更新状态
```

### 打开笔记

```mermaid
sequenceDiagram
    actor User as 用户
    participant Tree as TreeView
    participant Reader as NoteReader
    participant App as ContentApplicationService
    participant Source as XiaohongshuPageSource
    participant Webview as WebviewPanel

    User->>Tree: 选择笔记
    Tree->>Reader: open(FeedItem)
    Reader->>Webview: 显示加载状态
    Reader->>App: 请求 NoteDetail
    App->>Source: getNoteDetail(id, context)
    Source-->>App: 规范化详情或 SourceError
    App-->>Reader: 详情或可诊断错误
    Reader->>Webview: 渲染安全 HTML
    User->>Webview: 重试或打开原网页
    Webview-->>Reader: 经 schema 校验的命令
```

## 状态、失败与资源生命周期

- 每个列表独立保留条目、加载状态、游标和错误；刷新失败不清除已有条目。
- 新搜索会取消旧搜索；分页只在有游标且没有同列表请求时执行。
- 页面访问受限、网络失败、解析失败和详情不可用会转为 `SourceError`，不进行自动重试。
- source 关闭其分页页面；扩展释放时关闭浏览器上下文并中止应用层请求。
- 列表及详情目前不写入持久化缓存；正文和媒体不保存到工作区。

## 隐私与安全边界

- 浏览器 profile 仅属于本扩展，不能读取用户默认浏览器 profile。
- 不在普通设置、日志、WebView 消息或仓库 fixture 中保存 Cookie、签名或账号凭据。
- source 只读取官方页面允许域名和指定路径上的只读响应；访问被限制时停止当前读取。
- 笔记链接和图片链接必须通过协议及域名校验；WebView 使用 CSP、文本转义和消息白名单。
- 不增加验证码处理、指纹伪装、代理轮换、自动互动或发布功能。

## 已知限制与后续决策

远程无头模式是下一步设计目标，尚未在当前代码中实现。进入实现前需要验证：无头 Chromium 在支持的 Linux 发行版中启动；官方登录页在无头环境显示可扫描二维码；扫码后的 profile 能在后续命令中复用；二维码截图不会泄露到日志或其他 WebView；登录失效、二维码过期、滑块和二次验证都有明确状态；推荐、发现、搜索和详情仍能通过正常网页行为读取。

可选的高级方案是用户在本地启动 Chrome 并通过 SSH 隧道暴露 CDP，再由远程扩展使用 Playwright `connectOverCDP` 连接。该方案可复用本地可见登录环境，但端口转发、浏览器生命周期、连接断开和凭证边界复杂，不作为默认路径；扩展不能自动发现或连接用户已有浏览器。

日常依赖、脚本和打包使用 pnpm。核心本地验证为 `pnpm run compile`、`pnpm run lint` 和 `pnpm run test:unit`；完整 VS Code 扩展宿主测试需要可用的图形环境。
