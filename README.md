# 观潮 · XXBO personal dashboard

A buildless personal finance and news dashboard hosted on GitHub Pages.

- Quotes: Tencent Finance snapshot; each card retains the provider's quote time.
- News: Google News RSS searches with The Verge, BBC Chinese RSS and EastMoney fast-news fallbacks. Titles and source links only; no generated summaries.
- Economic calendar: official NBS, BLS, BEA and FOMC schedules; known release times convert to Beijing time, date-only meetings retain their source dates. Independent source health and a 45-day window; no consensus or actual release values.
- Watchlist, reading status and saved items: localStorage on the current browser. No private holdings are published.
- Scheduled snapshot: `.github/workflows/refresh-dashboard.yml`, every 20 minutes at minutes 7/27/47, plus manual dispatch. GitHub scheduling can be delayed.

## Refresh locally

Python 3.10+; standard library only:

```sh
python scripts/update_data.py
```

Successful sources replace their own snapshot. Failed sources preserve prior data and expose status; fetch timestamps do not imply live market data. The refresh button only reloads the most recently published JSON; it does not trigger a new server-side fetch.

## Deployment

Set Pages source to **GitHub Actions**. The workflow uploads only `index.html`, `style.css`, `app.js`, `pages.js` and `data/` as the Pages artifact. Script/workflow changes trigger a refresh; manual dispatch also publishes changes to the UI.

## References

The data-source mapping, explicit provenance and cached-snapshot design were informed by [CNEquity](https://github.com/rootSunc/CNEquity). This project uses its own small collector rather than copying CNEquity's code or distributing its data lake. Source availability, formats and usage conditions are controlled by their respective providers. News categories are based on search queries and simple keyword rules, not editorial fact checking.


## Internal pages

Hash routes remain on GitHub Pages and work with refresh, direct links and browser back/forward:

- `#/overview`, `#/news/全部`, `#/news/科技`, `#/watch`, `#/saved`
- `#/news/<category>/article/<id>`: source metadata, available source excerpt, related articles, local personal notes and an explicit external full-article link
- `#/markets/<id>`: quote, daily close chart, period selector, watchlist action
- `#/markets/<id>/history`: daily close records
- `#/calendar`, `#/calendar/<event-id>`: calendar and individual event information when provided

Most feeds supply only titles and links; the site clearly indicates when no excerpt/body is available. It does not embed or claim to host source articles. The most recent 100 opened articles and personal notes are retained only in the current browser.


## Technical analysis and editorial feeds

- 320 daily bars requested per index; Tencent's `us.IXIC` history identifier is used for the Nasdaq Composite while its quote identifier remains `usIXIC`.
- Completed daily bars only for technical calculations; same-day incomplete A/HK/US bars are marked `partial` using the relevant market timezone and close hour. Quotes are still snapshots.
- Simple MA5/10/20/60/120, Wilder RSI14 and ATR14, SMA-seeded EMA MACD12/26/9 (histogram multiplied by 2), BOLL20 with population standard deviation, relative source activity, 20-day sample volatility annualized by sqrt(252), and 60-day peak distance. Flat-series RSI convention: 50.
- Formula-driven observations describe observed trend, momentum and volatility, without price forecasts or buy/sell scores. Raw source activity units are not normalized across markets.
- CLS home page's public `top_article` and `hotArticleData` lists are labeled separately as homepage headlines and popular reports. WallstreetCN's official RSS is labeled publisher news, not an inferred headline ranking. News search results and EastMoney flash wire have separate types.
- Only brief source excerpts (up to 180 characters) accompany source links; no full articles are mirrored.


## Daily reading homepage

The homepage presents regional quote observations, a technical summary for each selected watchlist index, a diverse set of recent publisher reports, and the latest flash wire. Regional counts refer only to the small tracked index sample, never to full-market breadth. US, Hong Kong and mainland quotes retain their own timestamps. Headlines are selected from publisher lists; no causal market impact is inferred from adjacent news.

The update workflow is scheduled every 20 minutes. Daily history is cached for up to 6 hours within the same market date/open-or-closed phase and refreshed across phase changes. Quote and news snapshots refresh independently of historical bars. Schedule timing is approximate; front-end refresh reloads the latest published data.

## RSS 浮窗阅读
新闻标题默认打开原地阅读浮窗，支持 Escape、关闭按钮和点击遮罩关闭；修饰键点击仍可打开独立站内详情。华尔街见闻、爱范儿、极客公园使用官方 RSS 提供的内容，不抓取文章页；内容转为纯文本，保留段落，最多 14,000 字符并标明截取。财联社等只提供摘要的条目如实展示摘要，原文链接由用户按需打开。浮窗支持本机收藏、笔记，关闭保留浏览位置。

## 有依据的首页简报与事件记录
- `brief.js` 提供纯函数：采集时效、事件选择、上次访问对照、技术验证条件；不调用模型、不推断新闻对涨跌的因果。首页区分源端摘录与指标规则，支持展开依据。
- `scripts/event_digest.py` 使用规范化标题和三字片段相似度进行保守聚合，数字不一致不合并、候选发布时间相距不超过 48 小时。保持最初标题作为锚点以避免传递合并。可能误合并或漏合并，新闻列表可关闭聚合。
- `data/dashboard.json` 中的事件历史保留最近七天，最多 300 个事件，每事件最多 12 篇精简报道及 24 次收录/内容变更记录。不保留全文历史；重新采集、来源列表顺序变化不算新进展。时间是本站观察时间，不能当作事件发生时间或事实核实。
- 浏览器保存上次访问快照时间与六个指数报价。一次访问期间刷新仍使用进入页面前的对照；首次访问建立基线，超出保留范围会说明覆盖缺口。清除本机存储会重置。
- 采集成功、最近内容变化、源端报价时间与完整日线日期分别展示。采集超过 45 分钟提示延迟，超过两小时提示过期；来源失败标记沿用旧数据。非交易时段不将报价年龄直接认定为故障。

## 关注主线与官方经济日历
默认关注 AI 与算力、半导体、双创、港股科技、国内宏观政策；可在首页管理关注。关注列表保存在本机。主线以标题和来源摘要关键词匹配七天事件记录，展示匹配理由、相对上次访问的新收录和变更，以及相关官方日程；并非语义事实核验或对指数的因果归因。独立路由为 `#/topics`、`#/topics/<id>`，报道继续浮窗阅读。

日程采集由 `scripts/economic_calendar.py` 独立处理，公开来源包括：
- 国家统计局发布日程索引 https://www.stats.gov.cn/xxgk/sjfb/fbrcb/ ：动态发现本年度表格，展开行列合并后对应日期和时刻。
- BLS 官方 ICS https://www.bls.gov/schedule/news_release/bls.ics
- BEA 官方 ICS https://www.bea.gov/news/schedule/ics/online-calendar-subscription.ics
- FOMC 官方会议日期 https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm

保留今天至未来 45 天计划。BLS 的 US-Eastern 映射到 America/New_York，按夏令时规则换算；BEA UTC 同样换算到北京时间。FOMC 仅会议日期时不猜测声明发布时间，保留美国当地日期范围。取消的 ICS 事件剔除，折行及转义按日历格式解析。每个来源独立状态，失败只沿用该来源上次成功记录，过期日程清理，成功空窗口与抓取失败分开处理。

日历为发布计划，不提供市场预期或实时公布值，时点已过也不认定数据已发布。不覆盖全球所有经济数据、公司财报及临时活动。主线与日程采用明确的宏观背景关联规则，可查看关联理由。
