# douban-cli

Douban CLI - browse movies, TV shows, search, and movie details from the terminal.

豆瓣命令行工具：在终端查看热门电影/剧集、排行榜、Top250、正在热映、用户片单、搜索与电影详情。

## Features / 功能

### Movies / 电影
- 🔥 **Hot / 热门** - Trending movies and TV shows
- 📺 **TV / 剧集** - TV lists by tag (美剧/日剧/韩剧/国产剧/综艺)
- 🏆 **Rank / 排行** - Top movies by genre
- 🎬 **Top250** - Douban Top 250 movies
- 🍿 **Now Playing / 热映** - In-theater movies by city
- 📅 **Coming / 即将上映** - Upcoming movies
- 📈 **Weekly / 一周口碑** - Weekly reputation chart
- 🔍 **Search / 搜索** - Search movies by keyword
- 🧾 **Movie / 电影详情** - Rating, directors, actors, summary
- ⭐ **Rating / 评分分布** - Rating distribution (5-star breakdown)
- 💬 **Comments / 短评** - Hot short comments
- 📝 **Reviews / 长评** - Long-form reviews

### Books / 书籍
- 📚 **Book Hot / 热门书籍** - Top 250 books
- 🔍 **Book Search / 书籍搜索** - Search books by keyword
- 📖 **Book Info / 书籍详情** - Book details

### Others / 其他
- 👤 **User / 用户片单** - Watched / wish / doing lists
- 🎭 **Celebrity / 影人** - Celebrity details
- 🗂️ **List / 片单** - Hot douban lists
- ⚙️ **Config / 配置** - Set default user ID
- 👋 **Me / 我的** - Quick access to your collection

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

### Rating / 评分分布

```bash
# 查看评分分布（5星/4星/3星...占比）

douban rating 1291546
```

### Comments / 短评

```bash
# 热门短评

douban comments 1291546

# 最新短评

douban comments 1291546 --latest
```

### Reviews / 长评

```bash
# 热门影评

douban reviews 1291546 --limit 5
```

### Coming / 即将上映

```bash
douban coming --limit 10
```

### Weekly / 一周口碑

```bash
douban weekly
```

### Book / 书籍

```bash
# 热门书籍

douban book hot

# 搜索书籍

douban book search "三体"

# 书籍详情

douban book info 2567698
```

### Celebrity / 影人

```bash
douban celebrity 1054395
```

### List / 片单

```bash
douban list --limit 10
```

### Config / 配置

```bash
# 设置默认用户 ID

douban config --user YOUR_USER_ID

# 然后可以直接用 me 命令

douban me
douban me --wish
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
