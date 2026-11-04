# MAP34 — operations center stalls

The old HUD refreshed the operations center every five simulated minutes. At 24× this could trigger multiple expensive diagnoses per real second. Each diagnosis walked every OD path, recalculated a line's full geometric length inside that path loop, expanded the full peak/off-peak timetable for every line, then rebuilt the whole panel. Autosave also synchronously encoded the entire game as JSON every ten seconds.

Changes:
- Read-only diagnostic Worker; one in-flight job, ten-second wall-clock cadence, forecast retained between jobs, compact live train/queue totals, revision checks and explicit retry on failure. The passenger simulation never waits for diagnosis.
- Precomputed line lengths and per-run track direction; peak/off-peak timetable expanded once per diagnosis. Equations and recommendation thresholds unchanged.
- Keyed in-place line card updates; retained scroll/details/filter state. Section evidence generated on expansion; offscreen cards use content visibility.
- HUD uses daily headline counters directly rather than sorting all daily line statistics. Queue summary reused, hidden train lists skipped.
- JSON checkpoint encoding in a local Worker. IndexedDB format, write ordering, last-good checkpoint protection, import/export formats unchanged. Capturing structured clones still has a main-thread cost; simulation computation and demand refresh are not claimed to be free of stalls at unlimited scale.

Validation:
- All rail regression suites passed.
- MAP34 tests: diagnostic Worker equivalence, cached forecast/version mismatch handling, compact live snapshot parity, read-only simulation, exact 9 MB JSON roundtrip, last-good protection on encoding failure and retry.
- Synthetic 16-line / 192-station / 150,000-profile benchmark compared against MAP33 output, checking every result field. Timings are machine-dependent and describe diagnostic CPU time, not a measured player FPS improvement.
- Browser: three-line operating save, background diagnosis, filtering/search, dispatch review, lazily expanded section evidence, high-speed continuous operation, local save and reload.
