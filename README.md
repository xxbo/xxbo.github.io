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

## 数据可靠性与自动切换（第一阶段）

采集统一经过 `scripts/data_health.py`：按候选顺序请求并校验，主源失败或数据不合格时使用备用；所有候选失败才沿用上次成功记录，保留原采集时间。下一次实际采集重新优先检查主源，通过后切回。日线仍按交易日/收盘阶段与六小时窗口复用，不把复用标成新抓取。

- 报价：逐指数采集/校验，腾讯 → 新浪（A 股/港股）→ Yahoo Finance。纳斯达克腾讯 → Yahoo；Yahoo 校验明确的 Composite 代码 `^IXIC`，不拿纳指 100 替代。腾讯和新浪批量请求在一次运行内合并，不重复请求六次。某个指数失败不会让其他指数丢失，也不再以“至少一个成功”判定整批正常。
- 日线：腾讯 → 新浪（A 股）或 Yahoo（恒指/纳斯达克）→ 腾讯备用通道。恒生科技使用腾讯备用通道；这只是同一供应商的备用入口，不作为独立数据源。每次替换整段历史，不拼接跨来源 OHLC/量能。检查至少 120 条样本、有限正点位、OHLC 高低关系、非负量能、日期回退/过旧、重复日线和长自然日间隔。自然日间隔警告尚未对照交易所休市日历，不能直接认定缺失交易日。
- 新闻：媒体自己的 RSS/首页 → Google 对该媒体的报道索引；保留真实媒体来源，索引备用标为检索聚合、不假称媒体首页头条。分类检索有爱范儿/The Verge、东方财富/华尔街见闻、BBC World 英文备用。快讯失败时可展示财经报道备用，但保留报道类型，不冒充实时快讯。检查标题、HTTPS 链接、可核验发布时间；未来日期和超过七天的候选剔除，最新报道超过 72 小时提示更新较慢。新闻来源类型/阅读内容类型独立记录；评论仅按标题词识别，非人工内容审查。
- 日历：BLS 官方 ICS → 官方 HTML → 圣路易斯联储 FRED 的 CPI、PPI、非农、JOLTS、雇佣成本日历。FRED 只覆盖核心指标，逐项标明覆盖差异，按 America/Chicago 转换而非误用美东时间。BEA ICS → 官方 JSON；国家统计局索引 → 上次验证过的官方表格直连。FOMC 暂仅官方会议日历及失败缓存，不用其他数据冒充独立备用。NBS 表格年份校验、已过覆盖期的 ICS 拒绝作为“正常空窗口”。跨 ICS/JSON/HTML 的日期标识尽量按指标与发布日稳定。
- 网络：10 秒超时；临时网络和 5xx 最多重试一次，403/404/429 直接转下一个候选，不反复重试。每个 URL 在单轮内共享响应/失败结果，响应上限 8 MB；校验后的 JSON 原子替换，避免半写文件。

`#/health` 展示主源/备用/失败缓存、当前提供者、候选顺序、检查耗时/原因、数据质量提醒、最近 12 次实际采集记录和最多 12 次状态切换。可从侧栏“数据来源与健康”或首页提示进入。状态记录不是可用性保证；未执行的备用候选不显示为已验证在线。原始采集、源端时点、日线日期仍分开展示。

验证包括单源不可达、字段/时间/数值异常、主源恢复、全部失败沿用原时间、部分指数故障隔离、整段历史替换，以及 BLS/FRED 夏令时与覆盖范围。`scripts/test_dashboard.cjs` 检查脚本加载顺序和站内路由渲染，不能代替浏览器布局验收。

线上容错补充：FRED 按指标独立请求，失败时尝试同属圣路易斯联储的 ALFRED 官方通道；ALFRED 页面未核验时刻时区时只展示日期，不推算发布时间。部分指标失败保留其他已取得条目并提示缺口，避免整组作废。

最后一级美国日程备用为 Forex Factory 官方提供的本周 JSON 导出（https://nfs.faireconomy.media/ff_calendar_thisweek.json）。它是媒体整理的本周美元日程，与 BLS 官方日程范围不同，页面标明媒体来源和较短覆盖范围，不将其视为完整 45 天 BLS 数据。按导出中明确的 UTC 偏移换算；不取用预期/前值字段，不推算没有公布的时刻。


