# 脚本化、分页与排查

## JSON 输出与脚本化

除两个文件导出命令外，所有操作命令都支持 `--json`：

```bash
douban weekly --json
douban book info 三体 --json
douban user USER_ID --wish --json
douban whoami --json
```

- `--json` 将命令结果写到 stdout；失败时向 stderr 写结构化 JSON，并返回非零退出码。错误码包括 `INVALID_ARGUMENT`、`NOT_FOUND`、`AUTH_REQUIRED`、`RATE_LIMITED`、`HTTP_ERROR`、`NETWORK_ERROR` 等。
- 结果可能不完整时，提示写到 stderr（以 `⚠️` 开头），stdout 的 JSON 保持可解析。
- `export --format json` 与 `book export --format json` 是文件格式选项，不会把 JSON 打到 stdout。
- 需要稳定脚本行为时，以具体命令的 `--help` 和 JSON 字段为准，不要解析人类可读表格。

## 交互翻页

以下命令在交互终端中支持翻页：

- 电影：`top250`、`comments`、`reviews`、`user`、`me`。
- 图书：`book top250`、`book comments`、`book reviews`、`book notes`、`book user`、`book me`。

按回车或 `n` 下一页，`p` 上一页，`g <页码>` 跳转，`q` 退出。已经访问过的页面会在本次会话中复用。

使用 `--json`、管道或重定向时不会进入交互模式，只返回 `--page` 指定的页面；文本输出末尾会提示下一页的 `--page`，或说明已到最后一页。`search`、`book search` 和 `list` 使用 `--start` 偏移量，不使用交互分页。

## 排查问题

先查看根命令或子命令帮助：

```bash
douban --help
douban book --help
douban book comments --help
```

需要排查网络、解析或登录问题时，可以临时启用调试日志：

```bash
DOUBAN_DEBUG=1 douban book info 三体
```

- 只读请求失败会有限重试；页面结构无法识别时直接报错，不返回空列表。
- `RATE_LIMITED`：被限流。登录后搜索不容易被限，或者稍后再试。
- 安全验证（`HTTP_ERROR`，提示需要验证）：在浏览器里打开豆瓣完成验证，并暂停一段时间再用。
- 服务端要求的等待时间超过 CLI 的自动等待上限时，CLI 会直接停止，不会提前重试。
- `douban doctor --online` 可以一次检查网络、搜索限流和登录状态。
