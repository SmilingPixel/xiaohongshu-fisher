# 小红书社区接口调研与技术决策

调研日期：2026-10-07。范围是公开 GitHub 文档和项目配置，不代表对小红书当前接口的在线可用性测试，也不构成平台授权。GitHub Search API 本次返回 403 rate limit，GitHub 网页搜索返回 429；因此对项目细节只引用可直接访问的原始 README/配置文件和其明确链接，不推断未读源码的行为。

## 社区项目

### NanmiCoder/MediaCrawler

仓库：[github.com/NanmiCoder/MediaCrawler](https://github.com/NanmiCoder/MediaCrawler)

可核实的信息：README 将小红书列为支持平台，功能表列出关键词搜索、指定笔记详情、二级评论、创作者主页及登录态缓存。README 描述其基于 Playwright 登录并保存登录态，也提到通过保留登录态的浏览器上下文执行 JS 获取签名参数；其文档说明默认 CDP 模式可连接用户已有 Chrome 并复用浏览器登录状态。配置文件 `config/base_config.py` 明确列出 `LOGIN_TYPE` 为 `qrcode`、`phone` 或 `cookie`，并提供小红书平台和搜索/详情/创作者任务类型。

参考：

- [README.md](https://github.com/NanmiCoder/MediaCrawler/blob/main/README.md)
- [base_config.py](https://raw.githubusercontent.com/NanmiCoder/MediaCrawler/main/config/base_config.py)

许可证风险：README 标明项目使用 **NON-COMMERCIAL LEARNING LICENSE 1.1**。不应直接复制或打包其代码；即使仅参考设计，也应在采用任何代码或算法前独立审查完整许可证和目标插件的分发/使用场景。其项目面向采集工作流，功能远超本插件的只读需求。

### ReaJason/xhs

仓库：[github.com/ReaJason/xhs](https://github.com/ReaJason/xhs)

README 将其描述为 Python 小红书网页数据读取/爬取工具，并提醒爬取行为可能违法，要求避免对网站施压或未授权活动。文档提示接口实现可能变复杂，并指向独立使用文档。README 显示项目许可证徽章，但本次未进一步审阅许可证文本。

参考：[README.md](https://raw.githubusercontent.com/ReaJason/xhs/master/README.md)

对本项目的价值主要是接口形态和社区维护经验的参考。它是 Python 库，不能直接作为本 TypeScript 扩展的运行时依赖；跨进程运行 Python 会增加安装、升级、签名维护和支持成本。

### Cloxl/xhshow

MediaCrawler README 将 [Cloxl/xhshow](https://github.com/Cloxl/xhshow) 标记为小红书签名仓库。此次未能读取其原始 README，因此这里只记录为后续核验入口，不据此复制签名实现或声称其当前可用。

## 对接口形态的判断

- 小红书网页端并非稳定公开 API 契约；社区项目依赖登录态、网页行为和可能变化的请求签名。
- Playwright/CDP 的价值是让站点自己的页面上下文生成请求参数，降低手写签名算法的依赖；代价是浏览器运行时和页面结构维护。
- 直接调用私有 API 的性能和结构化程度更好，但需要不断追踪参数、签名、风控响应和字段变化。不能把社区脚本中的“当前能跑”当作长期兼容保证。
- 官方页面在无头 Chromium 中运行，系统浏览器仅用于用户主动打开的外链。扩展通过临时二维码截图和手机确认，在专属会话中完成正常登录。

## 历史远程运行方案比较

| 方案 | 登录方式 | 优点 | 主要成本与风险 | 结论 |
| --- | --- | --- | --- | --- |
| 无头 Chromium | 官方登录页二维码截图 + 手机扫码 | 适用于桌面、Remote SSH 和容器；不需要开放调试端口 | 需要验证二维码、扫码后状态和额外验证；主机需要 Chromium 系统依赖 | 当前采用的统一方案 |
| 本地浏览器 + SSH 隧道 CDP | 用户在本机 Chrome 登录，远程扩展连接 CDP | 可复用本地浏览器登录 | 端口转发和生命周期复杂；CDP 等同于浏览器控制权；断线恢复困难 | 历史调研备选，当前不支持 |
| 直接私有 Web API | Cookie/签名或社区实现 | 不需要浏览器窗口，响应结构可能更轻 | 签名易变，凭证处理和风控风险更高；社区许可证和平台规则需单独审查 | 不作为一期默认 |
| 只打开系统浏览器 | 用户自行在本机登录 | 依赖最少、失败影响小 | 扩展无法复用系统浏览器登录态，不能提供内置信息流 | 仅保留主动查看外链，不作为自动兜底 |

无头方案的关键不是把网页嵌入 WebView，而是让 Playwright 页面继续拥有登录态和页面上下文，VS Code 只显示登录进度与必要的二维码图像。任何截图传输都必须有明确的生命周期，不能进入日志、工作区或遥测。

## 当前决策

扩展保留 `ContentSource` 边界和持久化 profile，在所有环境中统一使用独立的无头 Playwright 上下文。登录通过官方二维码和手机确认完成，VS Code 辅助页提供状态和临时二维码查看入口。数据源仅读取推荐、发现、搜索和笔记展示字段，不实现指纹伪装、验证码处理、代理轮换或自动互动。

各类环境仍需真实账号端到端验证，覆盖二维码可用性、过期、额外验证、profile 复用和基本内容读取。上面的比较仅保留历史调研记录，不作为当前功能支持说明。`ContentSource` 继续保持可替换边界，不因此引入私有签名 API。

API source 进入实现前需要完成一次独立 spike：验证具体接口是否可由普通已登录网页触发、签名是否只能在页面上下文产生、分页是否可持续、返回字段是否覆盖第一期阅读需求、失败是否能区分登录失效与限流，并审阅实现来源许可证。任何不可稳定或有明显平台限制的路径都不进入默认实现。

## 后续核验清单

1. 读取 MediaCrawler 与 ReaJason/xhs 的完整许可证文本，确认哪些信息可以参考、哪些代码不能复用。
2. 检查小红书现行服务条款、隐私政策和网页访问规则，确定分发形态和用户操作边界。
3. 在隔离测试账号和本地测试环境验证登录、发现、搜索、详情页面；不访问或保存无关个人数据。
4. 记录页面字段映射和解析器 fixture，避免只依赖在线人工观察。
5. 核实 VS Code Marketplace 对浏览器运行时和扩展包大小的实际限制，再决定 Playwright 浏览器如何安装或分发。
6. 在隔离测试账号上验证无头 Chromium 登录页：二维码截图是否可扫描、过期和刷新是否可控、扫码成功后 profile 是否可复用、滑块/二次验证是否能停在可理解状态。
7. 验证 Remote SSH 的扩展宿主、VS Code WebView 消息和服务器文件权限，不把二维码截图、Cookie、页面响应或 CDP 地址写入持久化存储。
