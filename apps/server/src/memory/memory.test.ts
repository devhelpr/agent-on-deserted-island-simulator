import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  CYCLE_TICKS,
  type AgentMemory,
} from "../../../../packages/shared/src/index.js";
import { createApp } from "../createApp.js";
import { Simulation } from "../simulation/Simulation.js";
import { SimulationStore } from "../storage/SimulationStore.js";
import {
  consolidations,
  cycles,
  decisions,
  experiences,
  memories,
  revisions,
  snapshots,
} from "../storage/schema.js";
import { entity, flatWorld, p } from "../world/testFixtures.js";
import { MemoryManager } from "./MemoryManager.js";

function fixture() {
  const store = new SimulationStore();
  const sim = new Simulation("test", 0, 1, "experiment", null, {
    store,
    definition: flatWorld([entity("cave", "cave", -20, 5)]),
  });
  return { store, sim, memory: sim.memory! };
}
describe("durable agent memory", () => {
  it("consolidates only own observations, retains sources, searches FTS and repeats without duplicates", async () => {
    const { store, sim, memory } = fixture();
    const cycleId = sim.cycleId;
    sim.engine.submitAction("alpha", { type: "look", orientation: 0 });
    sim.advance(50);
    // Explicitly verify perception before asserting derived memories.
    expect(
      sim.engine.observe("alpha")!.visibleEntities.some((e) => e.id === "cave"),
    ).toBe(true);
    memory.consolidate(cycleId, "alpha");
    const first = memory.list("alpha");
    expect(first.some((m) => m.content.startsWith("cave "))).toBe(true);
    expect(
      first.every((m) => m.agentId === "alpha" && m.sourceEventIds.length),
    ).toBe(true);
    expect(memory.list("alpha", 'cave " OR *')).toHaveLength(1);
    expect(memory.list("beta", "cave")).toEqual([]);
    memory.consolidate(cycleId, "alpha");
    expect(memory.list("alpha")).toEqual(first);
    expect(store.db.select().from(consolidations).all()).toHaveLength(1);
    const context = memory.context(
      "alpha",
      cycleId,
      sim.engine.observe("alpha")!,
    );
    expect(context.summary).toContain("cave");
    expect(context.goals.join()).toContain("cave");
    await sim.stop();
    store.close();
  });
  it("merges duplicates, marks contradictions, preserves revisions and rejects foreign sources", async () => {
    const { store, sim, memory } = fixture();
    const sources = store.db
      .select()
      .from(experiences)
      .where(
        and(
          eq(experiences.cycleId, sim.cycleId),
          eq(experiences.agentId, "alpha"),
        ),
      )
      .all();
    const source = sources[0]!;
    expect(source).toBeDefined();
    const claim: Omit<AgentMemory, "id" | "agentId" | "cycleId" | "revision"> =
      {
        type: "semantic",
        provenance: "observed",
        claimKey: "landmark",
        content: "Cave is north",
        confidence: 1,
        importance: 0.9,
        createdAtTick: 0,
        sourceEventIds: [source.id],
      };
    const original = memory.remember("alpha", sim.cycleId, claim);
    expect(memory.remember("alpha", sim.cycleId, claim).id).toBe(original.id);
    const reported = memory.remember("alpha", sim.cycleId, {
      ...claim,
      provenance: "reported",
      content: "Cave is south",
      confidence: 0.4,
    });
    expect(reported.conflictsWith).toContain(original.id);
    expect(memory.list("alpha")).toHaveLength(2);
    const updated = memory.remember("alpha", sim.cycleId, {
      ...claim,
      content: "Cave is east",
    });
    const old = store.db
      .select()
      .from(memories)
      .where(eq(memories.id, original.id))
      .get()!.payload;
    expect(old.supersededBy).toBe(updated.id);
    expect(
      store.db
        .select()
        .from(revisions)
        .where(eq(revisions.memoryId, original.id))
        .all().length,
    ).toBeGreaterThan(1);
    expect(() => memory.remember("beta", sim.cycleId, claim)).toThrow(
      "MEMORY_SOURCE_SCOPE_DENIED",
    );
    const other = new Simulation("other", 0, 1, "live", null, { store });
    expect(() => other.memory!.remember("alpha", sim.cycleId, claim)).toThrow(
      "MEMORY_SOURCE_SCOPE_DENIED",
    );
    await sim.stop();
    await other.stop();
    store.close();
  });
  it("rolls back accepted actions, world mutation and events when persistence fails", async () => {
    const { store, sim } = fixture();
    const before = sim.engine.checkpoint();
    store.sqlite.exec(
      `CREATE TRIGGER fail_commit BEFORE UPDATE ON simulation_cycles BEGIN SELECT RAISE(ABORT, 'DISK_FAILURE'); END;`,
    );
    expect(() =>
      sim.engine.submitAction("alpha", { type: "look", orientation: 1 }),
    ).toThrow();
    expect(sim.engine.checkpoint()).toEqual(before);
    store.sqlite.exec("DROP TRIGGER fail_commit");
    const accepted = sim.engine.submitAction("alpha", {
      type: "look",
      orientation: 1,
    });
    expect(accepted).toEqual({ accepted: true, actionId: "act-1" });
    const queued = sim.engine.checkpoint();
    store.sqlite.exec(
      `CREATE TRIGGER fail_event BEFORE INSERT ON world_events BEGIN SELECT RAISE(ABORT, 'DISK_FAILURE'); END;`,
    );
    expect(() => sim.engine.step()).toThrow();
    expect(sim.engine.checkpoint()).toEqual(queued);
    const saved = store.db
      .select()
      .from(cycles)
      .where(eq(cycles.id, sim.cycleId))
      .get()!;
    expect(JSON.parse(saved.checkpoint)).toEqual(queued);
    store.sqlite.exec("DROP TRIGGER fail_event");
    sim.engine.step();
    expect(sim.engine.getAction("act-1")!.status).toBe("succeeded");
    expect(
      store.sqlite
        .prepare(
          "SELECT count(*) AS n FROM world_events WHERE json_extract(payload, '$.actionId') IS NOT NULL",
        )
        .get(),
    ).toEqual({ n: 1 });
    await sim.stop();
    store.close();
  });
});
describe("cycle reset and recovery", () => {
  it("closes exactly at 72,000 ticks, rejects actions during closing and stores a cancelled final snapshot", async () => {
    const { store, sim } = fixture();
    const before = sim.cycleId;
    sim.engine.submitAction("alpha", { type: "wait", durationMs: 60000 });
    const state = sim.engine.checkpoint();
    state.tick = CYCLE_TICKS - 1;
    sim.engine.restore(state);
    sim.persist();
    sim.advance(1000);
    expect(sim.cycleStatus).toBe("closing");
    expect(sim.engine.getTick()).toBe(CYCLE_TICKS);
    expect(
      sim.engine.submitAction("beta", { type: "wait", durationMs: 50 }),
    ).toEqual({ accepted: false, error: "CYCLE_CLOSING" });
    await sim.reset();
    expect(sim.cycleIndex).toBe(2);
    expect(sim.engine.getTick()).toBe(0);
    const final = store.db
      .select()
      .from(snapshots)
      .where(and(eq(snapshots.cycleId, before), eq(snapshots.kind, "final")))
      .get()!;
    expect(final.tick).toBe(CYCLE_TICKS);
    expect(JSON.parse(final.state).actions[0][1].status).toBe("cancelled");
    expect(
      store.db.select().from(cycles).where(eq(cycles.id, before)).get()!.status,
    ).toBe("completed");
    expect(
      sim.engine
        .getAgents()
        .every((a) => a.activeActionId === null && !a.inventory.length),
    ).toBe(true);
    await sim.stop();
    store.close();
  });
  it("retries failed consolidation atomically without duplicate cycles or memories", async () => {
    const { store, sim } = fixture();
    store.sqlite.exec(
      `CREATE TRIGGER fail_memory BEFORE INSERT ON agent_memories BEGIN SELECT RAISE(ABORT, 'DISK_FAILURE'); END;`,
    );
    await expect(sim.reset()).rejects.toThrow();
    expect(sim.cycleStatus).toBe("closing");
    expect(sim.status().status).toBe("paused");
    expect(store.db.select().from(consolidations).all()).toEqual([]);
    expect(store.db.select().from(memories).all()).toEqual([]);
    expect(store.db.select().from(cycles).all()).toHaveLength(1);
    store.sqlite.exec("DROP TRIGGER fail_memory");
    await sim.reset();
    expect(sim.cycleIndex).toBe(2);
    expect(store.db.select().from(cycles).all()).toHaveLength(2);
    await sim.stop();
    store.close();
  });
  it("cancels pending decisions and keeps late results in their original cycle", async () => {
    const store = new SimulationStore();
    const resolve: ((value: { type: "wait"; durationMs: number }) => void)[] =
      [];
    const sim = new Simulation(
      "late",
      0,
      1,
      "experiment",
      () => new Promise((done) => resolve.push(done)),
      { store },
    );
    sim.advance(50);
    const original = sim.cycleId;
    expect(sim.scheduler!.pendingAgents()).toHaveLength(3);
    await sim.reset();
    for (const done of resolve) done({ type: "wait", durationMs: 50 });
    await new Promise((done) => setImmediate(done));
    const records = store.db.select().from(decisions).all();
    expect(records).toHaveLength(3);
    expect(
      records.every(
        (r) => r.cycleId === original && r.payload.status === "cancelled",
      ),
    ).toBe(true);
    expect(sim.engine.getState().actions).toEqual([]);
    await sim.stop();
    store.close();
  });
  it("restores a committed movement after a crash and continues with unique action IDs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "island-memory-"));
    const path = join(dir, "test.sqlite");
    let first: ReturnType<typeof createApp> | undefined,
      second: ReturnType<typeof createApp> | undefined;
    try {
      first = createApp({ databasePath: path, now: () => 0, policy: null });
      const sim = first.simulations.get("sim-001")!;
      sim.engine.submitAction("alpha", {
        type: "move",
        target: { x: -18, y: 0, z: 10 },
      });
      first.advance(50);
      const committed = sim.engine.checkpoint();
      first.store.close();
      first = undefined; // Crash: no lifecycle stop or cancellation.
      second = createApp({ databasePath: path, now: () => 0, policy: null });
      const recovered = second.simulations.get("sim-001")!;
      expect(recovered.status().status).toBe("paused");
      expect(recovered.engine.checkpoint()).toEqual(committed);
      recovered.clock.resume();
      second.advance(100);
      expect(recovered.engine.getTick()).toBe(committed.tick + 2);
      recovered.engine.cancelAll();
      expect(
        recovered.engine.submitAction("alpha", {
          type: "wait",
          durationMs: 50,
        }),
      ).toEqual({ accepted: true, actionId: "act-2" });
      await second.shutdown();
      second = undefined;
    } finally {
      if (first) await first.shutdown();
      if (second) await second.shutdown();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("finds a cave, restores the original world, then navigates back using retained memory", async () => {
    const store = new SimulationStore();
    const sim = new Simulation("acceptance", 0, 20, "experiment", undefined, {
      store,
      definition: flatWorld([entity("remembered-cave", "cave", 20, 20)]),
    });
    // Exploration uses only the public action interface; the learned memory is generated from perception.
    sim.scheduler?.cancel();
    const path = [p(-20, 5), p(10, 5)];
    for (const target of path) {
      sim.engine.submitAction("alpha", { type: "move", target });
      for (let i = 0; i < 400 && sim.engine.getAgents()[0]!.activeActionId; i++)
        sim.engine.step();
    }
    sim.engine.submitAction("alpha", {
      type: "look",
      orientation: Math.PI / 4,
    });
    sim.engine.step();
    expect(
      sim.engine.observe("alpha")!.visibleEntities.map((e) => e.id),
    ).toContain("remembered-cave");
    const cycle = sim.cycleId;
    await sim.reset();
    const learned = sim.memory!.list("alpha", "remembered-cave")[0]!;
    expect(learned.cycleId).toBe(cycle);
    expect(learned.provenance).toBe("observed");
    expect(sim.engine.getAgents()[0]!.position).toEqual(p(-20, -20));
    // Fresh scripted policy reads its own memory context and chooses the remembered viewpoint.
    for (let now = 50; now <= 2000; now += 50) sim.advance(now);
    const records = store
      .listDecisions(sim.id, "alpha")
      .filter((r) => r.cycleId === sim.cycleId);
    expect(records[0]!.actionId).toBeDefined();
    expect(
      records[0]!.observation.memory!.relevant.some((m) => m.id === learned.id),
    ).toBe(true);
    const action = sim.engine.getAction(records[0]!.actionId!);
    expect(action?.input).toEqual({ type: "move", target: learned.target });
    expect(action?.status).toBe("succeeded");
    expect(sim.engine.getAgents()[0]!.position).not.toEqual(p(-20, -20));
    await sim.stop();
    store.close();
  }, 20000);
  it("retains consolidated memories and FTS across closing and reopening a database", async () => {
    const dir = mkdtempSync(join(tmpdir(), "island-retained-"));
    const path = join(dir, "retained.sqlite");
    let store = new SimulationStore(path);
    try {
      const sim = new Simulation("retained", 0, 1, "live", null, {
        store,
        definition: flatWorld([entity("cave", "cave", -20, 5)]),
      });
      await sim.reset();
      const before = sim.memory!.list("alpha", "cave");
      expect(before.length).toBeGreaterThan(0);
      await sim.shutdown();
      store.close();
      store = new SimulationStore(path);
      const recovered = new MemoryManager(store, sim.id);
      expect(recovered.list("alpha", "cave")).toEqual(before);
      expect(recovered.list("gamma", "cave")).toEqual([]);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("serves durable memory and decision endpoints scoped to run and agent", async () => {
    const runtime = createApp({
      now: () => 0,
      policy: () => ({ type: "look", orientation: 0 }),
    });
    const sim = runtime.simulations.get("sim-001")!;
    runtime.advance(50);
    await sim.reset();
    const base = "/api/simulations/sim-001/agents";
    const alpha = await (
      await runtime.app.request(`${base}/alpha/memories`)
    ).json();
    expect(alpha.length).toBeGreaterThan(0);
    expect(alpha.every((m: AgentMemory) => m.agentId === "alpha")).toBe(true);
    const records = await (
      await runtime.app.request(`${base}/alpha/decisions`)
    ).json();
    expect(
      records.every((d: { agentId: string }) => d.agentId === "alpha"),
    ).toBe(true);
    expect(records[0].cycleId).toBe("sim-001:cycle-1");
    expect((await runtime.app.request(`${base}/nobody/memories`)).status).toBe(
      404,
    );
    const search = await (
      await runtime.app.request(`${base}/alpha/memories?q=%22%20*%20OR`)
    ).json();
    expect(Array.isArray(search)).toBe(true);
    const response = await runtime.app.request(
      "/api/simulations/sim-001/reset",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    await runtime.stop();
    runtime.store.close();
  });
});
