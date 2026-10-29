# 轨道都市 · Map 03

A buildless, map-first rail editor at `/rail/index.html`. This version replaces the company/finance/construction dashboard UI with one full-screen map. Vehicles render as moving coloured dots. Only line creation/deletion are primary global actions; selecting a route opens its details.

## Visible interactions

- Select a map route or legend entry to inspect it. Drag and zoom the map; pause or speed up operations with the compact clock control.
- Create a route by clicking existing candidate stations or free map locations. The draft is reversible and commits only on confirmation.
- Insert a station near a segment or extend beyond an endpoint. Remove a station from the map or selected route's list; adjacent segments reconnect. Other lines retain their stops.
- Configure even fleet sizes (2–80 trains), 4/6/8-car formations, target headway and operating hours. Fleet availability constrains effective headway. Capacity and service windows affect live dispatch.
- Inspect per-line synthetic weekday boardings, revenue, expense, net operating result and per-station board/alight counts. Revenue is distance-allocated across ridden services. Expense estimates comprise train-km operations, configured fleet upkeep and line maintenance. All forecast figures are estimates, not observed Tokyo data or live farebox revenue.
- Delete a line with an inline confirmation. Unused track infrastructure is pruned; shared stations and other lines remain. The last committed edit can be undone from the transient toast.

## Persistence and model boundaries

This focused editor uses its own `guanchao-rail-map-v3` local save. Prior versions' saves are left untouched. It starts from a clean three-route layout rather than importing old multi-company through-service games into an incompatible editing workflow.

City growth, quarterly settlement, operator management, construction budgeting, track leasing, through-service controls, individual-train inspection and extra map layers are hidden in this version. Legacy engine functions remain available internally for backwards tests; they are not part of the visible map flow.

`engine.js` supplies the network and aggregate OD forecast. `operations.js` simulates individual bidirectional dot positions, station dwell, generated ride-leg queues, boarding, capacity, headways and operating windows. This is a simplified simulation rather than complete signalling, depot, rolling-stock or passenger-transfer modelling. Opening rebuilds the 07:00 representative scene after warm-up; editing replans it at the current displayed time. Backgrounding pauses operations.

`network.js` owns transactional map edits, route reconnection, extra free-positioned nodes, line forecasts and configuration validation. `ui.js`, `index.html` and `style.css` supply the minimal map interface. No external packages, API keys, map tiles or server are required.

## Verification

Run from the repository root:

- `node scripts/test_rail.cjs`
- `node scripts/test_rail_operations.cjs`
- `node scripts/test_rail_network.cjs`

The existing GitHub Pages workflow runs these tests and stages the complete `rail/` directory. Dashboard news and market functionality remain independent.

## MAP / 04 — 东京圈与运营总览

默认东京圈地图：2,900 × 2,100 世界单位、183 个真实站名、21 条主要线路服务、180 个初始运营站。参照 [JR 东日本主要路网](https://www.jreast.co.jp/e/downloads/) 与 [Tokyo Metro 路网](https://www.tokyometro.jp/lang_en/station/index.html)，手工整理近似站点经纬度后以局部等距比例投影。地图面积约为旧地图的 7.9 倍；站点、海岸、河流、公园均为简化地理示意。主要站点节选存在跳站、同站合并；未完整复刻实际线路、停站、直通或快慢车。机场走廊、JR 通勤干线、主要私铁及五条地铁作为游戏骨架。站名按优先级与屏幕碰撞检查分层，支持全域/都心、站名开关和距离标尺。

运营总览在同一地图右侧展示全部线路，可按客流/结余排序，点击进入线路编辑。在线车辆实时统计，客流/财务为既有工作日模型预测。全网乘车人次为线路乘车人次之和（换乘重复计次），线路公里是服务里程之和（含共线服务），收入按每段乘坐距离分配；不是独立旅客数或物理轨道总里程。所有人口、班次、编组、客流与财务均为游戏参数，不能作为真实运营统计。模型的公司层仍使用原先三个虚构账户，地图路线名不代表实际运营公司已完成财务建模。

东京圈独立存档 `guanchao-rail-map-v4`。右上角地图选择器可回到原 `guanchao-rail-map-v3` 旧版实验地图，分别保存，保留原有建设记录。东京圈最多 400 个站点、单线 60 个站点、30 条线路；旧地图维持原限制。路径搜索改用二叉最小堆，保持广义出行成本模型与容量约束。新增验证 `node scripts/test_rail_tokyo.cjs`。
