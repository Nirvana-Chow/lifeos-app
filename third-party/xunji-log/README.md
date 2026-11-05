# xunji-log source reuse

Upstream: [imklayhu/xunji-log](https://github.com/imklayhu/xunji-log), fixed commit `267c02e96f7b18fcaf14d742f54253f55cb42dd8`, MIT, Copyright (c)2026 xunji-log contributors. The complete original license is retained in [LICENSE](LICENSE). Exact upstream URLs, source paths and SHA-256 values are recorded in [provenance.json](provenance.json).

The unmodified `web/src/pages/Calendar.tsx` and `web/src/components/Chart.tsx` are preserved under `source/` as reviewable source snapshots. Runtime derivatives live under `src/personal-health/xunji-log/`; source snapshots are not compiled or served as another application.

`calendar.tsx` was copied from upstream Calendar and adapted: the `trainedDates`, `calendarData`, `openDay`, heatmap-click handling, metric buttons, ECharts calendar/visualMap/heatmap configuration and recent-record table retain that implementation's structure. The adapter replaces its server Analysis input with validated owner health snapshots, and explicit record-id callbacks replace the upstream network DrillPanel. No upstream synchronization, authentication, API client or server is imported.

Necessary semantic changes: only completed activity contributes to the calendar; dates not in the snapshot are not filled with zero or described as rest; missing duration/distance remains unknown; explicit zero is retained; distances stay in their original km/mi buckets; unsupported volume/tonnage/calories/heart rate are omitted. General activity titles, including ultimate frisbee, are retained. A day containing several records offers their actual titles rather than arbitrarily selecting one. All open actions use the same existing record-id callback.

`chart.tsx` retains the upstream wrapper's `option`, `height`, `className`, `onEvents` seam. `echarts-for-react` and Canvas are replaced with the existing pinned ECharts6.1.0 modular calendar/heatmap/visualMap/tooltip/ARIA/SVG implementation. It uses LifeOS semantic colors, native ReUI buttons and chart lifecycle cleanup. Neither `react-router-dom` nor another ECharts wrapper is added.

This reuse is a presentation slice. Xunji source ingestion, source coverage, complete exercise/set/food/plan semantics, owner API authorization, production integration and actual owner acceptance remain separate gates. The UI does not claim that Xunji synchronization is connected.
