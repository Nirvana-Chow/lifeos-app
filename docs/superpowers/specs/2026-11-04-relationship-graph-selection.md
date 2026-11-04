# Relationship graph selection

Status: LO-GRAPH-001 / Issue34 is recorded; this is research and a recommendation, not implemented graph behavior. LO-LINK-001 / Issue33 first defines stable, owner-scoped associations. Do not infer personal relationships from private text or draw synthetic owner data.

Registry versions checked on2026-11-04, with no installation or lock changes:

| Candidate | Version/license | Fit and cost |
|---|---|---|
|[Apache ECharts Graph](https://echarts.apache.org/en/option.html#series-graph)|6.1.0 / Apache-2.0; already installed|Existing theme/resize/dispose and chart infrastructure can render nodes/links, labels and interaction. Lowest initial dependency cost. Still needs measured keyboard/list alternatives, mobile selection and evidence drilldown.|
|[Cytoscape.js](https://js.cytoscape.org/)|3.34.4 / MIT|Dedicated graph model, traversal and configurable layouts. Useful if neighborhood expansion, compound/grouped nodes or graph algorithms become central; adds a second rendering lifecycle and independent layout/accessibility qualification.|
|[Sigma.js](https://www.sigmajs.org/get-started/quickstart/) + [Graphology](https://graphology.github.io/)|4.0.4 +0.26.0 / MIT|WebGL rendering with separate graph data structure; plausible for much larger networks. More layout/rendering/WebGL integration than the currently established personal-scale need. The old v3 documentation differs from current v4; do not combine their APIs.|

Official license sources: [ECharts](https://github.com/apache/echarts/blob/master/LICENSE), [Cytoscape factsheet](https://js.cytoscape.org/#introduction), and the pinned package metadata for Sigma/Graphology. These are candidates, not adopted dependencies or measured performance claims.

## Recommendation and minimal validation

First implement typed explicit associations and a readonly graph projection through existing ECharts. Use stable entity IDs for projects, areas, people and topics; records are the evidence that creates or explains a link. The graph is a view of the fact layer, not a second editable database. A later unmet interaction/scale requirement can justify Cytoscape after a representative benchmark; do not add a graph database merely to draw the first view.

Initial quantitative contract: show association counts and selected time coverage, link direction/type where meaningful and a direct list of contributing permitted record IDs/revisions. Edge thickness may encode a disclosed count; node position and force-layout distance never indicate psychological importance or relationship quality. Offer explicit time/type/area/project/topic filters and an accessible equivalent list. Unknown dates, unlinked records, deduplication, revisions and the denominator remain visible. Explicit links and text co-occurrence are distinct; default to explicit links until inference has a reviewed rule and user confirmation.

The first technical validation should use internal synthetic structures solely to verify deterministic counts, duplicate/revision filtering, unavailable-source denial, graph selection/list equivalence, theme/resize/dispose, narrow mobile layout and keyboard access. Owner acceptance uses the deployed private graph with verified associations. No graph implementation or personal relationship inference has run as part of this selection.
