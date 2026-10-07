# 小红书 VS Code 插件总体架构

## 目标与范围

本插件在 VS Code 内提供小红书内容发现和阅读体验。第一期支持推荐/发现、热榜或热门入口、关键词搜索、笔记详情和图片/视频内容查看。数据只在用户本机读取和展示。

第一期不实现发帖、评论、点赞、收藏、关注、私信、批量采集或任何代替用户作出的互动行为。插件不提供验证码绕过、指纹伪装、代理轮换或反爬规避功能。

## 设计原则

1. 延续 Zhihu Fisher 的产品骨架：Activity Bar 入口、TreeView 列表、命令驱动的刷新/搜索/打开、WebView 阅读详情。
2. VS Code UI 不直接耦合小红书网页结构。通过 `ContentSource` 接口隔离数据来源，页面结构变化时只替换适配器。
3. 第一阶段优先利用官方网页在真实浏览器上下文中的行为，避免自行维护易变的签名算法和请求头伪装。
4. 登录凭证与浏览器配置留在本机。Cookie 不进入普通设置、日志、遥测或错误消息。
5. 低频、按需加载，尊重用户主动操作和站点访问限制；遇到登录墙、风控或结构异常时明确失败，不尝试绕过。

## 总体结构

```text
VS Code Extension Host
  Extension Activation / Command Registry
    View Providers (推荐、发现/热榜、搜索)
      Content Application Service
        ContentSource interface
          PlaywrightPageSource (一期默认)
          SignedWebApiSource (后续评估，默认关闭/不承诺稳定)
        Normalizer -> Note / FeedItem models
        SessionManager -> isolated local browser profile
        CacheStore -> bounded metadata cache
    WebviewManager -> note detail HTML/CSS/JS
```

建议目录（实现阶段采用）：

```text
src/
  extension.ts
  commands/
  views/
  application/        # use cases: load feed, search, open note
  sources/            # ContentSource and platform adapters
  session/            # browser lifecycle and login state
  models/             # normalized Note, Author, FeedItem, PageResult
  webview/             # detail rendering and message bridge
  storage/             # bounded cache and settings
```

## 组件职责

### Extension Host

负责激活、命令注册、TreeView 生命周期、全局加载状态、取消请求、错误映射和资源释放。列表 Provider 只负责展示与交互，不直接拼接平台 URL 或解析平台 DOM。

### Content Application Service

为 UI 提供稳定用例：`getHomeFeed`、`getExploreFeed`、`searchNotes`、`getNoteDetail`。维护分页游标、去重、并发限制和短期缓存。每个列表分别维护 loading/error/nextCursor 状态，避免一个列表的加载阻塞其他列表。

### ContentSource

```ts
interface ContentSource {
  getHomeFeed(cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>>;
  getExploreFeed(cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>>;
  searchNotes(query: string, cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>>;
  getNoteDetail(noteId: string, signal?: AbortSignal): Promise<NoteDetail>;
  getSessionStatus(): Promise<SessionStatus>;
  dispose(): Promise<void>;
}
```

平台原始对象应在 source 层转换为内部模型。视图、缓存和 WebView 不应依赖小红书的字段名。

### 浏览器会话与读取适配器

一期建议用 Playwright 的**可见、独立、持久化**浏览器上下文打开小红书官方网页。会话存放于 VS Code `globalStorageUri` 下的插件专属目录，与用户日常 Chrome 配置隔离；首次使用由用户自行在官方页面完成登录。通过正常页面导航、页面 DOM 和页面自身发出的可观察数据提取只读内容，不注入规避风控逻辑。

适配器初期可以优先读取稳定的语义 DOM（标题、作者、描述、图片、笔记链接），必要时在浏览器页面内消费站点已经返回的只读 JSON 响应。两种解析器都必须做版本化和健壮性检查；解析结果缺少必需字段时返回可诊断错误，不能静默渲染错误数据。

Playwright 与 VS Code 扩展宿主的体积、浏览器依赖和跨平台启动仍是实施风险。实现前需验证 Windows/macOS/Linux 的打包方式、扩展商店体积、Chromium 下载策略，以及 VS Code Web/远程开发环境的降级行为。若用户选择不安装浏览器或环境不支持，仍提供“在默认浏览器打开原笔记”的兜底。

### WebView 阅读器

列表点击后用 `WebviewPanel` 打开内部阅读页，而不是把远端站点直接嵌进 WebView。扩展侧传入规范化笔记数据；WebView 使用严格 CSP，只加载必要的远程图片/媒体源，消息桥只允许预定义操作（关闭、在浏览器打开、切换媒体显示、加载详情）。不要把 Cookie 或浏览器上下文对象发送给 WebView。

渲染器按纯文本和受限富文本构建内容，清理站点 HTML，避免直接执行远端脚本。大图按需加载；视频首期可显示封面和外部打开入口，内嵌播放待兼容性验证后再开放。

## 状态、缓存与错误

- 内存缓存列表和详情，设置上限及过期时间；第一期不持久化完整正文和媒体文件。
- 缓存 key 包含内容 ID、内容来源和查询词；分页按平台游标传递，避免通过页码猜测。
- 为每个数据请求设置超时、取消信号和有限并发；刷新时取消旧请求。
- 认证失效、网络错误、限流/风控、解析器不匹配分开呈现。限流时提示稍后重试，不自动高频重试。
- 日志只写操作阶段、耗时和状态码，不记录 Cookie、签名、请求体、完整个人资料或笔记正文。

## 身份与凭证

第一期由 Playwright 独立浏览器 profile 保存站点会话，不把 Cookie 放在 `settings.json`。如未来增加手动 Cookie 导入，应使用 `SecretStorage`，只允许用户主动粘贴，提供清除入口，并在保存前校验域名和最小必要字段。二维码登录如有需要，只使用官方登录页，不做账号密码采集。

不要自动读取用户默认 Chrome 的 Cookie 数据库。未来可评估用户主动连接 Chrome DevTools Protocol 的高级模式，但必须有明确的用户配置和单独的安全审查。

## 关键取舍

| 方案 | 优点 | 代价 | 决策 |
| --- | --- | --- | --- |
| 独立可见浏览器 + 官方页面读取 | 复用浏览器环境生成的请求参数；减少签名代码；登录与插件 UI 隔离 | 浏览器依赖大；DOM 易变；资源占用高 | 一期默认方案，先做跨平台技术验证 |
| 直接调用私有 Web API + 自行签名 | 请求和分页更轻；结构化数据较好 | 签名和参数易失效；协议来源和合规性需持续核验 | 抽象为后续 source，不作为一期前提 |
| 只用外部浏览器打开链接 | 风险和维护成本最低 | 无法在 VS Code 内提供信息流和阅读体验 | 作为不支持环境的兜底 |

## 实施前验证项

1. 确认小红书网页端当前是否能在普通、可见的独立浏览器会话中完成登录并读取首页/发现/搜索/详情。
2. 验证 Playwright 打包、启动、关闭、会话保留和 VS Code 扩展跨平台发布。
3. 对每种页面建立 DOM/响应解析样例及字段缺失测试，记录数据读取的最小字段集。
4. 审核社区项目许可证和小红书平台条款；不复制许可证不兼容的实现，不把“社区可运行”视为平台授权。
5. 若网页读取路径不稳定，先做小范围只读协议可行性验证，再决定是否启用 API source；验证未通过时保留外部浏览器兜底。
