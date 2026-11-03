import { describe, expect, it } from "vitest";
import {
  ITEMS,
  type ItemKind,
  type WorldActionInput,
  type WorldEntity,
} from "../../../../packages/shared/src/index.js";
import { Simulation } from "../simulation/Simulation.js";
import { SimulationStore } from "../storage/SimulationStore.js";
import { WorldEngine } from "./WorldEngine.js";
import { entity, flatWorld, p } from "./testFixtures.js";

function material(kind: ItemKind, id: string): WorldEntity {
  return {
    ...entity(id, "item", 0, 2),
    itemKind: kind,
    label: ITEMS[kind].label,
    properties: { movable: true, inspectable: true },
  };
}
function setup(kinds: ItemKind[], extras: WorldEntity[] = []) {
  const engine = new WorldEngine(
    flatWorld([...kinds.map((kind, i) => material(kind, `m-${i}`)), ...extras]),
    [{ id: "alpha", name: "Alpha", position: p(0, 0) }],
  );
  for (let i = 0; i < kinds.length; i++)
    act(engine, { type: "pickup", entityId: `m-${i}` });
  return engine;
}
function act(engine: WorldEngine, input: WorldActionInput) {
  const submitted = engine.submitAction("alpha", input);
  if (!submitted.accepted) throw new Error(submitted.error);
  engine.step();
  return engine.getAction(submitted.actionId)!;
}
const held = (engine: WorldEngine) =>
  engine.getState().entities.filter((e) => e.ownerId === "alpha");

