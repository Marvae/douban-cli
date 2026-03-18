---
name: douban-cli
description: 豆瓣电影/书籍/用户收藏查询与标记 CLI。触发词：豆瓣、电影推荐、热门电影、想看什么、top250、美剧日剧韩剧、影评短评、标记看过、评分。
---

# douban-cli

豆瓣电影/书籍/用户收藏查询与标记。

## 安装

```bash
npm i -g @marvae24/douban-cli
```

需要 Node.js >= 22。

## 命令

### 浏览
- 热门电影: `douban hot`
- 热门剧集: `douban hot --tv`
- 分类剧集: `douban tv 美剧` / `日剧` / `韩剧` / `国产剧`
- 类型排行: `douban rank 科幻` / `动作` / `爱情` / `悬疑`
- Top 250: `douban top250`
- 正在热映: `douban now`
- 即将上映: `douban coming`
- 一周口碑: `douban weekly`
- 搜索: `douban search 盗梦空间`
- 详情: `douban movie <id或片名>`
- 短评: `douban comments <id>`
- 影评: `douban reviews <id>`
- 评分分布: `douban rating <id>`

### 书籍
- 热门书籍: `douban book hot`
- 搜索书籍: `douban book search 三体`
- 书籍详情: `douban book info <id>`

### 用户
- 用户片单: `douban user <userId>`
- 我的片单: `douban me`
- 配置: `douban config --user <id>`

### 登录与标记
- 登录: `douban login`
- 当前用户: `douban whoami`
- 登出: `douban logout`
- 标记想看: `douban mark <id> --wish`
- 标记看过: `douban mark <id> --watched`
- 取消标记: `douban unmark <id>`
- 评分: `douban rate <id> --score 5`
- 短评: `douban comment <id> "评论内容"`
- 长评: `douban review <id> "标题" "正文"`

### 社交与统计
- 关注动态: `douban feed`
- 观影统计: `douban stats --year 2024`
- 导出记录: `douban export --format csv -o records.csv`
- 关注用户: `douban follow <userId>`
- 取消关注: `douban unfollow <userId>`

## 提示

- 加 `--json` 输出 JSON
- 加 `--limit N` 控制数量
- 登录态从浏览器自动提取（Chrome/Edge/Firefox/Safari）