### 事件追踪 v2
- 事件档案提供首次来源背景摘录、报道时间线、来源修订日志和主线观察清单。所有时间为采集观察时间，不是事实发生或核实时间。
- 跨分类相同标题、已知标题尾缀、长标题转载和保守近似标题会合并；不同数字、相反动作及跨日短行情播报避免误合。历史重复分组自动迁移，旧事件 ID 通过 aliases 继续可用，迁移不创建新的观察时间。
- 首页关注主线按轮次分配事件，每个事件只展示一次。单条主线仍能访问完整匹配列表；同一事件多家来源在档案中折叠。
- 服务端最多保留 30 天、800 个事件，每事件 24 篇报道、48 条日志，容量可能使窗口缩短。event_retention.truncated 表示曾有容量缺口。
- 浏览器可追踪最多 50 个事件、保存最近获得的档案及阅读检查点；不跨设备同步。新增来源与来源内容修订分开标识，均不等同于已核实的新事实。
- 完全改写标题的后续发展仍可能漏关联，此版本没有模型生成或事实核验。


### 市场分析上下文 v1
- 首页：六个观察指数的结构概览、自选阶段、最近五个日线区间变化，以及默认同市场价格指数对照。各指数保留独立完整日线日期，不充当全市场广度。
- 技术详情：MA20/60/120 位置、MA20 五区间斜率、连续收盘位置、最近五区间 MA20/MACD/RSI 状态切换、此前 20 根收盘范围，以及当前 20 日年化波动率在此前最多 252 个窗口中的分位（至少 60 个历史窗口，相等值取秩中点）。
- 相对强弱：默认创业板/科创50对上证、恒生科技对恒指，反向为风格对照；纳斯达克暂无同市场对照。可手动切换，5/20/60 段共同收盘日期需要 N+1 个共同日期，起点归一 100，不插值。跨市场不视为同时交易，均为本币价格指数，不含汇率或分红收益。
- 验证条件：连续两根完整日线在各自 MA20 上方且最新 MACD 柱正值，反向为偏弱条件；仅显示条件是否满足，不生成买卖建议、概率或目标价。
- 相关报道与日历按现有主线规则关联、提供出处，不能据此推定涨跌因果关系。
- 新增纯计算检查 scripts/test_market_context.cjs，并在整体页面 VM 检查中覆盖技术详情、跨市场对照与空数据。


### 本机阅读偏好 v1
- 首页增加“为你挑选”，公共要闻、市场数据、技术结论与经济日历的选择规则保持独立。推荐每事件一篇、单来源最多两篇，优先用末尾两个位置补充其他分类，不足时不凑数。仅推荐近三天有发布时间的媒体报道。
- 自动信号只记录打开：事件 ID、时间、新闻分类、匹配主线与来源；不保存正文、URL、笔记、停留时长或滚动轨迹。同事件在北京时间同一天最多一次，旧分组合并通过 aliases 去重。打开不等于读完或认同文章观点。
- 记录最多 400 条、90 天，14 天半衰期；隐式兴趣设上限。当前收藏与事件追踪直接参与较强加权，取消后不再贡献该项；默认全部关注主线不当作主动的差异化偏好。
- 多看／少看反馈最多 200 条、90 天，30 天半衰期；少看会避开该事件的首页推荐并降低相关主线（无主线时新闻分类）的排序权重，不屏蔽公共要闻和完整新闻列表。分类、主线及来源可手动设置多看或少看。
- #/preferences 提供暂停自动学习、查看近期倾向、撤销反馈、清除自动记录、重置阅读偏好。时间模式使用实际时间戳而非 ISO 字符串排序，处理 UTC 与北京时间混合时间格式。
- 所有偏好存在 localStorage 的 current:readingProfile，只在当前浏览器计算，不上传、不跨设备同步，不从历史 read 标记补造打开日志。自动学习暂停时仍使用已有记录和主动设置。
- tests: scripts/test_reading.cjs；整站 VM 覆盖偏好页、打开计数、暂停、反馈与重置，并核对偏好操作没有新增网络请求。
