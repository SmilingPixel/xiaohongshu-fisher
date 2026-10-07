# 小红书 VS Code 插件实施方案

本文将 [总体架构](./architecture.md)、[第一期功能](./phase-1-features.md) 和 [社区接口调研](./community-api-research.md) 转换为可分阶段执行的工程方案。当前项目仍处于设计阶段；本文不代表已经验证小红书当前网页行为，也不授权复用社区项目代码。

## 实施目标

交付一个可在桌面版 VS Code 中安装和运行的一期扩展：用户可主动打开独立的小红书网页会话、浏览可用的推荐/发现内容、搜索笔记、在扩展内阅读笔记，并在需要时跳转到系统浏览器。扩展只执行用户触发的低频只读操作，遇到登录失效、页面验证、访问限制或结构变化时停止并解释状态。

一期先以桌面 VS Code 为目标。VS Code Web、Remote SSH/容器和 Marketplace 发布体积需要单独验证；不把这些环境的可用性假定为一期承诺。

## 技术决策与社区材料的使用边界

本地调研材料显示，社区实现大致分为两条路径：

| 路径 | 调研观察 | 实施决策 |
| --- | --- | --- |
| 可见浏览器会话 | MediaCrawler 使用 Playwright 持久化上下文；页面会话可用于登录和站点自身发起的请求。MediaCrawler 项目许可证限制为非商业学习用途 | 一期优先验证独立可见浏览器，用户自行登录。只复用正常页面行为，不复用其代码 |
| 私有 Web API | `xhs` 暴露搜索、首页 feed、笔记详情等接口形态；客户端自带请求签名。其许可证为 MIT，但爬取目的和接口实现不构成平台授权 | 用于了解候选字段、分页和错误形态；一期不直接导入 Python 运行时或移植请求/签名代码 |
| 独立签名库 | `xhshow` 的许可证为 MIT，覆盖 `x-s`、`x-s-common`、`x-rap-param`、指纹和会话状态等机制 | 不纳入一期默认数据源，不实现或移植指纹/风控参数生成。MIT 许可不等同于平台允许调用，也不等同于技术方案适合本插件 |

一期默认路线仍是 `PlaywrightPageSource`：由独立、可见的持久化浏览器上下文访问官方网页，以页面导航和用户可见交互获得内容；优先解析语义 DOM，若 DOM 不足，可在 spike 阶段验证从该页面自身已完成的只读请求中提取响应数据。扩展不得自行伪造浏览器环境、重放由社区逆向得出的私有签名请求或绕过页面上的验证步骤。

若该路线无法稳定支撑某个入口，按此顺序处理：隐藏或标注该入口当前不可用；提供打开原网页的命令；只有在单独评审后，才考虑新的只读 source。新 source 必须由普通、可见、已登录网页工作流触发，并通过独立的合规、许可证、安全和可维护性审查。不要为达到功能验收而默认切换到签名 API。

## 分阶段交付

### 阶段 0：技术可行性与发布约束 spike

目的：在扩展功能开发之前，确认一期基础依赖可行，避免把浏览器运行时和页面行为风险带入后续实现。

任务：

1. 记录目标桌面平台、VS Code 版本、Node.js 扩展宿主版本和扩展打包方式；核对当前项目的 VS Code engine 声明。
2. 用临时 spike 验证 Playwright 在扩展宿主中的启动、可见窗口、独立 user-data-dir、正常退出和会话持久化；评估浏览器二进制由用户安装、Playwright 下载或其他分发方式带来的体积与升级成本。
3. 手动用测试账号检查推荐、发现、搜索和详情的网页用户流程。记录页面 URL 模式、关键 DOM/响应样例、所需字段和无法覆盖的场景；不记录 Cookie、签名或个人内容到仓库。
4. 验证关闭 VS Code、取消命令、浏览器崩溃和清除会话时，页面与子进程都能被关闭；确认第二次启动仍能复用扩展自己的会话。
5. 核验小红书当前服务条款、隐私政策、网页访问规则和 VS Code 扩展分发限制。调研结论与待核验问题写入 `community-api-research.md`。

