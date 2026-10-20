# 观潮 · XXBO personal dashboard

A buildless personal finance and news dashboard hosted on GitHub Pages.

- Quotes: Tencent Finance snapshot; each card retains the provider's quote time.
- News: Google News RSS searches with The Verge, BBC Chinese RSS and EastMoney fast-news fallbacks. Titles and source links only; no generated summaries.
- Economic calendar: EastMoney adapter; currently returns no valid report, so the UI explicitly shows unavailable and links to the source page.
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
