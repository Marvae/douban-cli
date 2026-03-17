---
name: douban-cli
description: 豆瓣电影/书籍/用户收藏查询 CLI。触发词：豆瓣、电影推荐、热门电影、想看什么、top250、美剧日剧韩剧、影评短评。
---

# douban-cli

豆瓣电影/书籍/用户收藏查询。

## 安装

```bash
npm i -g @marvae24/douban-cli
```

## 命令

- 热门电影: `douban hot`
- 热门电视剧: `douban hot --tv`
- 分类剧集: `douban tv 美剧` / `日剧` / `韩剧` / `国产剧`
- 类型排行: `douban rank 科幻` / `动作` / `爱情` / `悬疑`
- Top 250: `douban top250`
- 正在热映: `douban now --city 苏州`
- 即将上映: `douban coming`
- 一周口碑: `douban weekly`
- 搜索电影: `douban search 盗梦空间`
- 电影详情: `douban movie <id>`
- 短评: `douban comments <id>`
- 长评: `douban reviews <id>`
- 影人: `douban celebrity <id>`
- 热门书籍: `douban book hot`
- 搜索书籍: `douban book search 三体`
- 用户收藏: `douban user <userId>`
- 我的收藏: `douban me`（需先 `douban config --user <id>`）
- 热门豆列: `douban list`

## 提示

- 加 `--json` 输出 JSON
- 加 `--limit N` 控制数量
- 非官方 API，频繁请求可能封 IP
