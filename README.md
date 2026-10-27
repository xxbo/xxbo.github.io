# 观潮 · XXBO personal dashboard

A buildless personal finance and news dashboard hosted on GitHub Pages.

- Quotes: Tencent Finance snapshot; each card retains the provider's quote time.
- News: Google News RSS searches with The Verge, BBC Chinese RSS and EastMoney fast-news fallbacks. Titles and source links only; no generated summaries.
- Economic calendar: official NBS, BLS, BEA and FOMC schedules; known release times convert to Beijing time, date-only meetings retain their source dates. Independent source health, 30-day history and a 45-day schedule window. Eastmoney adds global indicator actual/forecast/previous values in native units, with its own source status.
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
新闻标题默认打开原地阅读浮窗，支持 Escape、关闭按钮和点击遮罩关闭；修饰键点击仍可打开独立站内详情。华尔街见闻、爱范儿、极客公园使用官方 RSS 提供的内容，不抓取文章页；内容转为纯文本，保留段落，完整保留来源提供的正文，不按字数截取。财联社等只提供摘要的条目如实展示摘要，原文链接由用户按需打开。浮窗支持本机收藏、笔记，关闭保留浏览位置。

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

保留过去 30 天至未来 45 天计划。BLS 的 US-Eastern 映射到 America/New_York，按夏令时规则换算；BEA UTC 同样换算到北京时间。FOMC 仅会议日期时不猜测声明发布时间，保留美国当地日期范围。取消的 ICS 事件剔除，折行及转义按日历格式解析。每个来源独立状态，失败只沿用该来源上次成功记录，过期日程清理，成功空窗口与抓取失败分开处理。

官方来源仍只提供发布安排；新增 `scripts/calendar_results.py` 采集东方财富公开经济日历过去 30 天至未来 14 天的逐项指标，展示公布值、预期、前值及原始单位。来源未提供统计期或前值修订标识，不推算。23:59 占位时刻按仅日期处理；有公布值才标记已公布，零值有效，时点已过且无值则显示未取得。单独来源状态及失败缓存；按周查询并校验分页完整性、未来公布值和时区，所有分片成功才覆盖缓存。首次取得值的采集时间与后续数值修订分别保留（最多六次），不是官方实际发布时间。官方报告安排与数据商指标不跨来源强行合并。不覆盖全球所有经济数据、公司财报及临时活动。主线与日程采用明确的宏观背景关联规则，可查看关联理由。

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


### 界面与阅读体验整改
- 首页按速读、行情、要闻与日程、技术、自选主线、个性推荐顺序组织。公共要闻只保留一个主要展示区；主线每条展示一个事件，并与公共要闻和个性推荐去重。首页继续浏览缩为三篇，完整列表在新闻雷达分页查看。
- 固定导航提供概览、市场、资讯、事件和主线；工作台菜单在手机和桌面均提供经济日历、收藏、阅读偏好和数据健康。所有既有 hash 链接及本机数据键保持可用。
- 舒展／紧凑密度、16–22px 阅读字号保存在 current:layout，默认 18px。去掉外部字体请求，使用系统中文字体；提高正文和元数据的字号、对比度，缩短卡片长摘要。
- 阅读浮窗提供同列表上一篇／下一篇、左右方向键、事件与报道内部返回、恢复队列及滚动位置；输入笔记或选中文本时方向键不切篇。原生 dialog 保留 Escape 关闭和焦点约束，关闭后恢复触发位置；手机使用全屏阅读。
- 浏览器已实际检查桌面布局和 390px CSS 视口、浮窗切篇、事件档案往返及关闭恢复焦点。窄屏检查通过 iframe 视口进行，未模拟真实移动操作系统。
- 本轮不包含已取消的提醒功能。

### 可切换的高对比主题

顶部主题按钮提供清晰白（默认）、暖纸、冷蓝和极夜四套主题。主题贯穿首页、详情、表单、图表文字及阅读浮窗，保存于本机 `current:layout`，保留已有页面密度与阅读字号。首次绘制即读取主题，数据加载失败也可使用。正文、辅助文字、涨跌和提醒状态的语义色在对应背景上通过至少 4.5:1 的配色对比测试；来源与时间字号提高。运行 `node scripts/test_themes.cjs` 可验证主题配色、已存选择与非法值回退。

## 观潮 2.0：变化、研究与回看

