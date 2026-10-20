# douban-cli

[![npm version](https://img.shields.io/npm/v/%40marvae24%2Fdouban-cli.svg)](https://www.npmjs.com/package/@marvae24/douban-cli)
[![npm downloads](https://img.shields.io/npm/dm/%40marvae24%2Fdouban-cli.svg)](https://www.npmjs.com/package/@marvae24/douban-cli)
[![CI](https://github.com/Marvae/douban-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/Marvae/douban-cli/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

豆瓣的命令行工具：查电影、剧集、图书、豆列和用户收藏，登录后管理自己的标记、评分、短评和标签。在终端里显示表格，也能以 JSON 交给脚本和 AI agent。

Unofficial Douban CLI for movies, TV shows, books, doulists and your own Douban records — for people, scripts and AI agents.

## 在 AI agent 里使用

把这句话发给你的 agent（ChatGPT / Codex、Claude Code、pi 等）：

> 安装这个 skill 并帮我配置好：https://github.com/Marvae/douban-cli/tree/main/skills/douban-cli

也可以在终端安装：

```bash
npx skills add Marvae/douban-cli          # 安装到本机支持 Agent Skills 的 agent
pi install npm:@marvae24/douban-cli       # pi：同时装好 Skill 和 CLI
```

之后直接提要求就行，例如“最近在上映的电影里哪些评分超过 7.5？”“把《三体》标成读过，评 5 星，仅自己可见”。

- Skill 会在需要时帮你安装 CLI（需要 Node.js 22.13+）。
- 账号功能需要你在自己的终端里运行一次 `douban login`，它会读取浏览器里已有的豆瓣登录。
- 修改账号前，agent 会先预览改动，经你确认后才提交。

## 自己在终端使用

```bash
npm install -g @marvae24/douban-cli    # 需要 Node.js 22.13+；或用 npx @marvae24/douban-cli <命令>

douban now                             # 正在热映
douban movie 沙丘                      # 电影详情，可用 ID 或片名，附相似推荐
douban comments 沙丘 -n 10             # 热门短评
douban book info 9787536692930         # 图书详情，可用 ID、ISBN 或书名
douban list 240962                     # 读取豆列
douban login                           # 登录后可标记、评分、写短评
douban book mark 2567698 --read --private --dry-run   # 先预览，确认后去掉 --dry-run
```

所有命令都支持 `douban <命令> --help`。

## 能做什么

| 分类 | 命令 |
|---|---|
| 电影与剧集 | `hot` `tv` `rank` `top250` `now` `coming` `weekly` `search` `movie` `rating` `comments` `reviews` |
| 图书 | `book top250` `chart` `new` `search` `info` `rating` `comments` `reviews` `notes` |
| 用户与豆列 | `user` `book user` `me` `list` `config` |
| 账号 | `login` `whoami` `logout` `stats` `export` `book export` |
| 写入（电影和图书） | `mark` `rate` `comment` `unmark` `record`，图书加 `book` 前缀；`review` `follow` `unfollow` |
| 诊断 | `doctor` |

详细说明：[命令参考](docs/commands.md) · [登录、写入与导出](docs/account.md) · [脚本化、分页与排查](docs/scripting.md)

## 特点

- **输入随意**：电影可用 ID 或片名，图书可用 ID、ISBN 或书名；详情附“喜欢这部/本的人也喜欢”。
- **写入安全**：每次修改都先读取原记录，只改你指定的字段，再读回核对；不会清空原有评分、短评、标签或“仅自己可见”，从不分享到广播；支持 `--dry-run`、`--tags`、`--private`。
- **如实报告**：豆瓣限流时返回 `RATE_LIMITED`，不会伪装成“没有结果”；只取到部分数据时会提示。搜索会自动复用本地登录态，减少被限流。
- **适合程序调用**：`--json` 输出、稳定的错误码，提示信息写到 stderr，不影响 JSON 解析。
- **轻量**：2 个运行时依赖，不需要浏览器自动化。

## 隐私

- 公开查询不读取任何 Cookie。`douban login` 只读取豆瓣登录所需的 `dbcl2` / `ck`，加密保存在本机，30 天后失效，`douban logout` 立即删除。
- 只有你运行写入命令时才会修改账号。
- 这是非官方工具，请控制请求频率；被限流时稍后再试。

## 开发

```bash
npm ci
npm run verify   # lint、类型检查、单元测试、构建和 CLI 冒烟测试
```

代码结构与约定见 [AGENTS.md](AGENTS.md)。

## License

MIT
