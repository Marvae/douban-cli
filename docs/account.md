# 登录、写入与导出

## 登录

首次使用账号功能时运行：

```bash
douban login
douban whoami
```

`login` 读取你浏览器里已有的豆瓣登录（只取 `dbcl2` / `ck`），确认账号后加密保存到本机。默认使用系统默认浏览器；浏览器里还没登录豆瓣时，会先问你要不要打开登录页。

```bash
douban login --browser arc                         # 指定浏览器：chrome、edge、firefox、safari、arc
douban login --browser chrome --profile "Profile 2"
douban login --open                                # 直接打开豆瓣页面，不再询问
douban login --cookie-timeout 120                  # 钥匙串授权较慢时延长等待（1-300 秒，默认 60）
```

- 需要在交互式终端里运行。
- macOS 读取 Chrome、Edge、Arc 的登录时会弹出钥匙串授权，每次登录只弹一次。选“允许”即可；“始终允许”以后不再询问，但本机其他程序也能借此读取这个浏览器的 Cookie。
- Safari 和 Arc 仅支持 macOS；`--profile` 需要同时指定 `--browser`，且不能与 `--open` 同用。
- 最终保存的账号以验证结果为准，可用 `douban whoami` 确认。

读取浏览器失败时，可以手动导入（二选一，不会自动切换）：

```bash
pbpaste | douban login --cookie-stdin              # macOS：粘贴开发者工具里复制的 Cookie 请求头
Get-Clipboard | douban login --cookie-stdin        # Windows PowerShell
douban login --cookie-file /path/to/cookies.txt    # 浏览器扩展导出的 Netscape cookies.txt
```

不要把 Cookie 写进命令行参数、环境变量、聊天或 Issue；导入用的文件也是登录凭据，用完请删除。`login --json` 不会输出任何 Cookie。

### 登录过期

- 本地保存的登录 30 天后过期；剩 3 天时，账号命令会提醒你。`douban doctor` 也能看到剩余天数。
- 在浏览器里退出豆瓣或修改密码后，本地登录也会失效。账号命令会提示重新运行 `douban login`；搜索和片单会自动改用匿名请求并提示。

## 标记、评分、短评与标签（电影和图书）

以下操作会修改当前豆瓣账号。电影命令在根目录，图书命令在 `book` 下，用法一致：

```bash
douban mark 1292052 --wish                  # 电影：--wish / --watched / --watching
douban book mark 2567698 --read             # 图书：--wish / --read / --reading
douban rate 1292052 --score 5
douban book comment 2567698 "值得重读" --tags 科幻,经典 --private
douban record 1292052                       # 查看自己对该条目的状态、评分、短评、标签和可见性
douban book unmark 2567698 --dry-run        # 先预览，确认后去掉 --dry-run
douban review 1292052 "标题" --file review.md  # 长评（仅电影）
```

- 每次写入都会先读取当前记录，只修改你指定的字段，提交后再读回核对；评分、短评、标签和“仅自己可见”不会被意外清空，也从不勾选“分享到广播”。
- `--dry-run` 只显示修改前后的对比，不提交。`--tags` 覆盖原有标签；`--private` / `--public` 切换可见性。
- `rate` 会把条目标为看过/读过；`comment` 保留原状态，未标记时标为看过/读过；`unmark` 会删除整条记录（含评分、短评、标签）。
- 写入失败不会自动重试；读回结果与预期不一致时会报错并提示用 `record` 核对。

## 统计、导出与关注

```bash
douban stats --year 2026 --limit 30 --delay 2
douban export --format json -o douban-export.json
douban export --format csv -o douban-export.csv

douban follow USER_ID
douban unfollow USER_ID
douban logout
```

- `stats` 统计最近最多 1000 条“看过”记录（`--limit` 可调），较早的年份可能不完整。
- `stats`、`export`、`book export` 每页请求之间默认等待 1 秒（`--delay` 可调）。
- `export --limit` 分别作用于看过、想看、在看三种状态，总条数最多约为 `3 × limit`。

## 两种导出

| 命令 | 数据 | 登录 | 格式 | 说明 |
|---|---|---|---|---|
| `douban book export <userId>` | 指定用户在当前登录状态下可见的想读/在读/读过 | 自动复用；无登录态则匿名读取 | Markdown、CSV、JSON | 必须指定 `--output`；未传 `--format` 时按扩展名推断；最多 5000 条；`--delay` 控制分页间隔 |
| `douban export` | 当前账号的电影看过/想看/在看 | 需要 | CSV、JSON | 必须指定 `--output`；可能包含评分、短评和用户信息；`--delay` 控制分页和状态切换间隔 |

登录后导出自己的书单可能包含匿名访问时不可见的条目，分享文件前请检查内容。

两种导出在后续页面请求失败时都会保留已经取得的数据，并通过 stderr 明确告警。JSON 文件还会写入 `metadata.partial` 和 `metadata.warnings`；CSV/Markdown 会在完成提示中标明结果可能不完整。

## 批量操作

电影和图书的标记、取消标记、评分和短评都支持 `--file`。默认在每次写入之间随机等待 1–2 秒，也可以通过 `--delay` 指定固定间隔。

```bash
douban mark --file ids.txt --wish
douban unmark --file ids.txt --delay 1.5
douban rate --file ratings.csv
douban comment --file comments.tsv --delay 1.5
```

文件格式：

- `mark` / `unmark`：每行一个电影 ID。
- `rate`：每行 `<id>,<score>`，`score` 为 1–5。
- `comment`：每行 `<id>,<comment>`，逗号或制表符分隔。
- 空行和以 `#` 开头的注释会被忽略。

批量任务会逐项继续执行；如果部分条目失败，结果会同时给出成功和失败明细，并以非零退出码结束。

## 隐私与本地文件

- 公开只读命令不会隐式读取浏览器 Cookie。浏览器登录只在显式运行 `douban login` 时发生；手动导入只在显式传入 `--cookie-stdin` 或 `--cookie-file` 时发生，浏览器失败不会自动切换来源。
- CLI 不接受包含 Cookie 内容的命令行参数或环境变量，也不会自行读取剪贴板。Netscape `cookies.txt` 属于敏感登录凭据，不要提交到 Git、上传到公开服务或长期保留。
- 登录缓存使用 AES-256-GCM 加密、文件权限 `0600`，应用目录权限为 `0700`，并按缓存内的 `updatedAt` 在 30 天后失效；`douban logout` 会删除本地缓存，不会退出浏览器中的豆瓣账号。
- macOS 将登录缓存和配置保存在 `~/Library/Application Support/douban-cli/`；Linux 分别使用 `$XDG_STATE_HOME/douban-cli/` 和 `$XDG_CONFIG_HOME/douban-cli/`（未设置时使用标准默认目录）；Windows 分别使用 `%LOCALAPPDATA%\douban-cli\` 和 `%APPDATA%\douban-cli\`。
- 可将 `DOUBAN_CLI_HOME` 设为绝对路径，让登录缓存和配置统一存放到指定目录。旧的 `~/.douban-cli-auth.json` 与 `~/.douban-cli.json` 会在验证迁移结果后自动删除。
- 多浏览器登录不同账号时，请使用 `--browser` 和 `--profile` 明确选择，避免操作错误账号。
- 导出文件可能包含用户 ID、收藏、评分和短评。请保存到合适的位置，不要误提交到 Git 或上传到公开服务。
