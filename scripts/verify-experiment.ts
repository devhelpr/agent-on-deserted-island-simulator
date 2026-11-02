import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessExperiment } from "./experimentAcceptance.js";
import { Simulation } from "../apps/server/src/simulation/Simulation.js";
import { SimulationStore } from "../apps/server/src/storage/SimulationStore.js";

// Real, bounded black-box run. Uses existing Codex login; at most 48 model decisions.
const directory = await mkdtemp(join(tmpdir(), "island-experiment-"));
const store = new SimulationStore(join(directory, "experiment.sqlite"));
const started = performance.now();
const sim = new Simulation("multi-codex", started, 20, "live", undefined, {
  store,
  controller: "codex",
  codexAgentIds: ["alpha", "beta", "gamma"],
  experiment: { maxCycles: 2, decisionBudgetPerAgentPerCycle: 8 },
});
let interrupted = false;
const interrupt = () => {
  interrupted = true;
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
let previous = started;
let checked = started;
const decisions = () =>
  ["alpha", "beta", "gamma"].flatMap((id) => store.listDecisions(sim.id, id));
try {
  while (
    !interrupted &&
    sim.status().status !== "stopped" &&
    performance.now() - started < 600000
  ) {
    sim.advance(performance.now());
    if (sim.cycleError) break;
    if (performance.now() - previous > 15000) {
      console.log(JSON.stringify(sim.status()));
      previous = performance.now();
    }
    if (performance.now() - checked > 1000) {
      const metrics = store.metrics(sim.id);
      if (assessExperiment(metrics, decisions())) break;
      if (
        sim.cycleIndex === 1 &&
        metrics[0]!.agents.every(
          (a) => a.failures >= 3 && a.failures === a.decisions,
        )
      )
        break;
      checked = performance.now();
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const metrics = store.metrics(sim.id);
  const records = decisions();
  const passed = !interrupted && assessExperiment(metrics, records);
  const report = {
    date: new Date().toISOString(),
    passed,
    scope:
      "S6.7: full first cycle, automatic reset, fresh threads and demonstrated memory use by all three agents in cycle two",
    fullExperimentCompleted: sim.status().experiment?.completed === true,
    wallDurationMs: Math.round(performance.now() - started),
    simulation: sim.status(),
    metrics,
    threads: records
      .filter((r) => r.threadId)
      .map((r) => ({
        agentId: r.agentId,
        cycleId: r.cycleId,
        threadId: r.threadId,
      })),
    errors: records
      .filter((r) => r.error)
      .map((r) => ({
        agentId: r.agentId,
        cycleId: r.cycleId,
        tick: r.tick,
        error: r.error,
      })),
    memoryEvidence: records
      .filter(
        (r) =>
          r.cycleId.endsWith("cycle-2") &&
          r.observation.memory?.relevant.length,
      )
      .map((r) => ({
        agentId: r.agentId,
        threadId: r.threadId,
        action: r.action,
        outcome: r.outcome?.status,
        memories: r.observation.memory!.relevant.map((m) => ({
          id: m.id,
          agentId: m.agentId,
          cycleId: m.cycleId,
          target: m.target,
        })),
      })),
  };
  await writeFile(
    "docs/sprint-6-live-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify({ passed, metrics }, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  await sim.shutdown();
  store.close();
  await rm(directory, { recursive: true, force: true });
}
