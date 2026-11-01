import { describe, expect, it } from "vitest";
import {
  AGENT_RADIUS,
  distance,
  entityRadius,
} from "../../../../packages/shared/src/index.js";
import { WorldEngine } from "./WorldEngine.js";
import { entity, flatWorld, p } from "./testFixtures.js";
function conflictWorld() {
  return new WorldEngine(flatWorld([entity("stone", "rock", 0, 0)]), [
    {
      id: "alpha",
      name: "Alpha",
      position: p(-4, 0),
      orientation: Math.PI / 2,
    },
    { id: "beta", name: "Beta", position: p(4, 0), orientation: -Math.PI / 2 },
    { id: "gamma", name: "Gamma", position: p(0, -5), orientation: 0 },
  ]);
}
function submit(engine: WorldEngine, id: string, input: unknown) {
  const result = engine.submitAction(id, input);
  expect(result.accepted).toBe(true);
  if (!result.accepted) throw new Error(result.error);
  return result.actionId;
}
describe("atomic actions", () => {
  it("assigns a contested rock to alpha irrespective of arrival order", () => {
    for (const order of [
      ["gamma", "beta", "alpha"],
      ["alpha", "gamma", "beta"],
    ]) {
      const engine = conflictWorld();
      const actions = order.map((id) =>
        submit(engine, id, { type: "pickup", entityId: "stone" }),
      );
      engine.step();
      const state = engine.getState();
      expect(state.entities[0]!.ownerId).toBe("alpha");
      expect(state.agents.map((a) => a.inventory)).toEqual([["stone"], [], []]);
      expect(
        actions
          .map((id) => engine.getAction(id)!.status)
          .filter((s) => s === "succeeded"),
      ).toHaveLength(1);
      expect(state.events.map((e) => e.actorId)).toEqual([
        "alpha",
        "beta",
        "gamma",
      ]);
    }
  });
  it("validates input, range, visibility and ownership when executed", () => {
    const engine = conflictWorld();
    expect(
      engine.submitAction("alpha", {
        type: "move",
        target: { x: NaN, y: 0, z: 1 },
      }),
    ).toEqual({ accepted: false, error: "INVALID_ACTION" });
    expect(
      engine.submitAction("alpha", {
        type: "pickup",
        entityId: "stone",
        ownerId: "alpha",
      }),
    ).toEqual({ accepted: false, error: "INVALID_ACTION" });
    expect(
      engine.submitAction("unknown", { type: "wait", durationMs: 50 }),
    ).toEqual({ accepted: false, error: "AGENT_NOT_FOUND" });
    const badDrop = submit(engine, "beta", {
      type: "drop",
      entityId: "stone",
      target: p(0, 0),
    });
    engine.step();
    expect(engine.getAction(badDrop)!.error).toBe("NOT_OWNER");
    submit(engine, "alpha", { type: "look", orientation: -Math.PI / 2 });
    engine.step();
    const invisible = submit(engine, "alpha", {
      type: "inspect",
      entityId: "stone",
    });
    engine.step();
    expect(engine.getAction(invisible)!.error).toBe("NOT_VISIBLE");
    const distant = new WorldEngine(flatWorld([entity("far", "rock", 30, 30)]));
    const far = submit(distant, "alpha", { type: "pickup", entityId: "far" });
    distant.step();
    expect(distant.getAction(far)!.error).toBe("OUT_OF_RANGE");
  });
  it("moves carried objects, rejects blocked drops and preserves ownership on failure", () => {
    const engine = conflictWorld();
    submit(engine, "alpha", { type: "pickup", entityId: "stone" });
    engine.step();
    const blocked = submit(engine, "alpha", {
      type: "drop",
      entityId: "stone",
      target: p(-4, 0),
    });
    engine.step();
    expect(engine.getAction(blocked)!.error).toBe("DROP_BLOCKED");
    expect(engine.getState().entities[0]!.ownerId).toBe("alpha");
    const move = submit(engine, "alpha", { type: "move", target: p(-20, 0) });
    for (let i = 0; i < 110; i++) engine.step();
    expect(engine.getAction(move)!.status).toBe("succeeded");
    expect(engine.getState().entities[0]!.position).toEqual(
      engine.getState().agents[0]!.position,
    );
    const drop = submit(engine, "alpha", {
      type: "drop",
      entityId: "stone",
      target: p(-15, 0),
    });
    engine.step();
    expect(engine.getAction(drop)!.status).toBe("succeeded");
    expect(engine.getState().entities[0]!.ownerId).toBe(null);
    expect(engine.getState().agents[0]!.inventory).toEqual([]);
    expect(engine.navigation.isWalkable(p(-15, 0))).toBe(false);
  });
  it("supports inspect and artifact activation, rejects unsupported interactions", () => {
    const engine = new WorldEngine(
      flatWorld([
        entity("artifact", "artifact", -20, -16),
        entity("tree", "tree", -16.5, -20),
      ]),
      [{ id: "alpha", name: "Alpha", position: p(-20, -20) }],
    );
    const inspect = submit(engine, "alpha", {
      type: "inspect",
      entityId: "artifact",
    });
    engine.step();
    expect(engine.getAction(inspect)!.result).toMatchObject({
      type: "artifact",
      activated: false,
    });
    const activate = submit(engine, "alpha", {
      type: "interact",
      entityId: "artifact",
      interaction: "activate",
    });
    engine.step();
    expect(engine.getAction(activate)!.status).toBe("succeeded");
    expect(engine.getState().entities[0]!.activated).toBe(true);
    submit(engine, "alpha", { type: "look", orientation: Math.PI / 2 });
    engine.step();
    const invalid = submit(engine, "alpha", {
      type: "interact",
      entityId: "tree",
      interaction: "activate",
    });
    engine.step();
    expect(engine.getAction(invalid)!.error).toBe("UNSUPPORTED_INTERACTION");
  });
  it("permits only one action per agent and cancels queued/running actions", () => {
    const engine = new WorldEngine(flatWorld());
    const queued = submit(engine, "alpha", {
      type: "move",
      target: p(-20, 20),
    });
    expect(
      engine.submitAction("alpha", { type: "look", orientation: 0 }),
    ).toEqual({ accepted: false, error: "AGENT_BUSY" });
    expect(engine.cancelAction("beta", queued)).toBe(false);
    expect(engine.cancelAction("alpha", queued)).toBe(true);
    const action = submit(engine, "alpha", {
      type: "move",
      target: p(-20, 20),
    });
    engine.step();
    const position = engine.getState().agents[0]!.position;
    expect(engine.cancelAction("alpha", action)).toBe(true);
    for (let i = 0; i < 20; i++) engine.step();
    expect(engine.getState().agents[0]!.position).toEqual(position);
    expect(engine.getAction(action)!.status).toBe("cancelled");
    expect(engine.cancelAction("alpha", action)).toBe(false);
  });
  it("prevents agent overlaps and times out blocked movement without deadlock", () => {
    const engine = new WorldEngine(flatWorld(), [
      { id: "alpha", name: "Alpha", position: p(-5, 0) },
      { id: "beta", name: "Beta", position: p(5, 0) },
      { id: "gamma", name: "Gamma", position: p(0, -10) },
    ]);
    for (const id of ["alpha", "beta"])
      submit(engine, id, {
        type: "move",
        target: p(id === "alpha" ? 10 : -10, 0),
      });
    for (let i = 0; i < 250; i++) {
      engine.step();
      const agents = engine.getState().agents;
      for (const a of agents)
        for (const b of agents)
          if (a.id !== b.id)
            expect(distance(a.position, b.position)).toBeGreaterThanOrEqual(
              2 * AGENT_RADIUS - 1e-6,
            );
    }
    expect(engine.getState().actions.every((a) => a.status === "failed")).toBe(
      true,
    );
  });
  it("uses collision-free A* detours and rejects water targets", () => {
    const engine = new WorldEngine(flatWorld([entity("rock", "rock", 0, 0)]), [
      { id: "alpha", name: "Alpha", position: p(-15, 0) },
    ]);
    const action = submit(engine, "alpha", { type: "move", target: p(15, 0) });
    let deviated = false;
    for (let i = 0; i < 350; i++) {
      engine.step();
      const agent = engine.getState().agents[0]!;
      if (Math.abs(agent.position.z) > 2) deviated = true;
      expect(distance(agent.position, p(0, 0))).toBeGreaterThanOrEqual(
        entityRadius(engine.getState().entities[0]!) + AGENT_RADIUS - 1e-6,
      );
    }
    expect(engine.getAction(action)!.status).toBe("succeeded");
    expect(deviated).toBe(true);
    const invalid = submit(engine, "alpha", {
      type: "move",
      target: p(1000, 1000),
    });
    engine.step();
    expect(engine.getAction(invalid)!.error).toBe("UNREACHABLE");
  });
});
