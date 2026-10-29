# 轨道都市 · Demo 02

A self-contained, Tokyo-inspired rail/city sandbox served at `/rail/index.html` on the existing GitHub Pages site. It needs no server, dependencies, external map tiles, API keys, or live transport data.

## Current playable loop

- Three fictional operators own tracks and independent cash accounts.
- Draw routes through fixed candidate stations. Compare dedicated double-track construction with cheaper sharing of existing infrastructure. Show actual costs for each option before confirmation. Dedicated construction adds a physical track pair with independent slots, including alongside existing corridors. Sharing creates an operating service on existing assets and pays quarterly rent to foreign infrastructure owners. Book investment immediately.
- Adjust each company's flat fare and each service's headway. Transport infrastructure and scheduled services are separate entities.
- Connect two different operators' services at a shared endpoint. Through service uses existing tracks and additional shared slots, both companies invest equally, and only trips actually crossing operators receive the 15% connection discount.
- Passenger demand uses residential population, destination jobs, a distance deterrence function, and a rail-versus-road choice based on travel time, wait, transfers, and fare. Ticket revenue is distributed by operating-company distance travelled. Track owners separately receive rent for foreign-operated services; operating and infrastructure ownership remain distinct. These are simplifying accounting conventions, not the real Japanese clearing system.
- Physical track slots are shared across services. Peak demand is estimated from daily travel; demand exceeding simplified capacity is returned to road travel. Demand/capacity colouring is distinct from carried passenger counts.
- Quarterly financial settlement, limited regional population/job growth, housing constraints, station accessibility inspection, map layers, pause/speed, local autosave, validated JSON export/import.

Money is in million yen (百万円). Ridership is synthetic daily trips, not unique people or real-world station statistics. Revenue uses 90 representative days per quarter. The whole model is intended to test cause-and-effect and interaction, not calibrated forecasting.

## Deliberate first-version limits

Construction is instantaneous after confirmation. All trains stop at all points in their service; there is no express/overtaking, detailed timetable, vehicle compatibility, infrastructure usage charge, debt interest, property income, construction phasing, demolition, or active AI-company expansion. The planner can manage every operator. City land-use types are seeded; population, building density and jobs grow, but use types do not yet convert automatically. Regional growth budgets are tunable play parameters.

The operating day now has individual bidirectional trains, headway-based dispatch, per-stop dwell, smoothed acceleration/braking, a per-track/per-direction dispatch separation rule, live passenger queues, boarding and alighting, and bounded circulating fleets for loops. Live passenger ride-leg demand is generated from the quarterly OD forecast; transfers are not yet simulated as individual linked people. Quarterly financial results still use the aggregate forecast, not live farebox collection. Operations time and quarterly settlement are separate controls. Opening starts the representative scene at 07:00 after a deterministic 30-minute warm-up; city and finance saves persist. Backgrounding pauses time; there is no offline catch-up. Saves stay in that browser unless exported. Demo network caps avoid unbounded browser work.

## Structure and verification

`engine.js`: deterministic state, physical network, services, path choice, fares, capacity, accounts, growth and save validation. Browser-independent CommonJS export for tests. Version-1 city saves migrate without dropping routes, cash or quarterly history.

`ui.js`: SVG map, company panels, controls, time and local persistence. `style.css` / `index.html`: responsive buildless UI.

`operations.js`: deterministic sub-minute train and ride-leg simulation; the SVG renders actual runtime positions rather than independent animation paths.

Run `node scripts/test_rail.cjs` and `node scripts/test_rail_operations.cjs` from the repository root. The existing Pages workflow stages the `rail/` directory and runs the simulation test before deployment. Existing dashboard data collection and reading behaviour remain independent of the game.
