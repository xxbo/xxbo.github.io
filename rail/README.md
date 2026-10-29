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
