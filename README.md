# MiraBoard Prototype

本目录是 MiraBoard 的本地前端原型，当前阶段用于确认界面、导航、关键交互，以及 Mira 文件索引和确认式写入边界。

## 代码结构

- `app.js`：页面状态、导航与各业务视图编排。
- `frontend_security.js`：HTML 转义与外部链接协议校验。
- `data_utils.js`：CSV 和数字字段解析。
- `markdown_renderer.js`：安全 Markdown 摘要与预览渲染。
- `option_math.js`：无依赖期权情景计算。
- `server.py`：本地 HTTP/API 编排、行情与研究工作流。
- `server_security.py`：路径、AI 地址和本机请求来源校验。

这些前端模块均使用普通 `<script>` 加载，不需要打包器，直接打开 `index.html` 的离线模式仍然有效。

## 打开方式

推荐运行 `start.bat`。启动器会复用已健康运行的实例；否则在 5178-5185 中选择空闲端口，独立后台启动服务，通过健康检查后再打开浏览器。运行状态写入 `.tmp/miraboard-runtime.json`，启动错误写入 `.tmp/server-err.log`。

运行一次 `powershell -ExecutionPolicy Bypass -File .\install-autostart.ps1` 可安装 Windows 登录自动启动。自动启动只运行后台服务，不弹出浏览器；以后双击 `start.bat` 会直接打开健康实例。

首次启用 A 股一级备用行情源时运行 `npm install`，安装锁定版本的本地 `stock-api` 适配器。

默认地址：

`http://127.0.0.1:5178`

也可以直接打开 `index.html` 查看静态原型；这种方式会使用内置默认数据或 `data/bootstrap.json`，不会连接 API。

## 已实现

- 研究总览卡片墙与市场筛选
- 顶部搜索覆盖研究总览、标的库和资料库当前列表。
- 数据源状态页面显示 API、Mira 根目录、索引数量、文件预览、行情路由和写入边界。
- 独立雷达面板：今日刷新、风险和确认队列
- 更新队列页面按刷新状态列出待处理对象。
- 独立标的库：对象表格与 A 股 / 港股 / 美股市场筛选
- 行业视图初版按市场分组展示对象和资料数量。
- 方法论库初版展示 MiraBoard 的研究边界、证据链、刷新规则和写入确认原则。
- 设置页面展示 Mira 路径、端口、写入权限、文件预览、行情接入和缓存状态。
- 标的详情页
- `更新股价行情` 和 `更新行业新闻` 两个研究更新按钮
- 更新按钮会按当前对象生成只读预览记录，不直接写入 Mira。
- Mira 写入记录活动面板
- 行情图上的 override / Mira 技术点位 / 自动解析点位图例
- 未接入真实行情前，技术图表显示明确的待接入状态，避免展示模拟点位。
- 左侧导航新增 `资料库`
- 全局资料库使用真实 Mira 文件索引，按实际文件类型动态筛选，并支持文本正文只读预览。
- 前端数据拆分到 `data/bootstrap.json`
- 本地只读 API：
- `/api/health`
- `/api/provider-status`：只读展示 Mira `local/provider-status.json` 中的行情Provider能力与健康状态
  - `/api/bootstrap`
  - `/api/research-index`
  - `/api/source-file`
- `/api/quote`
- `/api/quotes`：单次最多 40 个标的，同时最多运行 2 个批量任务；跨站浏览器请求会被拒绝。
- `/api/update-market`、`/api/update-news`：首次调用只生成完整预览和一次性确认令牌；只有用户在界面确认后，第二次调用才写入对应 Mira 更新文件。
- API 模式下，研究总览和标的库会使用真实 Mira `private/research` 对象索引。
- 详情页资料库支持 Markdown / CSV / 文本文件的只读正文预览。
- 详情页会优先打开关键研究文件：`investment-memo.md`、`working-view`、`monitor`、`report-readout`。
- 详情页顶部会从 Markdown 中提取 `core conclusion`、`must_refresh_if`、`data_cutoff` 摘要。
- A 股行情按 `Mira Eastmoney → stock-api auto（腾讯 / 新浪 / 东方财富）→ Yahoo Chart` 降级；`stock-api` 固定为 `2.7.3`，由服务端本地适配器调用。
- 港股、美股继续使用 Yahoo Chart；期权继续使用新浪期权接口。港股会把 `00700.HK` 规范化为 `0700.HK`。

## 数据与接口

- 前端启动时优先读取 `/api/bootstrap`。
- 如果 API 不可用，会回退到 `data/bootstrap.json`。
- 如果仍不可用，会使用 `app.js` 里的嵌入式兜底数据，保证页面不白屏。
- API 默认扫描相邻目录 `../Mira/private/research`。
- 如 Mira 路径不同，可设置环境变量 `MIRABOARD_MIRA_ROOT`。
- 前端请求统一带超时；本地读取、行情批量、AI/新闻和 Tushare 长任务使用不同时间预算。

## 边界

- API 模式下对象列表来自真实 Mira 索引；行情、涨跌幅可通过只读行情接口刷新预览，详情页结论仍来自已索引的 Mira 文本摘要。
- API 默认只读扫描 Mira 文件索引，并只读预览 Mira 根目录内的文本文件。
- 行情和新闻更新严格执行“先完整预览、再显式确认”：预览令牌 10 分钟失效，且目标文件在预览后发生变化时拒绝写入。
- 本地静态服务只公开页面运行所需的前端资源和数据文件，不公开后端源码、测试或项目说明文件。
- 除用户确认后的 `market-update` / `monitoring-update` 外，Mira 仓库保持只读；MiraBoard 自己的状态、缓存和行情归档写入 MiraBoard/data。