- 首页提供五分钟速读（默认）、完整浏览和研究视角，本机记住选择；速读收起长信息流，完整模式保留原有主线、推荐和快讯。主题仍使用原有四套高对比配色。
- `#/changes`：分别列出新收录事件、来源内容修订、新增报道和市场变化。支持上次打开、上一存档日、七天前对照。报价比较是快照价格之比，不等于交易日涨跌幅；技术转换只比较推进后的完整日线。来源更换和报价时刻回退不生成误导性的转换或价差。首次使用及保留缺口明确显示；首页已展示的变化事件不会再铺进要闻、推荐或主线。
- `#/research`：新建研究问题，记录主线、额外关键词、当前判断、支持条件、改判条件和计划复核日；三份模板明确不是用户判断。主线及关键词仅生成可核对的相关线索，不自动推断新闻与价格的因果关系。
- 报道浮窗、事件档案和市场详情均可将当前内容放入研究问题的证据篮。摘录、源端时间、本站快照时间和个人注释留存本机，来源刷新不覆盖已存证据。不同时间的市场快照与不同活动版本的事件可分别留存；同篇报道不重复添加。
- 每次实质修改保留一版思路；个人复核记录与支持/挑战结论均由用户填写。问题可以归档、恢复，也可导出 JSON 备份。当前不提供跨设备同步和备份导入。最多 20 题，每题 30 条证据、30 版思路、30 次复核，超过思路/复核容量保留最近部分。清空浏览器数据会丢失个人研究。
- 事件档案增加规则关联的影响方向、相关市场和后续核对路径；来源说法、规则关联、个人判断分别标明。
- `#/review` 和 `#/review/YYYY-MM-DD` 展示日存档、近七日市场对照、当前趋势/动能分歧和本机复核记录。七天记录不足时不生成跨周结论。公共存档按快照日期回看，个人复核按当前时间回看。

### 日存档的数据路径

工作流在采集前后分别执行 `node scripts/archive_snapshot.cjs`：先保存上一份实际发布数据，再保存本轮数据。Python 收集器透传 `desk_history`；归档脚本复用前端相同的 `Technical`、`MarketContext` 与 `Brief` 规则，保留当时的技术结构及来源状态，避免事后重算改写历史。每个北京时间日期保留该日最后一次快照，最多 45 个实际观察日期，包含当时已接入的市场及六条要闻摘录；可能早于收盘，不是全市场和互联网历史。没有采集的日期不填充。归档只含公开数据，个人研究从不提交到 GitHub。

### 2.0 验证

`node scripts/test_desk.cjs` 验证日期对照、缺口、归档上限、内容修订、源切换、时刻回退、技术转换、不可覆盖的证据和版本记录；`test_dashboard.cjs` 覆盖新路由与原有初始化/阅读交互。原有技术、主线、日历、事件、阅读和数据源测试继续保留。浏览器已验证模板创建、证据留存、版本修改、复核保存和刷新恢复，检查极夜对比度及 390px iframe CSS 视口；未模拟实际手机操作系统。提醒功能仍暂停。

## 全球金融市场

`#/global` 提供 22 项观察：13 个股票指数（A股、港股、美国、日本、德国、英国、印度、澳洲），美元兑人民币、欧元兑美元、美元兑日元、美元指数，COMEX 黄金、WTI 与布伦特期货，以及美国 2 年/10 年期国债平价收益率。首页默认六项全球速览，可切中国市场和本机自选；完整看板支持资产与地区筛选，股票/汇率/期货可打开站内历史及技术背景，官方收益率有独立观测序列页。所有标的均可加入自选和研究证据篮。

