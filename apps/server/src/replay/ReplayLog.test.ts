import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WorldEngine } from "../world/WorldEngine.js";
import { describe, expect, it } from "vitest";
import { SimulationStore } from "../storage/SimulationStore.js";
import { Simulation } from "../simulation/Simulation.js";
import { flatWorld, p } from "../world/testFixtures.js";
import { createApp } from "../createApp.js";
import { stateHash } from "./ReplayLog.js";

describe("durable exact replay", () => {
  it("retains replay and filtered observations after closing and reopening SQLite", async () => {
    const folder = mkdtempSync(join(tmpdir(), "island-replay-"));
    try {
      let store = new SimulationStore(join(folder, "replay.sqlite"));
      const definition = flatWorld();
      const sim = new Simulation("durable", 0, 1, "live", null, {
        store,
        definition,
      });
      sim.engine.submitAction("alpha", { type: "move", target: p(-20, 0) });
      for (let i = 0; i < 70; i++) sim.engine.step();
      sim.engine.cancelAll();
      const saved = sim.engine.getState();
      const observation = sim.engine.observe("alpha");
      const hash = stateHash(sim.engine.checkpoint());
      await sim.shutdown();
      store.close();
      store = new SimulationStore(join(folder, "replay.sqlite"));
      const replay = store.replay.reconstruct(sim.cycleId, 70)!;
      expect(replay.hash).toBe(hash);
      const restored = new WorldEngine(definition);
      restored.restore(replay.checkpoint);
      expect(restored.getState()).toEqual(saved);
      expect(restored.observe("alpha")).toEqual(observation);
      expect(
        JSON.parse(
          (
            store.sqlite
              .prepare("SELECT versions FROM replay_frames LIMIT 1")
              .get() as { versions: string }
          ).versions,
        ),
      ).toMatchObject({ generator: 1, navigation: 1, physics: "kinematic-1" });
      store.close();
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  });
  it("reconstructs a complete 72,000 tick cycle in either seek order, including minute snapshots", async () => {
    const store = new SimulationStore();
    const sim = new Simulation("replay", 0, 20, "experiment", null, {
      store,
      definition: flatWorld(),
    });
    sim.engine.submitAction("alpha", { type: "move", target: p(-20, 10) });
    const expected = new Map<number, string>();
    expected.set(0, stateHash(sim.engine.checkpoint()));
    for (let tick = 1; tick <= 72000; tick++) {
      sim.engine.step();
      if (tick % 1200 === 0 || tick === 21)
        expected.set(tick, stateHash(sim.engine.checkpoint()));
    }
    for (const speed of [1, 5, 20]) {
      const ticks = [...expected.keys()];
      if (speed !== 1) ticks.reverse();
      for (const tick of ticks)
        expect(store.replay.reconstruct(sim.cycleId, tick)!.hash).toBe(
          expected.get(tick),
        );
    }
    expect(
      store.sqlite
        .prepare(
          "SELECT count(DISTINCT tick) AS n FROM replay_frames WHERE full=1",
        )
        .get(),
    ).toEqual({ n: 61 });
    const finalCycle = sim.cycleId;
    await sim.reset();
    expect(
      store.replay.reconstruct(finalCycle, 72000)!.checkpoint.accepting,
    ).toBe(false);
    expect(sim.engine.getTick()).toBe(0);
    expect(() =>
      store.sqlite.prepare("UPDATE replay_frames SET tick=3").run(),
    ).toThrow("append-only");
    expect(() =>
      store.sqlite.prepare("DELETE FROM replay_frames").run(),
    ).toThrow("append-only");
    await sim.stop();
    store.close();
  }, 120000);
  it("rolls replay writes back with failed world commits", async () => {
    const store = new SimulationStore();
    const sim = new Simulation("rollback", 0, 1, "live", null, {
      store,
      definition: flatWorld(),
    });
    const before = store.replay.reconstruct(sim.cycleId, 0);
    store.sqlite.exec(
      "CREATE TRIGGER fail_cycle BEFORE UPDATE ON simulation_cycles BEGIN SELECT RAISE(ABORT, 'DISK_FAILURE'); END;",
    );
    expect(() => sim.engine.step()).toThrow();
    expect(store.replay.reconstruct(sim.cycleId, 1)).toEqual(before);
    store.sqlite.exec("DROP TRIGGER fail_cycle");
    sim.engine.step();
    expect(store.replay.reconstruct(sim.cycleId, 1)!.hash).toBe(
      stateHash(sim.engine.checkpoint()),
    );
    await sim.stop();
    store.close();
  });
  it("serves cycle-scoped POV and historical decisions without advancing live state", async () => {
    const runtime = createApp({ policy: null });
    const sim = runtime.simulations.get("sim-001")!;
    sim.engine.step();
    const cycles = await (
      await runtime.app.request("/api/simulations/sim-001/replays")
    ).json();
    expect(cycles[0].lastTick).toBe(1);
    const frame = await (
      await runtime.app.request(
        `/api/simulations/sim-001/replays/${sim.cycleId}?tick=1&agentId=alpha`,
      )
    ).json();
    expect(frame.hash).toBe(stateHash(sim.engine.checkpoint()));
    expect(frame.state.entities.map((e: { id: string }) => e.id)).toEqual(
      frame.observation.visibleEntities.map((e: { id: string }) => e.id),
    );
    expect(frame.definition.entities).toEqual(frame.state.entities);
    expect(
      frame.state.agents.every(
        (a: { id: string }) =>
          a.id === "alpha" ||
          frame.observation.visibleAgents.some(
            (v: { id: string }) => v.id === a.id,
          ),
      ),
    ).toBe(true);
    expect(
      (
        await runtime.app.request(
          `/api/simulations/sim-001/replays/${sim.cycleId}?tick=-1`,
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await runtime.app.request(
          `/api/simulations/sim-001/replays/other:cycle-1?tick=0`,
        )
      ).status,
    ).toBe(404);
    expect(sim.engine.getTick()).toBe(1);
    await runtime.shutdown();
  });
});
