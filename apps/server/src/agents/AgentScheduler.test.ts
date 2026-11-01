import { describe, expect, it, vi } from "vitest";
import type { WorldActionInput } from "../../../../packages/shared/src/index.js";
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
