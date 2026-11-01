import { writeFile } from "node:fs/promises";
import { Simulation } from "../apps/server/src/simulation/Simulation.js";
import { distance } from "../packages/shared/src/index.js";

// Explicit live black-box check: uses the user's existing Codex login and real model calls.
const started = performance.now();
const simulation = new Simulation(
  "codex-acceptance",
  started,
  20,
  "live",
  undefined,
  { controller: "codex", codexAgentIds: ["alpha"] },
);
const start = simulation.engine
  .getAgents()
  .find((a) => a.id === "alpha")!.position;
let maxDistance = 0;
let previous = started;
let report: Record<string, unknown> | undefined;
const decisions = new Set<string>();
const moves = new Set<string>();
let stopped = false;
const stop = () => {
  stopped = true;
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
try {
  while (!stopped && performance.now() - started < 180000) {
    const now = performance.now();
    simulation.advance(now);
    const alpha = simulation.engine.getAgents().find((a) => a.id === "alpha")!;
    maxDistance = Math.max(maxDistance, distance(start, alpha.position));
    for (const record of simulation.codex!.journal.list("alpha")) {
      if (record.status === "submitted") decisions.add(record.id);
      if (
        record.actionId &&
        record.action?.type === "move" &&
        simulation.engine.getAction(record.actionId)?.status === "succeeded"
      )
        moves.add(record.actionId);
    }
    if (now - previous > 10000) {
      console.log(
        JSON.stringify({
          virtualMinutes: simulation.engine.getTick() / 1200,
          decisions: decisions.size,
          successfulMoves: moves.size,
          maxDistance: Math.round(maxDistance),
        }),
      );
      previous = now;
    }
    if (
      simulation
        .codex!.journal.list("alpha")
        .filter((r) => r.status === "failed").length >= 3 &&
      decisions.size === 0
    )
      break;
    if (
      simulation.engine.getTick() >= 18000 &&
      decisions.size >= 4 &&
      moves.size >= 2 &&
      maxDistance >= 15
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const records = simulation.codex!.journal.list("alpha");
  const passed =
    !stopped &&
    simulation.engine.getTick() >= 18000 &&
    decisions.size >= 4 &&
    moves.size >= 2 &&
    maxDistance >= 15;
  report = {
    date: new Date().toISOString(),
    passed,
    cliProtocol: "Codex CLI 0.161.0 app-server v2",
    timeScale: 20,
    schedulerMode: "live",
    virtualDurationMs: simulation.engine.getTick() * 50,
    wallDurationMs: Math.round(performance.now() - started),
    successfulDecisions: decisions.size,
    successfulMoves: moves.size,
    maxDistanceFromSpawnMeters: Math.round(maxDistance * 100) / 100,
    threadCount: new Set(records.map((r) => r.threadId).filter(Boolean)).size,
    worldToolCalls: records.reduce(
      (n, r) => n + r.tools.filter((t) => t.success).length,
      0,
    ),
    errors: records
      .filter((r) => r.error)
      .map((r) => ({ tick: r.tick, error: r.error })),
    sample: records
      .filter((r) => r.status === "submitted")
      .slice(-5)
      .map((r) => ({
        tick: r.tick,
        action: r.action,
        motivation: r.motivation,
        tools: r.tools.map((t) => ({ tool: t.tool, success: t.success })),
      })),
  };
  await writeFile(
    "docs/sprint-3-live-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", stop);
  process.removeListener("SIGTERM", stop);
  await simulation.stop();
}
