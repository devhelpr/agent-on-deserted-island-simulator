import { describe, expect, it } from "vitest";
import { entityHeight } from "../../../../packages/shared/src/index.js";
import { WorldEngine } from "./WorldEngine.js";
import { entity, flatWorld, p } from "./testFixtures.js";

function act(engine: WorldEngine, input: unknown) {
  const submission = engine.submitAction("alpha", input);
  if (!submission.accepted) throw new Error(submission.error);
  engine.step();
  return submission.actionId;
}
function complete(engine: WorldEngine, id: string) {
  for (let i = 0; i < 100 && engine.getAction(id)?.status === "running"; i++)
    engine.step();
  return engine.getAction(id)!;
}
function world() {
  return new WorldEngine(flatWorld([entity("base", "rock", 0, 0)]), [
    {
      id: "alpha",
      name: "Alpha",
      position: p(-7, 0),
      orientation: Math.PI / 2,
    },
  ]);
}

describe("jumping and throwing", () => {
  it("animates a jump, lands on a rock and can jump back to the ground", () => {
    const engine = world();
    const jump = act(engine, { type: "jump", target: p(0, 0) });
    expect(engine.getAction(jump)!.status).toBe("running");
    expect(engine.getAgents()[0]!.position.y).toBeGreaterThan(2);
    expect(complete(engine, jump).status).toBe("succeeded");
    const top = 2 + entityHeight(engine.getState().entities[0]!);
    expect(engine.getAgents()[0]!.position).toEqual({ x: 0, y: top, z: 0 });
    expect(engine.observe("alpha")!.position.y).toBe(top);
    const back = act(engine, { type: "jump", target: p(7, 0) });
    expect(complete(engine, back).status).toBe("succeeded");
    expect(engine.getAgents()[0]!.position).toEqual(p(7, 0));
  });

  it("throws and stacks an object, then uses it to reach an otherwise too high surface", () => {
    const base = entity("base", "rock", 0, 0);
    const step = entity("step", "rock", -7, 4, 0.6);
    const engine = new WorldEngine(flatWorld([base, step]), [
      { id: "alpha", name: "Alpha", position: p(-7, 0), orientation: 0 },
    ]);
    expect(
      engine.getAction(act(engine, { type: "pickup", entityId: "step" }))!
        .status,
    ).toBe("succeeded");
    const thrown = act(engine, {
      type: "throw",
      entityId: "step",
      target: p(1.8, 0),
    });
    expect(engine.getAction(thrown)!.error).toBeUndefined();
    expect(
      engine.getState().entities.find((e) => e.id === "step")!.ownerId,
    ).toBeNull();
    expect(engine.getAgents()[0]!.inventory).toEqual([]);
    expect(complete(engine, thrown).status).toBe("succeeded");
    const stacked = engine.getState().entities.find((e) => e.id === "step")!;
    expect(stacked.position.y).toBeCloseTo(2 + entityHeight(base));
    // The stack is too high from the ground. First jump onto its lower edge.
    const tooHigh = act(engine, { type: "jump", target: p(1, 0) });
    expect(engine.getAction(tooHigh)!.error).toBe("JUMP_UNREACHABLE");
    const edge = act(engine, { type: "jump", target: p(-2.8, 0) });
    expect(complete(engine, edge).status).toBe("succeeded");
    const up = act(engine, { type: "jump", target: p(1, 0) });
    expect(complete(engine, up).status).toBe("succeeded");
    expect(engine.getAgents()[0]!.position.y).toBeCloseTo(
      2 + entityHeight(base) + entityHeight(step),
    );
    const higher = act(engine, { type: "jump", target: p(1, 0) });
    let apex = 0;
    while (engine.getAction(higher)!.status === "running") {
      apex = Math.max(apex, engine.getAgents()[0]!.position.y);
      engine.step();
    }
    expect(engine.getAction(higher)!.status).toBe("succeeded");
    expect(apex).toBeGreaterThan(10);
  });

  it("rejects unreachable, water, blocked and unowned attempts without losing items", () => {
    const engine = world();
    for (const target of [p(20, 0), p(1000, 0)]) {
      const id = act(engine, { type: "jump", target });
      expect(engine.getAction(id)!.error).toBe("JUMP_UNREACHABLE");
      expect(engine.getAgents()[0]!.position).toEqual(p(-7, 0));
    }
    const unowned = act(engine, {
      type: "throw",
      entityId: "base",
      target: p(5, 0),
    });
    expect(engine.getAction(unowned)!.error).toBe("NOT_OWNER");
    const pickup = act(engine, { type: "pickup", entityId: "base" });
    expect(engine.getAction(pickup)!.error).toBe("OUT_OF_RANGE");
    const wet = flatWorld();
    wet.terrain.heights.fill(0);
    // One dry spawn patch; the nearby target is below sea level.
    for (let z = 9; z <= 11; z++)
      for (let x = 10; x <= 10; x++) wet.terrain.heights[z * 21 + x] = 2;
    const shore = new WorldEngine(wet, [
      { id: "alpha", name: "Alpha", position: p(0, 0) },
    ]);
    const water = act(shore, { type: "jump", target: p(8, 0) });
    expect(shore.getAction(water)!.error).toBe("JUMP_UNREACHABLE");
    const blocked = new WorldEngine(
      flatWorld([entity("wall", "tree", -3, 0)]),
      [{ id: "alpha", name: "Alpha", position: p(-7, 0) }],
    );
    const id = act(blocked, { type: "jump", target: p(1, 0) });
    expect(blocked.getAction(id)!.error).toBe("JUMP_UNREACHABLE");
  });

  it("keeps an item in the bag when a throw cannot reach its target", () => {
    const engine = new WorldEngine(flatWorld([entity("stone", "rock", 0, 4)]), [
      { id: "alpha", name: "Alpha", position: p(0, 0) },
    ]);
    act(engine, { type: "pickup", entityId: "stone" });
    const id = act(engine, {
      type: "throw",
      entityId: "stone",
      target: p(30, 0),
    });
    expect(engine.getAction(id)!.error).toBe("THROW_UNREACHABLE");
    expect(engine.getAgents()[0]!.inventory).toEqual(["stone"]);
    expect(engine.getState().entities[0]!.ownerId).toBe("alpha");
  });

  it("walks across a raised surface and settles when its support is picked up", () => {
    const engine = world();
    complete(engine, act(engine, { type: "jump", target: p(0, 0) }));
    const walk = act(engine, { type: "move", target: p(1, 0) });
    expect(complete(engine, walk).status).toBe("succeeded");
    expect(engine.getAgents()[0]!.position.y).toBeCloseTo(4.84);
    act(engine, { type: "look", orientation: -Math.PI / 2 });
    expect(
      engine.getAction(act(engine, { type: "pickup", entityId: "base" }))!
        .status,
    ).toBe("succeeded");
    expect(engine.getAgents()[0]!.position.y).toBe(2);
  });

  it("restores saved worlds created before flight state existed", () => {
    const engine = world();
    const legacy = engine.checkpoint();
    delete (legacy as Partial<typeof legacy>).flights;
    expect(() => engine.restore(legacy)).not.toThrow();
    const jump = act(engine, { type: "jump", target: p(0, 0) });
    expect(complete(engine, jump).status).toBe("succeeded");
  });

  it("restores in-flight checkpoints deterministically and settles cancelled jumps", () => {
    const engine = world();
    const jump = act(engine, { type: "jump", target: p(0, 0) });
    const checkpoint = engine.checkpoint();
    complete(engine, jump);
    const landed = engine.getState();
    engine.restore(checkpoint);
    complete(engine, jump);
    expect(engine.getState()).toEqual(landed);
    engine.restore(checkpoint);
    expect(engine.cancelAction("alpha", jump)).toBe(true);
    for (let i = 0; i < 100; i++) engine.step();
    expect(engine.getAgents()[0]!.position).toEqual(landed.agents[0]!.position);
    expect(engine.getAction(jump)!.status).toBe("cancelled");
  });
});