验收与决策门：

- **继续**：目标桌面环境可稳定启动可见浏览器；用户可自行登录；至少一个 feed、搜索和详情可以通过正常网页行为读取；关闭和会话清理可靠。
- **缩小一期**：部分页面不可读时，将不可用栏目移出首期承诺，保留外部浏览器打开和明确状态提示。
- **暂停浏览器内阅读路线**：浏览器无法可靠打包/启动，或网页工作流不能满足只读字段需求。先提交替代 source 的风险评估，未通过前不开始实现私有签名 API。

Spike 产物建议放在临时分支或独立原型目录；通过后只迁入经过验证且符合目标架构的代码，不把实验脚本和敏感样例提交到仓库。

### 阶段 1：扩展产品骨架与静态状态

目的：把当前 Hello World 脚手架改造成结构完整、无平台请求也可启动的扩展。

任务：

1. 更新 `package.json`：扩展展示信息、Activity Bar 容器、推荐/发现/搜索视图、命令、菜单、配置和激活事件；所有命令 ID 使用 `xiaohongshu-fisher.` 前缀。
2. 将 `src/extension.ts` 收敛为组合入口，创建服务、注册 TreeDataProvider 和命令，并把 disposables 放入 `context.subscriptions`。
3. 建立建议目录：

   ```text
   src/
     application/       # 用例、feed 状态与分页编排
     commands/          # VS Code 命令处理器
     models/            # Note、FeedItem、PageResult、错误类型
     session/           # 浏览器生命周期与会话状态
     sources/           # ContentSource 与网页适配器
     storage/           # 配置、有限元数据缓存
     views/              # TreeDataProvider 与树项
     webview/             # 阅读页、消息协议与 HTML 渲染
   ```

4. 建立可复用的空、加载、未登录、失败和无结果视图状态；本阶段的数据由内存 fake source 提供。
5. 移除 Hello World 测试，添加扩展激活、命令注册、视图状态和资源 dispose 的基础测试。

验收：扩展开发宿主能激活并展示三类视图；命令贡献与注册实现一致；无需启动浏览器或访问网络；`pnpm run compile`、`pnpm run lint`、`pnpm test` 通过。

### 阶段 2：内部模型、用例和数据源边界

目的：固定扩展内部数据契约，避免视图、平台解析和分页逻辑相互耦合。

建议接口：

```ts
interface ContentSource {
  getHomeFeed(cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>>;
  getExploreFeed(cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>>;
  searchNotes(query: string, cursor?: string, signal?: AbortSignal): Promise<PageResult<FeedItem>>;
  getNoteDetail(id: string, context?: NoteSourceContext, signal?: AbortSignal): Promise<NoteDetail>;
  getSessionStatus(): Promise<SessionStatus>;
  openLogin(): Promise<void>;
  dispose(): Promise<void>;
}
```

`NoteSourceContext` 用于携带打开详情所需的平台上下文（例如来源 URL 或页面上下文标识）。来源 URL 可能包含平台令牌，应按敏感数据处理，只在 source 内短暂使用，不写日志、缓存或 WebView。若网页适配器不需要某项，可省略；不要把 Cookie、签名或浏览器对象放进通用模型。

实施任务：

1. 定义 `FeedItem`、`NoteDetail`、`PageResult`、`Author`、`MediaItem`、`SessionStatus` 和 `SourceError`，明确必填/可选字段与媒体 URL 协议限制。
2. 为平台原始数据建立单向 normalizer；缺少可选字段时保留条目，缺少身份 ID 或原链接时拒绝该条目并记录非敏感诊断。
3. 在 application service 实现每个列表独立的 loading/error/cursor 状态、按 ID 去重、刷新重置游标、刷新失败保留旧数据、加载更多失败保留已加载项。
4. 新搜索取消同一搜索视图中的旧请求；同一列表不允许重复并发加载；其他视图互不阻塞。
5. 添加 fake source 用于测试与 UI 开发；source 错误映射为认证失效、访问受限、网络错误、页面解析失败、内容不可用和未知错误，不透传原始响应文本。