describe("material bag and crafting", () => {
  it("carries varied materials, enforces capacity, and gains space with one basket", () => {
    const engine = setup(
      [...Array<ItemKind>(23).fill("wood"), "stone", "fiber"],
      [material("basket", "basket")],
    );
    expect(held(engine)).toHaveLength(24);
    const fullBag = held(engine);
    expect(act(engine, { type: "craft", recipeId: "plank" }).error).toBe(
      "INVENTORY_FULL",
    );
    expect(held(engine)).toEqual(fullBag);
    expect(
      engine.observe("alpha")!.visibleEntities.find((e) => e.id === "m-24")!
        .pickup!.blocker,
    ).toBe("INVENTORY_FULL");
    expect(act(engine, { type: "pickup", entityId: "m-24" }).error).toBe(
      "INVENTORY_FULL",
    );
    expect(act(engine, { type: "pickup", entityId: "basket" }).status).toBe(
      "succeeded",
    );
    expect(engine.observe("alpha")!.inventoryCapacity).toBe(36);
    expect(act(engine, { type: "pickup", entityId: "m-24" }).status).toBe(
      "succeeded",
    );
    expect(
      act(engine, { type: "drop", entityId: "basket", target: p(3, 0) }).error,
    ).toBe("INVENTORY_FULL");
    expect(held(engine)).toHaveLength(26);
  });

  it("combines ingredients through multiple recipes and requires a placed workbench", () => {
    const engine = setup(
      [
        "wood",
        "wood",
        "wood",
        "wood",
        "stone",
        "stone",
        "stone",
        "fiber",
        "fiber",
        "fiber",
        "fiber",
      ],
      [entity("source", "rock", 0, 6)],
    );
    for (const recipeId of [
      "rope",
      "rope",
      "plank",
      "plank",
      "workbench",
    ] as const)
      expect(act(engine, { type: "craft", recipeId }).status).toBe("succeeded");
    expect(act(engine, { type: "craft", recipeId: "pickaxe" }).error).toBe(
      "WORKBENCH_REQUIRED",
    );
    const bench = held(engine).find((e) => e.itemKind === "workbench")!;
    expect(
      act(engine, { type: "drop", entityId: bench.id, target: p(3, 0) }).status,
    ).toBe("succeeded");
    act(engine, { type: "look", orientation: Math.PI / 2 });
    expect(
      engine.observe("alpha")!.recipes!.find((r) => r.id === "pickaxe")!
        .craftable,
    ).toBe(true);
    expect(act(engine, { type: "craft", recipeId: "pickaxe" }).status).toBe(
      "succeeded",
    );
    expect(held(engine).map((e) => e.itemKind)).toEqual(["pickaxe"]);
    act(engine, { type: "look", orientation: 0 });
    // Move closer to the source without disturbing the workbench.
    act(engine, { type: "move", target: p(0, 1) });
    for (let i = 0; i < 20; i++) engine.step();
    expect(
      act(engine, { type: "gather", entityId: "source" }).result,
    ).toMatchObject({ remainingResources: 4 });
    expect(held(engine).filter((e) => e.itemKind === "stone")).toHaveLength(2);
  });

  it("keeps materials intact on failed crafting and restores crafted state deterministically", () => {
    const engine = setup(["wood"]);
    const before = held(engine);
    expect(act(engine, { type: "craft", recipeId: "axe" }).error).toBe(
      "MISSING_MATERIALS",
    );
    expect(held(engine)).toEqual(before);
    const checkpoint = engine.checkpoint();
    const result = act(engine, { type: "craft", recipeId: "plank" });
    const crafted = engine.getState();
    expect(result.result).toMatchObject({
      consumed: ["m-0"],
      recipeId: "plank",
    });
    expect(held(engine).map((e) => e.itemKind)).toEqual(["plank", "plank"]);
    engine.restore(checkpoint);
    act(engine, { type: "craft", recipeId: "plank" });
    expect(engine.getState()).toEqual(crafted);
  });

  it("activates crafted light and exhausts finite material sources", () => {
    const engine = setup(
      ["wood", "resin", "fiber"],
      [entity("far", "artifact", 0, 30), entity("tree", "tree", 3, 0)],
    );
    expect(
      engine.observe("alpha")!.visibleEntities.some((e) => e.id === "far"),
    ).toBe(false);
    act(engine, { type: "craft", recipeId: "torch" });
    const torch = held(engine)[0]!;
    expect(
      act(engine, {
        type: "interact",
        entityId: torch.id,
        interaction: "activate",
      }).status,
    ).toBe("succeeded");
    expect(
      engine.observe("alpha")!.visibleEntities.some((e) => e.id === "far"),
    ).toBe(true);
    act(engine, { type: "look", orientation: Math.PI / 2 });
    for (let i = 0; i < 6; i++)
      expect(act(engine, { type: "gather", entityId: "tree" }).status).toBe(
        "succeeded",
      );
    expect(act(engine, { type: "gather", entityId: "tree" }).error).toBe(
      "RESOURCE_DEPLETED",
    );
    expect(held(engine).filter((e) => e.itemKind === "wood")).toHaveLength(6);
  });
});

it("replays crafting, source depletion and lighting from stored checkpoints", async () => {
  const store = new SimulationStore();
  const definition = flatWorld([
    ...["wood", "resin", "fiber"].map((kind, i) => ({
      ...material(kind as ItemKind, `s-${i}`),
      position: p(-20, -18),
    })),
    entity("source", "tree", -20, -16.5),
  ]);
  const sim = new Simulation("craft-replay", 0, 1, "live", null, {
    store,
    definition,
  });
  try {
    for (let i = 0; i < 3; i++)
      expect(
        act(sim.engine, { type: "pickup", entityId: `s-${i}` }).status,
      ).toBe("succeeded");
    act(sim.engine, { type: "craft", recipeId: "torch" });
    const torch = held(sim.engine)[0]!;
    act(sim.engine, {
      type: "interact",
      entityId: torch.id,
      interaction: "activate",
    });
    act(sim.engine, { type: "gather", entityId: "source" });
    const restored = new WorldEngine(definition);
    restored.restore(
      store.replay.reconstruct(sim.cycleId, sim.engine.getTick())!.checkpoint,
    );
    expect(restored.getState()).toEqual(sim.engine.getState());
    expect(restored.observe("alpha")).toEqual(sim.engine.observe("alpha"));
    expect(
      restored.getState().entities.find((e) => e.id === "source")!.harvested,
    ).toBe(1);
  } finally {
    await sim.shutdown();
    store.close();
  }
});
