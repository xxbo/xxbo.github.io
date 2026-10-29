# 轨道都市 · Demo 01

A self-contained, Tokyo-inspired rail/city sandbox served at `/rail/index.html` on the existing GitHub Pages site. It needs no server, dependencies, external map tiles, API keys, or live transport data.

## Current playable loop

- Three fictional operators own tracks and independent cash accounts.
- Draw routes through fixed candidate stations. Show cost before confirmation, reject unavailable funds and foreign-owned infrastructure, and book investment immediately.
- Adjust each company's flat fare and each service's headway. Transport infrastructure and scheduled services are separate entities.
- Connect two different operators' services at a shared endpoint. Through service uses existing tracks and additional shared slots, both companies invest equally, and only trips actually crossing operators receive the 15% connection discount.
- Passenger demand uses residential population, destination jobs, a distance deterrence function, and a rail-versus-road choice based on travel time, wait, transfers, and fare. Ticket revenue is distributed by actual infrastructure-owner distance travelled. This is a simplifying accounting convention, not the real Japanese clearing system.
- Physical track slots are shared across services. Peak demand is estimated from daily travel; demand exceeding simplified capacity is returned to road travel. Demand/capacity colouring is distinct from carried passenger counts.
- Quarterly financial settlement, limited regional population/job growth, housing constraints, station accessibility inspection, map layers, pause/speed, local autosave, validated JSON export/import.

Money is in million yen (百万円). Ridership is synthetic daily trips, not unique people or real-world station statistics. Revenue uses 90 representative days per quarter. The whole model is intended to test cause-and-effect and interaction, not calibrated forecasting.

## Deliberate first-version limits

Construction is instantaneous after confirmation. All trains stop at all points in their service; there is no express/overtaking, detailed timetable, vehicle compatibility, infrastructure usage charge, debt interest, property income, construction phasing, demolition, or active AI-company expansion. The planner can manage every operator. City land-use types are seeded; population, building density and jobs grow, but use types do not yet convert automatically. Regional growth budgets are tunable play parameters.

The visible train markers illustrate service movement; passenger and finance calculations are aggregated. Loading a tab starts paused. Backgrounding pauses time; there is no offline catch-up. Saves stay in that browser unless exported. Demo network caps avoid unbounded browser work.

## Structure and verification

`engine.js`: deterministic state, physical network, services, path choice, fares, capacity, accounts, growth and save validation. Browser-independent CommonJS export for tests.

`ui.js`: SVG map, company panels, controls, time and local persistence. `style.css` / `index.html`: responsive buildless UI.

Run `node scripts/test_rail.cjs` from the repository root. The existing Pages workflow stages the `rail/` directory and runs the simulation test before deployment. Existing dashboard data collection and reading behaviour remain independent of the game.
