import { expect, it } from "vitest";
import { generateWorld } from "./generateWorld.js";
import { WorldEngine } from "./WorldEngine.js";
import { flatWorld, entity, p } from "./testFixtures.js";
it("generates three clearly named portable artifact kinds near the start", () => {
  const artifacts = generateWorld().entities.filter(
    (e) => e.type === "artifact",
  );
  expect(new Set(artifacts.map((e) => e.kind)).size).toBe(3);
  expect(artifacts.every((e) => e.properties.movable && e.label)).toBe(true);
  expect(
    artifacts
      .slice(0, 3)
      .every((e) => Math.hypot(e.position.x + 18, e.position.z + 18) < 20),
  ).toBe(true);
});
it("exposes portability and supports artifact pickup, carrying, drop and activation", () => {
  const artifact = {
    ...entity("shell", "artifact", 0, 4),
    kind: "shell" as const,
    label: "Golden shell",
    properties: { movable: true, inspectable: true },
  };
  const engine = new WorldEngine(flatWorld([artifact]), [
    { id: "alpha", name: "Alpha", position: p(0, 0) },
  ]);
  expect(engine.observe("alpha")!.visibleEntities[0]).toMatchObject({
    movable: true,
    label: "Golden shell",
    kind: "shell",
  });
  engine.submitAction("alpha", { type: "pickup", entityId: "shell" });
  engine.step();
  expect(engine.getAgents()[0]!.inventory).toEqual(["shell"]);
  engine.submitAction("alpha", {
    type: "drop",
    entityId: "shell",
    target: p(0, 4),
  });
  engine.step();
  expect(engine.getAgents()[0]!.inventory).toEqual([]);
  engine.submitAction("alpha", {
    type: "interact",
    entityId: "shell",
    interaction: "activate",
  });
  engine.step();
  expect(engine.getState().entities[0]!.activated).toBe(true);
});