- 全球 Yahoo 标的使用主、备用通道；两通道属于同一数据商，并非独立核验。美债使用美国财政部公开年度/月度 XML，两者为同一官方发布方。沿用既有校验、切源、旧数据保留与健康审计。新增标的首次失败留空，不生成演示数据。
- 报价显示北京时间；原始时区和源端时刻保留于数据。日本 15:30、德国 17:30、英国 16:30、印度 15:30 等本地收盘窗口与 DST 通过 ZoneInfo 处理。外汇和期货最新当地日期的日线保守排除至当地日期结束；尚未建立完整交易所节假日/夜盘日历。
- 汇率保留 3–4 位小数并说明基础/计价货币方向；收益率使用年化百分比，变化使用 bp。10Y−2Y 利差仅比较共同观测日。官方日期数据不补造报价时刻，也不伪造 OHLC、成交量或股票式技术指标。
- 商品明确为 Yahoo 所列期货合约，而非现货；来源有合约名称时一并显示，滚动换月可能造成跳变。本站不将其自动归因为新闻影响。
- Yahoo 日线中全部 OHLC 都为空的缺失观测不当作有效日线。外汇 OHLC 校验失败时，可退到同源真实收盘序列：仅留 date/close，明确无 OHLC，ATR 与量价指标不计算，不伪造开高低收或拼接跨源量能。
- 新增 `test_global.py` / `test_global.cjs` 覆盖代码匹配、日期与收盘边界、FX 精度、基点与利差共同日期、日期型利率无伪造时刻、纯收盘序列不补 OHLC。原有测试继续运行。

