# douban-cli

Douban CLI - browse movies, TV shows, search, and movie details from the terminal.

豆瓣命令行工具：在终端查看热门电影/剧集、排行榜、Top250、正在热映、用户片单、搜索与电影详情。

## Features / 功能

- 🔥 **Hot / 热门** - Trending movies and TV shows
- 📺 **TV / 剧集** - TV lists by tag (美剧/日剧/韩剧/国产剧/综艺)
- 🏆 **Rank / 排行** - Top movies by genre
- 🎬 **Top250** - Douban Top 250 movies
- 🍿 **Now Playing / 热映** - In-theater movies by city
- 👤 **User / 用户片单** - Watched / wish / doing lists
- 🔍 **Search / 搜索** - Search movies by keyword
- 🧾 **Movie / 电影详情** - Rating, directors, actors, summary

## Installation / 安装

```bash
npm install -g @marvae24/douban-cli
```

Or run directly / 或直接运行：

```bash
npx @marvae24/douban-cli hot
```

## Usage / 用法

### Hot / 热门

```bash
# 热门电影

douban hot

# 热门剧集

douban hot --tv

# 指定标签与数量

douban hot --tag 最新 --limit 10
```

### TV / 剧集

```bash
# 美剧 / 日剧 / 韩剧 / 国产剧 / 综艺

douban tv 美剧 --limit 10
```

### Rank / 类型排行

```bash
# 科幻 / 动作 / 爱情 / 悬疑 ...

douban rank 科幻 --limit 10
```

### Top250

```bash
douban top250 --limit 25
```

### Now Playing / 正在热映

```bash
# 默认北京

douban now

# 指定城市（北京/上海/广州/深圳/苏州/杭州/南京/成都/武汉/西安/重庆/天津）

douban now --city 上海
```

### User / 用户片单

```bash
# 看过

douban user YOUR_USER_ID

# 想看

douban user YOUR_USER_ID --wish

# 在看

douban user YOUR_USER_ID --doing
```

### Search / 电影搜索

```bash
# 搜索电影关键词

douban search "奥本海默"

# 分页

douban search "星际" --start 20 --limit 10
```

### Movie / 电影详情

```bash
# 按豆瓣 subject ID 查询

douban movie 35593344
```

### JSON Output / JSON 输出

```bash
# 所有命令均支持 --json

douban search "奥本海默" --json
douban movie 35593344 --json
```

## Tech Stack

- TypeScript
- Node.js 18+
- Commander.js

## License

MIT