验收：分页和取消行为有独立单元测试；normalize 对字段缺失、意外类型、重复条目和未知媒体类型有 fixture 测试；应用层测试不依赖 VS Code 或浏览器。

### 阶段 3：浏览器会话和页面读取适配器

目的：封装浏览器进程、扩展专属会话和平台页面解析，视图只通过 `ContentSource` 获取模型。

任务：

1. 浏览器 profile 使用 `context.globalStorageUri` 下插件自有目录；不扫描、导入或修改用户默认浏览器 profile。
2. 持久化上下文只由用户触发登录或内容读取时启动；提供“打开登录页”和“清除本地会话”操作。登录只发生在官方可见页面，不由插件收集账号密码或短信验证码。
3. 确定运行时策略：Playwright Node 包和 Chromium 的安装/分发方式、版本固定策略、升级提示、离线错误和平台支持矩阵。任何额外运行时依赖通过 `pnpm` 管理并更新 lockfile。
4. 页面适配器将导航、页面等待、响应监听、DOM 解析、字段归一化与错误分类拆为小模块。优先使用语义选择器；选择器集中管理并带页面版本/采样日期说明。
5. 仅在阶段 0 证明必要且可控时，读取由页面自身触发的只读 JSON 响应；限定官方域名、允许路径、请求类型、字段白名单和响应大小。不得通用记录浏览器流量或保存完整 HAR。
6. 每种页面定义超时、取消、最大等待时间和并发上限；认证墙、验证码、限流或其他访问控制提示出现时停止当前动作，不刷新循环、不切换身份、不自动重试。
7. 将解析样例做脱敏 fixture。Fixture 仅保留解析必需字段，媒体 URL、Cookie、用户标识等敏感/可关联数据替换为虚构数据。

验收：测试账号下手动验证能够建立和复用会话；推荐/发现/搜索/详情中已承诺的入口至少能完成一条读取链路；关闭、取消和清理会话后无遗留浏览器进程；日志与测试 fixture 不含凭证或真实笔记正文。

### 阶段 4：TreeView、命令与阅读 WebView

目的：实现一期用户可见流程，同时保持平台读取与展示边界清楚。

任务：

1. 推荐、发现、搜索 TreeView 分别绑定 application service 中独立状态；行项目显示标题、作者、媒体类型、可用互动数据和时间，避免为可选字段伪造占位值。
2. 实现刷新、搜索、加载更多、打开笔记、打开原网页、打开登录页、清除会话命令；使用 VS Code QuickPick/InputBox、进度和错误消息。
3. 搜索入口拒绝纯空白查询，重复搜索取消旧请求；加载更多仅在有游标且当前无请求时启用。
4. 笔记点击打开或复用 `WebviewPanel`。应用层传入 `NoteDetail` DTO，不传递 Playwright/Page/BrowserContext 或原始平台对象。
5. 阅读页实现标题、作者、正文、图片序列、话题和可用元数据；视频首期显示封面及外部打开入口，不自动播放。
6. 使用严格 CSP、随机 nonce、最小 `localResourceRoots`；图片仅加载允许的 HTTPS 图片域名；消息按 schema 验证、拒绝未知命令。正文以文本节点渲染或经过明确 sanitizer，不插入未经清理的平台 HTML。
7. WebView 更新只发送当前阅读页所需数据；不将详情正文写入工作区或持久缓存。面板 dispose 时解绑消息监听和引用。

验收：开发宿主内可以从视图完成搜索到详情阅读、关闭后回到原列表；畸形消息被拒绝；危险 HTML/URL 不执行或导航；WebView 不含凭证和未使用的平台响应字段。

### 阶段 5：稳定性、平台验证与发布准备

