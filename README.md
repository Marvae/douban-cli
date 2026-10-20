# douban-cli

[![npm version](https://img.shields.io/npm/v/%40marvae24%2Fdouban-cli.svg)](https://www.npmjs.com/package/@marvae24/douban-cli)
[![npm downloads](https://img.shields.io/npm/dm/%40marvae24%2Fdouban-cli.svg)](https://www.npmjs.com/package/@marvae24/douban-cli)
[![CI](https://github.com/Marvae/douban-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Marvae/douban-cli/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

在终端和 AI 里用豆瓣：查电影、剧集、图书和豆列，备份自己的观影和读书记录，让 AI 帮你标记、评分、写短评。

Use Douban from your terminal or AI agent: movies, TV shows, books, doulists, and your own records.

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

- 🪶 **不用安装**：有 Node.js 就能用 `npx` 直接运行。只有 2 个依赖，不启动浏览器，也不需要申请 API key。
- 🤖 **交给 AI**：装上 Skill，直接说“今晚看什么”“把《三体》标成读过，评 5 星”。改动账号前会先给你看预览。
- 💾 **备份你的豆瓣**：一条命令把看过、想看、在看和书单导出成 JSON、CSV 或 Markdown。
- 🔎 **想查就查**：片名、书名、ISBN 直接查评分、短评、书评和相似推荐；Top250、正在热映、豆列都能看。

## 在 AI agent 里使用

把这句话发给你的 agent（ChatGPT / Codex、Claude Code、pi 等）：

> 安装这个 skill 并帮我配置好：https://github.com/Marvae/douban-cli/tree/main/skills/douban-cli

或者在终端安装：

```bash
npx skills add Marvae/douban-cli          # 安装到本机支持 Agent Skills 的 agent
pi install npm:@marvae24/douban-cli       # pi：同时装好 Skill 和 CLI
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
douban export -o my-movies.json        # 备份自己的看过/想看/在看
douban book mark 2567698 --read --dry-run   # 先预览，确认后去掉 --dry-run
```

## 命令一览

| 分类 | 命令 |
|---|---|
| 电影与剧集 | `hot` `tv` `rank` `top250` `now` `coming` `weekly` `search` `movie` `rating` `comments` `reviews` |
| 图书 | `book top250` `chart` `new` `search` `info` `rating` `comments` `reviews` `notes` |
| 用户与豆列 | `user` `book user` `me` `list` `config` |
| 账号与备份 | `login` `whoami` `logout` `stats` `export` `book export` |
| 修改记录 | `mark` `rate` `comment` `unmark` `record`，图书加 `book` 前缀；`review` `follow` `unfollow` |
| 诊断 | `doctor` |

每个命令都可以用 `douban <命令> --help` 查看参数。详细说明：[命令参考](docs/commands.md) · [登录、修改与导出](docs/account.md) · [脚本与排查](docs/scripting.md)

## 安全与隐私

- 修改记录时只改你指定的内容，原有评分、标签和“仅自己可见”都会保留，也不会发到广播。
- 公开查询不读取 Cookie。登录只保存豆瓣登录所需的两项，加密存在本机，30 天后失效，`douban logout` 立即删除。
- 非官方工具，请控制请求频率。被限流时它会明确告诉你，而不是返回空结果。

## 开发

```bash
npm ci
npm run verify   # lint、类型检查、单元测试、构建和 CLI 冒烟测试
```

代码结构与约定见 [AGENTS.md](AGENTS.md)。

## License

MIT
