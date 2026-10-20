# 命令参考

每个命令的完整参数以 `douban <命令> --help` 为准。登录、写入、导出与隐私见 [account.md](account.md)；JSON、错误码与排查见 [scripting.md](scripting.md)。

## 电影与剧集

这一组命令都是公开只读请求，无需登录，并且全部支持 `--json`。

| 命令 | 能做什么 | 常用参数 |
|---|---|---|
| `douban hot` | 热门电影；加 `--tv` 查看剧集 | `--tv`、`--tag`、`--limit` |
| `douban tv <tag>` | 按标签查看剧集 | `热门/美剧/英剧/日剧/韩剧/国产剧/综艺/最新` |
| `douban rank <genre>` | 按类型查看高分电影 | `--limit` |
| `douban top250` | 豆瓣电影 Top250，每页 25 条 | `--page`，支持交互翻页 |
| `douban now` | 正在热映（全国） | `--limit` |
| `douban coming` | 即将上映 | `--limit` |
| `douban weekly` | 一周口碑榜与排名趋势 | `--limit` |
| `douban search <keyword>` | 搜索电影（自动复用本地登录态，见下文） | `--start`、`--limit` |
| `douban movie <id-or-title>` | 电影/剧集详情，可直接传 ID 或片名 | `--json` |
| `douban rating <id-or-title>` | 评分分布、想看/看过统计和类型排名 | ID 或片名 |
| `douban comments <id-or-title>` | 热门短评 | `--page`、`--limit` |
| `douban reviews <id-or-title>` | 热门影评 | `--page`、`--limit` |

类型排行支持：剧情、喜剧、动作、爱情、科幻、动画、悬疑、惊悚、恐怖、纪录片、短片、情色、同性、音乐、歌舞、家庭、儿童、传记、历史、战争、犯罪、西部、奇幻、冒险、灾难、武侠、古装、运动、黑色电影。

```bash
douban hot --tv --tag 英剧 --limit 10
douban top250 --page 2
douban search "奥本海默" --start 20 --limit 20
douban movie 35593344
douban movie "沙丘"
douban rating 1291546
douban rating 沙丘
douban comments 1291546
douban reviews 1291546 --limit 5
```

豆瓣对未登录的搜索限流很严，所以搜索和按片名、书名查询会自动复用本地登录态。没有登录时被限流会返回 `RATE_LIMITED`；只拿到联想结果时会在 stderr 提示。ISBN 走豆瓣的直达地址，不经过搜索。

电影详情包括片名、年份、评分、导演、主演、类型、地区、语言、片长、集数、简介，以及“喜欢这部电影的人也喜欢”（`recommendations`）。某个数据来源失败时，保留其余来源的结果。

## 图书

以下读取命令无需登录，详情类命令接受豆瓣 ID、ISBN 或书名。`book user` / `book export` 会自动复用本地登录态；匿名读取书单时结果可能较少或被拒绝。图书的标记、评分和短评见 [account.md](account.md)。

| 命令 | 能做什么 | 常用参数 |
|---|---|---|
| `douban book top250` | 豆瓣图书 Top250 | `--start`、`--limit` |
| `douban book chart [category]` | 当前热门图书榜，最多 20 条 | `--limit` |
| `douban book new [category]` | 新书速递，最多 20 条 | `--limit`；别名 `latest` |
| `douban book search <keyword>` | 按书名、作者或 ISBN 搜索 | `--start`、`--limit` |
| `douban book info <query>` | 图书完整详情 | ID、ISBN 或关键词 |
| `douban book rating <query>` | 五星分布与想读/在读/读过统计 | ID、ISBN 或关键词 |
| `douban book comments <query>` | 热门短评 | `--page`、`--limit` |
| `douban book reviews <query>` | 热门书评 | `--page`、`--limit` |
| `douban book notes <query>` | 热门读书笔记 | `--page`、`--limit` |
| `douban book user <userId>` | 指定用户当前可见的想读/在读/读过书单 | `--wish`、`--reading`、`--page`、`--limit` |
| `douban book export <userId>` | 将当前可见的书单导出到文件 | `--wish`、`--reading`、`--limit`、`--output`、`--format`、`--delay` |

`book chart` 和 `book new` 支持：全部、文学、小说、历史文化、社会纪实、科学新知、艺术设计、商业经管、绘本漫画。

```bash
# 榜单与发现
douban book chart 小说 --limit 10
douban book top250 --start 25 --limit 20
douban book latest 科学新知

# 搜索、详情与内容
douban book search "三体" --limit 20
douban book info 三体
douban book info 9787536692930
douban book rating 三体
douban book comments 三体
douban book reviews 三体 --limit 5
douban book notes 三体 --limit 5

# 书单（自动复用本地登录态）
douban book user USER_ID --wish --page 2
douban book user USER_ID --reading
douban book export USER_ID --wish --limit 100 --delay 2 -o books.md
douban book export USER_ID --reading -f csv -o reading.csv
```

图书详情包括作者、译者、出版社、出版年、页数、定价、ISBN、丛书、标签、简介、作者简介、目录，以及“喜欢读这本书的人也喜欢”（`recommendations`）。某个数据来源失败时，保留其余来源的结果。

## 用户收藏、豆列与配置

| 命令 | 能做什么 | 登录要求 |
|---|---|---|
| `douban user <userId>` | 指定用户的电影看过/想看/在看 | 自动复用本地登录态；默认看过，使用 `--wish` 或 `--doing` 切换 |
| `douban book user <userId>` | 指定用户当前可见的图书读过/想读/在读 | 自动复用本地登录态；默认读过，使用 `--wish` 或 `--reading` 切换 |
| `douban config` | 查看本地配置；`--user <id>` 设置 `me` 的默认用户 | 无需登录 |
| `douban me` | 默认用户或当前登录账号的电影收藏 | 有默认用户时自动复用本地登录态、无登录态则匿名读取；否则先验证登录账号 |
| `douban list` | 热门豆列推荐 | 无需登录 |
| `douban list <id-or-url>` | 读取豆列内容，自动翻页 | 无需登录；`--limit`（最多 1000）、`--start` |

```bash
douban user USER_ID
douban user USER_ID --wish --page 2
douban user USER_ID --doing

douban config --user USER_ID
douban config
douban me --wish
douban list --limit 10
douban list 240962 --limit 50
douban list https://www.douban.com/doulist/240962/ --start 25
```

## 诊断

```bash
douban doctor            # 检查 Node.js 版本、登录态与本地文件权限，不发请求
douban doctor --online   # 额外发 2-3 个只读请求：公开接口、搜索是否被限流、登录是否仍然有效
```
