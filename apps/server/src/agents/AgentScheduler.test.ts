import { describe, expect, it, vi } from "vitest";
import type {
  AgentObservation,
  WorldActionInput,
} from "../../../../packages/shared/src/index.js";
import { WorldEngine } from "../world/WorldEngine.js";
import { entity, flatWorld, p } from "../world/testFixtures.js";
import { AgentScheduler } from "./AgentScheduler.js";
const look: WorldActionInput = { type: "look", orientation: 0 };
describe("decision scheduling", () => {
  it("holds an experiment batch until all decisions arrive, then resolves in ID order", async () => {
    const engine = new WorldEngine(flatWorld([entity("stone", "rock", 0, 0)]), [
      {
        id: "alpha",
        name: "Alpha",
        position: p(-4, 0),
        orientation: Math.PI / 2,
      },
      {
        id: "beta",
        name: "Beta",
        position: p(4, 0),
        orientation: -Math.PI / 2,
      },
    ]);
    const resolvers = new Map<string, (action: WorldActionInput) => void>();
    const policy = vi.fn(
      (o) =>
        new Promise<WorldActionInput>((resolve) =>
          resolvers.set(o.agentId, resolve),
        ),
    );
    const scheduler = new AgentScheduler(engine, policy);
    expect(scheduler.prepare("experiment")).toBe(false);
    resolvers.get("beta")!({ type: "pickup", entityId: "stone" });
    await Promise.resolve();
    expect(scheduler.prepare("experiment")).toBe(false);
    expect(engine.getState().actions).toHaveLength(0);
    expect(policy).toHaveBeenCalledTimes(2);
    resolvers.get("alpha")!({ type: "pickup", entityId: "stone" });
    await Promise.resolve();
    expect(scheduler.prepare("experiment")).toBe(true);
    engine.step();
    expect(engine.getState().entities[0]!.ownerId).toBe("alpha");
    scheduler.cancel();
  });
  it("keeps live mode moving and ignores late decisions after cancellation", async () => {
    const engine = new WorldEngine(flatWorld());
    let resolve!: (action: WorldActionInput) => void;
    const scheduler = new AgentScheduler(
      engine,
      () =>
        new Promise<WorldActionInput>((r) => {
          resolve = r;
        }),
    );
    expect(scheduler.prepare("live")).toBe(true);
    engine.step();
    expect(engine.getState().tick).toBe(1);
    scheduler.cancel();
    resolve(look);
    await Promise.resolve();
    expect(engine.getState().actions).toHaveLength(0);
  });
  it("recovers from rejected and timed out policies", async () => {
    vi.useFakeTimers();
    try {
      const engine = new WorldEngine(flatWorld());
      const scheduler = new AgentScheduler(
        engine,
        (o) =>
          o.agentId === "alpha"
            ? Promise.reject(new Error("failure"))
            : new Promise(() => {}),
        100,
      );
      expect(scheduler.prepare("experiment")).toBe(false);
      await vi.advanceTimersByTimeAsync(101);
      expect(scheduler.prepare("experiment")).toBe(true);
      engine.step();
      expect(
        engine.getState().agents.every((a) => a.status === "waiting"),
      ).toBe(true);
      scheduler.cancel();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Cancellation must reach the underlying model request, not just discard its eventual value.
describe("scheduler cancellation signals", () => {
  it("aborts in-flight policies when cancelled", () => {
    const engine = new WorldEngine(flatWorld());
    const signals: AbortSignal[] = [];
    const scheduler = new AgentScheduler(engine, (_observation, signal) => {
      signals.push(signal!);
      return new Promise(() => {});
    });
    scheduler.prepare("live");
    expect(signals).toHaveLength(3);
    scheduler.cancel();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });
});

describe("event-driven decisions", () => {
  function solo(entities: Parameters<typeof flatWorld>[0] = []) {
    return new WorldEngine(flatWorld(entities), [
      { id: "alpha", name: "Alpha", position: p(0, 0) },
    ]);
  }

  it("keeps walking without extra decisions until the entire route ends", () => {
    const engine = solo();
    const policy = vi.fn(
      (_observation: AgentObservation): WorldActionInput => ({
        type: "move",
        target: p(0, 9),
      }),
    );
    const scheduler = new AgentScheduler(engine, policy);
    scheduler.prepare("live");
    for (let tick = 0; tick < 50; tick++) {
      engine.step();
      scheduler.prepare("live");
    }
    expect(policy).toHaveBeenCalledTimes(1);
    for (let tick = 0; tick < 11; tick++) {
      engine.step();
      scheduler.prepare("live");
    }
    expect(policy).toHaveBeenCalledTimes(2);
    scheduler.cancel();
  });

  it("stops once for a new nearby encounter instead of every tick it stays nearby", () => {
    const engine = solo([entity("find", "artifact", 0, 12)]);
    const policy = vi.fn((observation: AgentObservation): WorldActionInput =>
      observation.lastAction
        ? { type: "wait", durationMs: 60000 }
        : { type: "move", target: p(0, 9) },
    );
    const scheduler = new AgentScheduler(engine, policy);
    scheduler.prepare("live");
    const first = engine.getAgents()[0]!.activeActionId!;
    for (let tick = 0; tick < 70; tick++) {
      engine.step();
      scheduler.prepare("live");
    }
    expect(policy).toHaveBeenCalledTimes(2);
    expect(engine.getAction(first)!).toMatchObject({
      status: "cancelled",
      error: "ENCOUNTER",
    });
    expect(policy.mock.calls[1]![0].lastAction!.id).toBe(first);
    expect(engine.getAgents()[0]!.position.z).toBeLessThan(9);
    scheduler.cancel();
  });

  it.each(["ground", "rock"])(
    "waits until a jump lands on %s before deciding again",
    (surface) => {
      const engine = solo([
        surface === "rock"
          ? entity("landing", "rock", 0, 8)
          : entity("find", "item", 1.5, 4),
      ]);
      const policy = vi.fn(
        (_observation: AgentObservation): WorldActionInput => ({
          type: "jump",
          target: p(0, 8),
        }),
      );
      const scheduler = new AgentScheduler(engine, policy);
      scheduler.prepare("live");
      engine.step();
      const id = engine.getAgents()[0]!.activeActionId!;
      while (engine.getAction(id)!.status === "running") {
        scheduler.prepare("live");
        expect(policy).toHaveBeenCalledTimes(1);
        engine.step();
      }
      expect(engine.getAction(id)!.status).toBe("succeeded");
      scheduler.prepare("live");
      expect(policy).toHaveBeenCalledTimes(2);
      scheduler.cancel();
    },
  );

  it("does not keep deciding after a look or walk that changes nothing", () => {
    for (const action of [look, { type: "move", target: p(0, 0) } as const]) {
      const engine = solo();
      const policy = vi.fn(() => action);
      const scheduler = new AgentScheduler(engine, policy);
      for (let tick = 0; tick < 30; tick++) {
        scheduler.prepare("live");
        engine.step();
      }
      expect(policy).toHaveBeenCalledTimes(1);
      scheduler.cancel();
    }
  });

  it("wakes an idle agent when a new visible encounter arrives", () => {
    const engine = solo([entity("find", "artifact", 0, 12)]);
    const policy = vi.fn(() => look);
    const scheduler = new AgentScheduler(engine, policy);
    scheduler.prepare("live");
    engine.step();
    scheduler.prepare("live");
    expect(policy).toHaveBeenCalledTimes(1);
    const checkpoint = engine.checkpoint();
    checkpoint.entities[0]![1].position = p(0, 4);
    engine.restore(checkpoint);
    scheduler.prepare("live");
    expect(policy).toHaveBeenCalledTimes(2);
    for (let tick = 0; tick < 5; tick++) {
      engine.step();
      scheduler.prepare("live");
    }
    expect(policy).toHaveBeenCalledTimes(2);
    scheduler.cancel();
  });

  it("does not request another idle decision without a new event", () => {
    const engine = solo();
    const policy = vi.fn(() => look);
    vi.spyOn(engine, "submitAction").mockReturnValue({
      accepted: false,
      error: "CYCLE_CLOSING",
    });
    const scheduler = new AgentScheduler(engine, policy);
    for (let tick = 0; tick < 20; tick++) {
      scheduler.prepare("live");
      engine.step();
    }
    expect(policy).toHaveBeenCalledTimes(1);
    scheduler.cancel();
  });
});
