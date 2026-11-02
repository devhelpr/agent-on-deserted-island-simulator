import { writeFile } from "node:fs/promises";
import { Simulation } from "../apps/server/src/simulation/Simulation.js";
import { flatWorld, entity } from "../apps/server/src/world/testFixtures.js";

// One real Codex agent, at most four attempts. Other inhabitants wait without model calls.
const started = performance.now();
const artifact = {
  ...entity("test-crystal", "artifact", -20, -16),
  kind: "crystal" as const,
  label: "Glowing crystal",
  properties: { movable: true, inspectable: true },
};
const sim = new Simulation(
  "artifact-live",
  started,
  20,
  "live",
  () => ({ type: "wait", durationMs: 60000 }),
  {
    controller: "codex",
    codexAgentIds: ["alpha"],
    definition: flatWorld([artifact]),
    experiment: { maxCycles: 1, decisionBudgetPerAgentPerCycle: 4 },
  },
);
let interrupted = false;
const interrupt = () => {
  interrupted = true;
};
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
const evidence = () =>
  sim.codex!.journal.list("alpha").map((r) => ({
    ...r,
    outcome: r.actionId ? sim.engine.getAction(r.actionId) : undefined,
  }));
const successfulPickup = () =>
  evidence().some(
    (r) =>
      r.action?.type === "pickup" &&
      r.outcome?.status === "succeeded" &&
      r.artifactConsiderations?.some(
        (c) => c.entityId === artifact.id && c.decision === "pickup",
      ) &&
      r.motivation === r.outcome.motivation,
  );
try {
  while (!interrupted && performance.now() - started < 90000) {
    sim.advance(performance.now());
    if (successfulPickup()) break;
    if (
      evidence().length >= 4 &&
      sim.codex!.statuses().every((s) => s.status !== "thinking")
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const passed = !interrupted && successfulPickup();
  const report = {
    date: new Date().toISOString(),
    passed,
    controller: "real Codex Alpha",
    scope:
      "Nearby free portable artifact: autonomous pickup, public candidate assessment and matching action motivation",
    decisionAttempts: evidence().length,
    records: evidence()
      .filter((r) => r.action || r.error)
      .map((r) => ({
        tick: r.tick,
        action: r.action,
        motivation: r.motivation,
        artifactConsiderations: r.artifactConsiderations,
        error: r.error,
        outcome: r.outcome?.status,
      })),
  };
  await writeFile(
    "docs/artifact-pickup-live-result.json",
    JSON.stringify(report, null, 2) + "\n",
  );
  console.log(JSON.stringify(report, null, 2));
  if (!passed) process.exitCode = 1;
} finally {
  process.removeListener("SIGINT", interrupt);
  process.removeListener("SIGTERM", interrupt);
  await sim.stop();
}