目的：完成扩展打包质量、支持矩阵与一期验收。

任务：

1. 在 Windows、macOS、Linux 桌面 VS Code 验证安装、浏览器启动、登录复用、搜索/详情、清除会话和卸载行为；记录不支持场景。
2. 验证 `vscode:prepublish`、VSIX 内容、原生依赖/浏览器缓存的打包边界和扩展包大小；浏览器不可用时必须有可理解的降级入口。
3. 用 stub page/fixture 测试解析器对选择器变化、缺字段、异常响应和访问错误的行为；网络集成测试为手动或显式 opt-in，不在 CI 中请求真实账号或平台数据。
4. 按 `AGENTS.md` 完成隐私与安全检查；整理用户数据目录、清理会话方式、日志字段和故障排查说明。
5. 对照 `phase-1-features.md` 的首期验收标准逐项勾选；修订 README/CHANGELOG 和扩展元数据后再考虑打包发布。

## 模块依赖与接口流

```text
package.json contributions
        |
        v
extension.ts -> Commands -> ApplicationService -> ContentSource
                    |              |                   |
                    v              v                   v
                 TreeViews     Models/Cache       BrowserSession
                    |                                  |
                    +----------> WebviewManager <-----+
                                  (NoteDetail DTO)
```

依赖规则：

- `views` 和 `commands` 依赖 application service，不直接依赖网页选择器、HTTP client 或响应字段。
- `application` 依赖 `ContentSource` 抽象和内部模型，不依赖 Playwright。
- `sources` 负责平台页面交互、响应/DOM 解析、normalization 前校验和错误翻译。
- `session` 独占浏览器上下文生命周期；其他模块通过 `ContentSource` 的方法使用会话。
- `webview` 只接收序列化 DTO；不能访问扩展宿主任意能力或浏览器会话。
- `storage` 只缓存有限元数据和用户偏好；首期不写入完整笔记正文、Cookie 或媒体文件。

## 状态与错误约定

每个 feed/search 状态至少包含 `items`、`isLoading`、`isLoadingMore`、`nextCursor`、`error`、`lastUpdatedAt`。刷新开始后保留旧数据；只有首屏成功才替换列表。加载更多成功时按 ID 合并。请求取消不是用户可见错误。

`SourceError` 应提供稳定 code、面向用户的简短说明和可重试标记，不携带原始请求头、Cookie、签名、个人资料或响应正文。映射原则：

| 条件 | UI 行为 |
| --- | --- |
| 无登录会话/会话失效 | 提示打开官方页面登录，再由用户手动重试 |
| 页面验证或访问受限 | 停止当前请求，说明需要在官方页面处理或稍后再试，不自动重试 |
| 网络超时/断网 | 保留旧列表，允许用户手动重试 |
| 解析失败/页面变化 | 保留旧列表，提示页面暂不可读取并提供原网页入口 |
| 单条内容不可用 | 保留列表其他项目；详情显示不可用状态和原网页入口 |
| 用户取消 | 静默结束加载状态，不清除已有数据 |

## 测试策略

| 层级 | 验证内容 | 执行方式 |
| --- | --- | --- |
| Unit | 去重、游标、取消、状态转换、错误映射、normalizer | `pnpm test` 内的纯单元测试 |
| Extension Host | 激活、命令注册、视图创建、dispose | VS Code 扩展测试 harness |
| WebView | CSP 输出、URL 白名单、消息 schema、恶意内容处理 | 纯逻辑测试与开发宿主手动验证 |
| Source fixture | 已脱敏 DOM/JSON fixture 到内部模型，未知结构失败 | 不请求网络的解析器测试 |
| Manual integration | 官方网页登录、feed、搜索、详情、会话持久化 | 使用隔离测试账号，用户本机手动执行；不进入自动 CI |
| Package | 编译、lint、测试、VSIX 内容与体积 | `pnpm run compile`、`pnpm run lint`、`pnpm test`、打包检查 |