数据说明：[Yahoo 全球指数](https://finance.yahoo.com/markets/world-indices/)、[汇率](https://finance.yahoo.com/markets/currencies/)、[商品期货](https://finance.yahoo.com/markets/commodities/)、[美国财政部 XML 文档](https://home.treasury.gov/treasury-daily-interest-rate-xml-feed)。

### Economic calendar results

`node scripts/test_calendar.cjs` and `python -m unittest discover -s scripts -p "test_*.py"` cover zero/negative values, missing forecasts, percentage-point differences, explicit Beijing date-only rows, 30-day retention, response truncation, future values, revisions and cache preservation. Public result feed: https://np-listapi.eastmoney.com/sec/economiccalendar/findByDateRange (queried with startDate, endDate and req_trace, as used by the publisher calendar). The site uses scheduled snapshots, not a real-time release terminal.

### A 股报价直连与时效切换

`live-quotes.js` 在打开页面、手动刷新，以及页面可见的工作日 09:25–15:35 每分钟尝试直连三个固定 A 股指数。来源为腾讯 → 新浪 → 东方财富；读取的是各来源自身的报价时间，校验指数身份、有限点位、时间回退和未来时间。盘中落后超过五分钟时继续检查备用源；午间对照上午收盘，收盘后要求报价至少覆盖 14:59:50，避免把 14:56 当作收盘报价。工作日不是已核验的交易日；全源较早时保留最新可核验报价并提示可能休市或延迟。浏览器网络、广告拦截或来源策略可能影响直连；全部失败时保留后台快照，不改写采集时间。

直连仅覆盖报价，不改写新闻、经济日历、日线或后台 `generated_at`。页面分别标注直连检查时间、源端行情时间和资讯快照时间。本机检查在数据健康中明确标注。本机自选、研究和阅读记录不发送给报价接口；请求三个固定公开指数代码。

后台 A 股报价增加东方财富（腾讯 → 新浪 → 东方财富 → Yahoo）；不够新时继续检查下一源，全源都较早时择新并提示，不因休市而强制清空。额外安排北京时间工作日 15:05 / 15:15 收盘补采。GitHub Actions 定时任务可能延迟，收盘补采不是准点保证，页面直连独立于其运行。`test_live_quotes.cjs` 与 `test_quote_freshness.py` 验证失效切换、旧主源、收盘校验、午休、周末、时间回退、缓存保留与不覆盖日线/新闻。

### 单列首页信息流

首页改为 `feed.js` 组织、`home-feed.js` 展示、`feed.css` 隔离样式的单列信息流：大盘概况、逐条报道、事件跟进、经济公布值和技术观察。综合流穿插不同信息；筛选保留市场 / 新闻 / 事件 / 日历，初始 18 条，继续浏览增加 12 条。事件按现有档案聚合，相同标题和去追踪参数后的同一链接不重复铺开；纯同题转载不当作新的事件进展，来源内容修订可进入事件卡。报道显示源端发布时间，日历保持统计数据与计划时点，报价和完整日线各自标时。

旧看板栏目从首页隐藏，全球市场、新闻雷达、研究桌、变化清单等独立路由和本机数据继续可用。报道、事件保留站内浮窗，收藏与已读状态同步，不在阅读关闭时重建整条信息流。四个高对比主题保留，手机使用同样的单列结构。`test_feed.cjs` 检查事件/链接去重、发布时点、空数据、零值和分类筛选；`test_dashboard.cjs` 保留初始化、内页和阅读交互验证。

### 首页分栏阅读

首页卡片在同一页面打开详情：桌面左侧保留信息流，右侧为非模态详情列，没有遮罩、背景滚动锁或焦点圈闭。新闻与事件复用阅读器，行情、技术图表、经济日历及相关站内链接也可在右侧切换，地址栏保留首页。原有详情地址继续支持直接访问；独立页面的阅读器不受影响。

`split-reader.js` 管理详情历史、选中卡片和滚动锚点。左右可独立滚动；收起恢复信息流布局。行情周期、技术叠加和对照控件复用原事件处理器，原位刷新右侧；浏览器报价刷新时更新已打开的行情详情。小于 1000px 时在同一页面原位展开详情，返回恢复之前的信息流位置。原有收藏、笔记、字号、事件追踪与研究留存继续可用。集成测试检查非模态开启、地址不变、图表切换、详情历史和收起。

### RSS 配图

现有 RSS/Atom 采集同时提取 Media RSS、image enclosure、正文 HTML 的图片（含常见懒加载字段），不限制每条报道的图片数量，保留源中提供的替代文字、图注和署名。不抓取文章页、不增加新闻源、不生成配图。封面优先使用媒体字段，按 URL 去重，仅过滤追踪像素、已知追踪地址和非 HTTP(S) 地址，保留正文中的小图和标志图；HTTP 图片使用 HTTPS，加载失败则自动隐藏。首页显示小封面，分栏阅读器按来源正文段落位置展示配图，报道详情也展示配图。图片仍由原媒体托管，原源缺图或防盗链时保留文字阅读；懒加载且不发送 Referer。图片字段随事件报道保留，单独补图不会被记成文字内容修订。

RSS 详情不再按图片数量或正文字数截取；首页仍使用封面和简短摘要，详情中的全部图片按段落穿插、懒加载。独立报道页与分栏阅读器共用同一完整正文渲染。旧缓存若仍带截取标记会如实说明，成功重采集后移除标记。

### 一分钟分时与轻松阅读

首页“大盘概况”的 A 股、港股、美股使用 `intraday.points` 中真实的一分钟观察值，不再显示日线缩略图。A/港优先腾讯分时、东方财富备用，美股后台使用 Yahoo 的 `interval=1m`；浏览器以 JSONP 直连 A/港腾讯和东方财富（美股尝试 Yahoo，受浏览器跨域限制时保留后台分钟快照）。初次加载、刷新和切换地区时更新，页面可见且所选市场处于开盘时段时每 60 秒检查。主备都失败时保留原分时并标明缓存，不将单个报价扩展成分时、不插值缺失分钟。各条曲线保留交易日期、最后分钟、当地时区和源名；未开盘时显示最近交易日，行情源仍可能有延迟。图中虚线是来源前收盘，鼠标悬停分钟点显示时间和点位。后台分时独立纳入来源健康记录，日线和技术分析继续使用原来的完整日线。首页“全球主要资产”卡片仍采用原有日频序列。

“换换脑子”采用少数派（数码）、机核（游戏）、DPReview（摄影，英文）的 RSS，主源失败后使用对应媒体的新闻检索备用。每类采集最多六条近期报道，全文配图沿用完整 RSS 阅读器。首页大约每六条新闻穿插一条轻松内容，提供独立筛选；休闲报道不进入财经事件聚合。

### 中文杂志式的“换换脑子”

休闲来源配置集中在 `scripts/leisure_sources.py`：少数派、机核、奇客 Solidot、泛科学、研之有物、阮一峰的网络日志、小众软件、理想生活实验室、游研社、触乐、书伴和一天世界。覆盖数码、游戏文化、科学、人文、工具、生活、故事、文化随笔和阅读，包含简体与繁体中文；移除 DPReview 英文源。采集与首页均检查中文标题，备用检索不以英文报道补位，不进行机器翻译。

RSS 与 Atom（含 XHTML 正文）共用采集器，保留原始发布日期、全部正文及有效配图。每源采集十条，休闲长文可展示最近三十天的内容，财经新闻仍保持七天窗口。首页按来源轮换、URL/标题去重，取消原有十二条展示上限，继续浏览可以加载其余可用文章。综合流仍少量穿插休闲内容，独立“换换脑子”筛选展示全部已收录的有效中文文章。来源失败有站内域名限定的检索备用和缓存状态。
