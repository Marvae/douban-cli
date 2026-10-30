# douban-cli · 豆瓣命令行工具

[![npm version](https://img.shields.io/npm/v/%40marvae24%2Fdouban-cli.svg)](https://www.npmjs.com/package/@marvae24/douban-cli)
[![npm downloads](https://img.shields.io/npm/dm/%40marvae24%2Fdouban-cli.svg)](https://www.npmjs.com/package/@marvae24/douban-cli)
[![CI](https://github.com/Marvae/douban-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Marvae/douban-cli/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

在终端和 AI 里用豆瓣：查电影、剧集、图书和 Top250，一条命令导出备份你的豆瓣观影和读书记录，让 AI 放心地帮你标记、评分、写短评。

Douban (豆瓣) from your terminal and AI agents: look up movies, TV shows and books, back up your ratings and reviews to JSON, CSV or Markdown, and let an agent mark and rate titles safely.

```text
$ npx @marvae24/douban-cli now

🍿 正在热映

#    片名                 评分   上映    ID
1    生化危机：爆发夜     7.3    10.05   37068446
2    鲸口脱险             6.2    10.16   36806762
3    神探之痕迹           6.8    10.01   37247814
4    一个夜晚与三个夏天   7.2    10.13   36449264
5    野兽之心             7.3    09.30   36828393
```

- 💾 **备份你的豆瓣**：一条命令导出看过、想看、在看和读过、想读、在读，连同评分、短评和“仅自己可见”的条目，存成 JSON、CSV 或 Markdown。
- 🤖 **交给 AI**：装上 Skill，直接说“今晚看什么”“用 ISBN 把这本书标成读过，评 5 星”。改动账号前会先给你看预览；同一书名有多个版本时按 ISBN 核对。
- 🔎 **想查就查**：片名、书名、ISBN 直接查评分、短评、书评、相似推荐和播放平台；实时热门、Top250、正在热映、电影/剧集/综艺口碑榜、豆列都能看，不用登录。
- 🛡️ **改得放心**：只改你指定的内容，原有评分、标签和可见性都会保留，不发广播，改完读回核对。
- 🪶 **不用安装**：有 Node.js 就能用 `npx` 直接运行。只有 2 个依赖，不需要申请 API key。

## 常见用法

| 想做的事 | 怎么做 |
|---|---|
| 备份豆瓣观影、读书记录 | `douban export -o movies.md`，`douban book export -o books.csv` |
| 把微信读书读完的书同步到豆瓣 | 同时装上微信读书官方 Skill，对 AI 说“把我今年在微信读书读完的书标到豆瓣”；按 ISBN 精确匹配，先预览再提交 |
| 找下一部想看的 | 对 AI 说“推荐几部像《沙丘》的电影”，或 `douban movie 沙丘` 看相似推荐 |
| 最近追什么剧 | `douban trending --tv` 看实时热度，`douban weekly --tv` 看口碑；`douban movie <剧名>` 看在哪个平台播 |
| 查评分和榜单 | `douban trending`（实时热门）、`douban top250`、`douban now`、`douban weekly`、`douban book info <ISBN>` |

## 在 AI agent 里使用

把这句话发给你的 agent：

> 安装这个 skill 并帮我配置好：https://github.com/Marvae/douban-cli/tree/main/skills/douban-cli

或者在终端安装到本机支持 Agent Skills 的 agent：

```bash
npx skills add Marvae/douban-cli
```

Skill 会在需要时帮你装好 CLI。用到账号功能时，需要你在自己的终端里运行一次 `douban login`。

## 在终端使用

```bash
npm install -g @marvae24/douban-cli    # 需要 Node.js 22.13+，也可以不装，用 npx @marvae24/douban-cli

douban movie 沙丘                      # 片名或 ID 都行，附相似推荐
douban comments 沙丘 -n 10             # 热门短评
douban book info 9787536692930         # 书名、ISBN 或 ID
douban list 240962                     # 读取豆列

douban login                           # 读取浏览器里已有的豆瓣登录
douban export -o my-movies.json        # 备份自己的看过/想看/在看（书单用 book export）
douban book mark 2567698 --read --dry-run   # 先预览，确认后去掉 --dry-run
```

## 命令一览

| 分类 | 命令 |
|---|---|
| 电影与剧集 | `trending` `hot` `tv` `rank` `top250` `now` `coming` `weekly` `search` `movie` `rating` `comments` `reviews` |
| 图书 | `book top250` `chart` `new` `search` `info` `rating` `comments` `reviews` `notes` |
| 用户与豆列 | `me` `book me` `user` `book user` `list` `config` |
| 账号与备份 | `login` `whoami` `logout` `record` `stats` `export`，图书加 `book` 前缀 |
| 修改记录 | `mark` `rate` `comment` `unmark`，图书加 `book` 前缀；`review` `follow` `unfollow` |
| 诊断 | `doctor` |

每个命令都可以用 `douban <命令> --help` 查看参数。详细说明：[命令参考](docs/commands.md) · [登录、修改与导出](docs/account.md) · [脚本与排查](docs/scripting.md)

## 安全与隐私

- 修改记录时只改你指定的内容，原有评分、标签和“仅自己可见”都会保留，也不会发到广播。
- 公开查询不读取 Cookie。登录只保存豆瓣登录所需的两项，按本机身份加密存放，30 天后失效，`douban logout` 立即删除。
- 非官方工具，请控制请求频率。被限流时它会明确告诉你，而不是返回空结果。

## 开发

```bash
npm ci
npm run verify   # lint、类型检查、单元测试、构建和 CLI 冒烟测试
```

代码结构与约定见 [AGENTS.md](AGENTS.md)。

## License

MIT

觉得有用的话，点个 ⭐ Star，让更多人找到它。
