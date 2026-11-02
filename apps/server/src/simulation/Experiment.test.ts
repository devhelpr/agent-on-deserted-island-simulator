import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { createApp } from "../createApp.js";
import { SimulationStore } from "../storage/SimulationStore.js";
import { Simulation } from "./Simulation.js";
import { entity, flatWorld, p } from "../world/testFixtures.js";
import type { DecisionPolicy } from "../agents/AgentScheduler.js";

describe("bounded multi-cycle experiments", () => {
  it("charges failed attempts, exhausts agents independently, advances time and renews budgets on reset", async () => {
    const store = new SimulationStore();
    const sim = new Simulation(
      "budget",
      0,
      20,
      "experiment",
      (o) => {
        if (o.agentId === "alpha") throw new Error("MODEL_UNAVAILABLE");
        return { type: "wait", durationMs: 50 };
      },
      {
        store,
        experiment: { maxCycles: 2, decisionBudgetPerAgentPerCycle: 2 },
      },
    );
    try {
      for (let t = 50; t <= 2000; t += 50) sim.advance(t);
      expect(sim.engine.getTick()).toBe(800);
      expect(sim.status().experiment).toMatchObject({
        decisionsUsed: { alpha: 2, beta: 2, gamma: 2 },
        exhaustedAgents: ["alpha", "beta", "gamma"],
      });
      expect(
        store.metrics(sim.id)[0]!.agents.find((a) => a.agentId === "alpha")!
          .failures,
      ).toBe(2);
      await sim.reset();
      expect(sim.status().experiment!.decisionsUsed).toEqual({
        alpha: 0,
        beta: 0,
        gamma: 0,
      });
      sim.advance(2050);
      expect(sim.status().experiment!.decisionsUsed.alpha).toBe(1);
      await sim.reset();
      expect(sim.status()).toMatchObject({
        status: "stopped",
        cycleStatus: "completed",
        cycleIndex: 2,
        experiment: { completed: true },
      });
      expect(store.metrics(sim.id)).toHaveLength(2);
      expect(
        sim.engine.submitAction("alpha", { type: "look", orientation: 0 })
          .accepted,
      ).toBe(false);
    } finally {
      await sim.shutdown();
      store.close();
    }
  });

  it("recovers durable budgets and preserves completed experiments on restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "island-experiment-"));
    const databasePath = join(dir, "test.sqlite");
    const policy: DecisionPolicy = () => ({ type: "wait", durationMs: 50 });
    let runtime = createApp({ databasePath, now: () => 0, policy });
    try {
      const response = await runtime.app.request("/api/simulations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          experiment: { maxCycles: 1, decisionBudgetPerAgentPerCycle: 1 },
        }),
      });
      const { id } = await response.json();
      runtime.advance(50);
      await runtime.shutdown();
      runtime = createApp({ databasePath, now: () => 0, policy });
      const sim = runtime.simulations.get(id)!;
      expect(sim.status().experiment!.decisionsUsed).toEqual({
        alpha: 1,
        beta: 1,
        gamma: 1,
      });
      sim.clock.resume();
      runtime.advance(100);
      expect(runtime.store.listDecisions(id, "alpha")).toHaveLength(1);
      await sim.reset();
      await runtime.shutdown();
      runtime = createApp({ databasePath, now: () => 0, policy });
      expect(runtime.simulations.get(id)!.status()).toMatchObject({
        status: "stopped",
        cycleStatus: "completed",
        experiment: { completed: true },
      });
      expect(
        (
          await runtime.app.request(`/api/simulations/${id}/resume`, {
            method: "POST",
          })
        ).status,
      ).toBe(409);
    } finally {
      await runtime.shutdown();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates experiment configuration and scopes paginated history and results to the run", async () => {
    const runtime = createApp({
      now: () => 0,
      policy: () => ({ type: "look", orientation: 0 }),
    });
    try {
      for (const experiment of [
        { maxCycles: 0 },
        { maxCycles: 101 },
        { decisionBudgetPerAgentPerCycle: 0 },
        { maxCycles: 1.5 },
        { extra: true },
      ]) {
        expect(
          (
            await runtime.app.request("/api/simulations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ experiment }),
            })
          ).status,
        ).toBe(400);
      }
      runtime.advance(100);
      const base = "/api/simulations/sim-001";
      const first = await (
        await runtime.app.request(`${base}/timeline`)
      ).json();
      expect(first.events.length).toBeGreaterThan(0);
      const next = await (
        await runtime.app.request(`${base}/timeline?after=${first.nextCursor}`)
      ).json();
      expect(next.events).toEqual([]);
      expect(
        (await runtime.app.request(`${base}/timeline?after=-1`)).status,
      ).toBe(400);
      expect(
        (await runtime.app.request(`${base}/timeline?cycleId=other:cycle-1`))
          .status,
      ).toBe(404);
      expect(
        (await runtime.app.request("/api/simulations/nope/results")).status,
      ).toBe(404);
      const results = await (
        await runtime.app.request(`${base}/results`)
      ).json();
      expect(results.cycles[0].agents).toHaveLength(3);
    } finally {
      await runtime.shutdown();
    }
  });

  it("runs two complete 72,000-tick cycles unattended and uses isolated retained memory in cycle two", async () => {
    const store = new SimulationStore();
    const policy: DecisionPolicy = (o) => {
      if (o.tick === 0) {
        const remembered = o.memory?.relevant.find(
          (m) => m.content.startsWith("cave ") && m.target,
        );
        return {
          type: "move",
          target: remembered?.target ?? p(o.position.x, 5),
        };
      }
      return { type: "wait", durationMs: 60000 };
    };
    const sim = new Simulation("endurance", 0, 20, "experiment", policy, {
      store,
      definition: flatWorld([entity("cave", "cave", -20, 20)]),
      experiment: { maxCycles: 2, decisionBudgetPerAgentPerCycle: 3 },
    });
    try {
      let time = 0;
      while (sim.status().status !== "stopped" && time < 400000) {
        time += 250;
        sim.advance(time);
        if (time % 2500 === 0) await new Promise((done) => setImmediate(done));
        if (sim.cycleStatus === "closing") await sim.reset();
      }
      expect(sim.status()).toMatchObject({
        status: "stopped",
        cycleIndex: 2,
        experiment: { completed: true },
      });
      const metrics = store.metrics(sim.id);
      expect(metrics.map((c) => c.tick)).toEqual([72000, 72000]);
      for (const agent of metrics[1]!.agents) {
        expect(agent.revisits).toBeGreaterThan(0);
        expect(agent.movesToMemoryTargets).toBe(1);
        expect(agent.verifiedLocations).toBeGreaterThan(0);
        const records = store
          .listDecisions(sim.id, agent.agentId)
          .filter((d) => d.cycleId === "endurance:cycle-2");
        expect(
          records[0]!.observation.memory!.relevant.every(
            (m) => m.agentId === agent.agentId,
          ),
        ).toBe(true);
        expect(agent.decisions).toBeLessThanOrEqual(3);
      }
      expect(
        store.sqlite
          .prepare("SELECT count(*) AS n FROM memory_consolidations")
          .get(),
      ).toEqual({ n: 6 });
      expect(
        store.replay.reconstruct("endurance:cycle-1", 72000)!.checkpoint.tick,
      ).toBe(72000);
      expect(
        store.replay.reconstruct("endurance:cycle-2", 72000)!.checkpoint.tick,
      ).toBe(72000);
    } finally {
      await sim.shutdown();
      store.close();
    }
  }, 120000);
});