有意义的行为变更需补相应测试，尤其是分页/取消、会话清理、source 错误分类和 WebView 消息校验。不要在自动化测试中保存真实 Cookie、测试账号或平台内容。

## 配置与存储计划

一期配置仅保留用户可理解且必要的选项，例如默认打开方式、是否显示可获取的互动统计、图片显示密度和调试日志开关。命令与配置贡献通过 `package.json` 声明，默认值应能直接使用。

- Playwright profile：`globalStorageUri` 下单独目录，清理命令关闭上下文后删除该目录。
- 偏好设置：VS Code `workspace`/`global` configuration，不能写入凭证。
- SecretStorage：一期若完全不使用手工凭证导入，则不引入 Cookie 存储；未来要增加时另行设计和评审。
- 缓存：有界内存缓存；设置最大条目数和 TTL，首期不持久化全文、Cookie、页面 HTML、HAR 或媒体。
- 日志：使用 `LogOutputChannel` 或 VS Code logging API，仅记录操作类型、耗时、结果类别和必要错误 code。

## 依赖和脚本改造

项目日常依赖、脚本、测试和打包统一通过 pnpm 管理。实施依赖前先做阶段 0 验证，避免提前引入大型浏览器依赖。确定后：

1. 用 `pnpm add` / `pnpm add -D` 更新依赖并同步 `pnpm-lock.yaml`。
2. 评估 Playwright 是否采用 `playwright-core` 配合受支持的浏览器安装流程，或采用其他可维护方案；决策须记录安装体验、平台覆盖、包大小和升级责任。
3. 禁止由扩展首次激活时静默下载浏览器；若安装浏览器需要用户操作，应提供明确进度、取消和错误反馈。
4. 保持 `compile`、`lint`、`test` 与 `vscode:prepublish` 脚本一致，必要时添加独立的类型/打包检查脚本。

## 风险与处置

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 网页 DOM/响应变化 | feed 或详情解析中断 | 页面解析器单独隔离；fixture 覆盖；失败时明确降级到原网页 |
| 登录和会话变化 | 用户重复登录或内容无法访问 | 独立 profile；只由用户可见页面登录；状态过期时停止请求 |
| 浏览器依赖与 VS Code 兼容性 | 扩展安装体积大、远程环境不可用 | 阶段 0 先验证桌面目标和分发；远程/Web 标为未支持或提供外部浏览器方式 |
| 社区私有 API/签名易变 | 突发失败和维护成本 | 不作为一期依赖；只有独立评审后考虑可替换 source |
| 许可证边界 | 代码分发不合规 | 不复制 MediaCrawler；对 MIT 项目也执行依赖/代码审查和 notice 检查 |
| 平台访问控制或限流 | 账号/访问风险与服务中断 | 遇到限制即停止，不增加自动重试、伪装、代理轮换或验证码处理 |
| 页面内容不可信 | XSS、恶意链接或 WebView 外跳 | DTO 白名单、URL 校验、CSP、HTML sanitizer 和消息 schema 验证 |

## 一期完成定义

一期完成必须同时满足：

1. 阶段 0 的路线决策记录完成，目标桌面环境与浏览器安装/分发路径有明确结论。
2. 三个列表入口、搜索、分页、笔记详情、登录页和原网页降级入口按一期功能文档可用；暂不可用的平台栏目有明确状态。
3. 刷新失败保留旧数据；分页去重；取消和重复加载行为受控。
4. 浏览器 profile 与会话清理可由用户控制；不读用户默认浏览器 Cookie。
5. WebView 安全约束通过测试；日志、fixture、设置和 WebView 中没有 Cookie、签名或完整敏感内容。
6. `pnpm run compile`、`pnpm run lint`、`pnpm test` 和目标平台打包检查通过；手动验证限制在隔离测试账号。
7. 不含发帖、评论、点赞、收藏、关注、私信、批量下载、验证码处理或规避平台控制的功能。
