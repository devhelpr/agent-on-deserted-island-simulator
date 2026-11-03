import { describe, expect, it } from "vitest";
import { WorldEngine } from "./WorldEngine.js";
import { entity, flatWorld, p } from "./testFixtures.js";
describe("limited perception", () => {
  it("enforces 50m range, 180 degree FOV and opaque obstacle occlusion", () => {
    const world = flatWorld([
      entity("near", "artifact", 5, 10),
      entity("far", "artifact", 0, 55),
      entity("behind", "artifact", 0, -10),
      entity("side", "artifact", 10, 0),
      entity("tree", "tree", 0, 6),
      entity("hidden", "artifact", 0, 12),
    ]);
    const engine = new WorldEngine(world, [
      { id: "alpha", name: "Alpha", position: p(0, 0) },
      { id: "beta", name: "Beta", position: p(0, 15) },
      { id: "gamma", name: "Gamma", position: p(-10, 10) },
    ]);
    expect(engine.observe("alpha")!.visibleEntities.map((e) => e.id)).toEqual([
      "near",
      "side",
      "tree",
    ]);
    expect(engine.observe("alpha")!.visibleAgents.map((a) => a.id)).toEqual([
      "gamma",
    ]);
    expect(engine.observe("alpha")!.perception).toEqual({
      range: 50,
      fieldOfView: Math.PI,
      occlusion: "opaque obstacles block sight",
    });
    expect(engine.observe("unknown")).toBeNull();
    const action = engine.submitAction("alpha", {
      type: "inspect",
      entityId: "hidden",
    });
    expect(action.accepted).toBe(true);
    engine.step();
    if (action.accepted)
      expect(engine.getAction(action.actionId)!.error).toBe("OUT_OF_RANGE");
  });
  it("includes distant and peripheral objects but excludes ground behind the agent", () => {
    const engine = new WorldEngine(
      flatWorld([
        entity("distant", "artifact", 0, 50),
        entity("peripheral", "artifact", 40, 5),
        entity("outside", "artifact", 0, 50.01),
        entity("behind", "artifact", 10, -1),
      ]),
      [{ id: "alpha", name: "Alpha", position: p(0, 0) }],
    );
    expect(engine.observe("alpha")!.visibleEntities.map((e) => e.id)).toEqual([
      "distant",
      "peripheral",
    ]);
    engine.submitAction("alpha", { type: "look", orientation: Math.PI });
    engine.step();
    expect(engine.observe("alpha")!.visibleEntities.map((e) => e.id)).toEqual([
      "behind",
    ]);
  });
  it("rejects inspection behind a rock even inside interaction range", () => {
    const engine = new WorldEngine(
      flatWorld([
        entity("tree", "tree", 0, 2, 0.2),
        entity("hidden", "artifact", 0, 4),
      ]),
      [{ id: "alpha", name: "Alpha", position: p(0, 0) }],
    );
    const action = engine.submitAction("alpha", {
      type: "inspect",
      entityId: "hidden",
    });
    engine.step();
    if (action.accepted)
      expect(engine.getAction(action.actionId)!.error).toBe("NOT_VISIBLE");
    else throw new Error("not accepted");
  });
  it("captures event audiences at occurrence time instead of leaking the global event log", () => {
    const engine = new WorldEngine(flatWorld(), [
      { id: "alpha", name: "Alpha", position: p(-20, 0) },
      { id: "beta", name: "Beta", position: p(40, 0) },
    ]);
    engine.submitAction("alpha", { type: "look", orientation: 0 });
    engine.step();
    expect(engine.observe("alpha")!.recentEvents).toHaveLength(1);
    expect(engine.observe("beta")!.recentEvents).toHaveLength(0);
  });
});
