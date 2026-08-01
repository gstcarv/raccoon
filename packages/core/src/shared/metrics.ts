import { collectDefaultMetrics, Counter, Histogram, Gauge } from "prom-client";

collectDefaultMetrics({ prefix: "raccoon_" });

export const runsTotal = new Counter({
  name: "raccoon_runs_total",
  help: "Total number of runs by final state",
  labelNames: ["state"],
});

export const runDuration = new Histogram({
  name: "raccoon_run_duration_seconds",
  help: "Run duration in seconds",
  buckets: [30, 60, 120, 300, 600, 900, 1800],
});

export const activeRuns = new Gauge({
  name: "raccoon_active_runs",
  help: "Number of currently active runs",
});

export const webhooksTotal = new Counter({
  name: "raccoon_webhooks_total",
  help: "Total webhook deliveries by provider and result",
  labelNames: ["provider", "result"],
});
