# MiraBoard API 数据契约 v1

## 目的

所有正常的本机 API 响应携带 `contract`。前端只接受名称、版本和层级均匹配的响应，避免服务端与页面版本不一致时把错误数据当作真实研究数据使用。

```json
{
  "contract": {
    "name": "miraboard.read.bootstrap",
    "version": 1,
    "layer": "read"
  }
}
```

## 分层

- 读取层：`/api/read/*`。只读取 Mira 研究索引、文件预览、行情、日历和状态；不改变任何文件或配置。
- 受控操作层：`/api/ops/*`。归档、AI 配置/测试、Mira 更新等会改变状态或触发外部请求的操作。每个响应使用 `miraboard.operation.result`，并带 `operation` 标识。
- 旧的 `/api/*` 路径暂时保留兼容；页面只使用分层路径。

## v1 核心契约

| 契约 | 必要字段 |
| --- | --- |
| `miraboard.read.bootstrap` | `navItems`、`objects`、`libraryDocs`、`objectLibraryFiles`、`activity` 为数组；`meta` 为对象 |
| `miraboard.read.market-session` | `status`、`market`、`marketDate`、`calendarKnown`、`phase`、`expectedQuoteDate` |
| `miraboard.read.market-calendar` | `market`、`timezone`、`source`、`years` |
| `miraboard.operation.result` | `status`、`operation`；写入类操作另有 `wrote` / `confirmationRequired` / 目标路径等业务字段 |

## 变更规则

- 可选字段增加：保持 v1。
- 字段语义或必填字段变化：升级到 v2，并让前端明确兼容该版本后再使用。
- `data/a-share-market-calendar.json` 是前后端共同读取的唯一 A 股交易日历源；未知年份必须返回 `calendar_unknown`，不能假设开市。
