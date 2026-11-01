import { describe, expect, it } from "vitest";
import { terrainHeight } from "../../../../packages/shared/src/index.js";
import { generateWorld, DEFAULT_WORLD } from "./generateWorld.js";
import { TICK_MS, WorldEngine } from "./WorldEngine.js";

describe("deterministic world", () => {
  it("reproduces the same definition and changes with a different seed", () => {
    expect(generateWorld()).toEqual(generateWorld());
    expect(generateWorld({ ...DEFAULT_WORLD, seed: 7 })).not.toEqual(
      generateWorld(),
    );
  });
  it("places all requested objects on terrain with unique IDs", () => {
    const world = generateWorld();
    expect(world.entities).toHaveLength(213);
    expect(new Set(world.entities.map((e) => e.id)).size).toBe(213);
    for (const entity of world.entities) {
      expect(entity.position.y).toBeGreaterThan(1);
      expect(entity.position.y).toBeCloseTo(
        terrainHeight(world.terrain, entity.position.x, entity.position.z),
        2,
      );
    }
    expect(world.terrain.heights).toHaveLength(81 * 81);
  });
  it("rejects invalid generator configuration", () => {
    expect(() => generateWorld({ ...DEFAULT_WORLD, size: NaN })).toThrow();
    expect(() => generateWorld({ ...DEFAULT_WORLD, rocks: -1 })).toThrow();
  });
});
describe("authoritative engine", () => {
  it("keeps definition and returned states isolated from mutations", () => {
    const input = generateWorld();
    const engine = new WorldEngine(input);
    input.entities[0]!.position.x = 99999;
    const definition = engine.getDefinition();
    definition.entities[0]!.position.x = 99999;
    const state = engine.getState();
    state.agents[0]!.position.x = 99999;
    expect(engine.getDefinition().entities[0]!.position.x).not.toBe(99999);
    expect(engine.getState().agents[0]!.position.x).toBe(-18);
  });
  it("moves three agents deterministically at 3 m/s in virtual time", () => {
    const world = generateWorld();
    const a = new WorldEngine(world);
    const b = new WorldEngine(world);
    for (const engine of [a, b])
      for (const agent of engine.getState().agents) {
        expect(
          engine.submitAction(agent.id, {
            type: "move",
            target: { ...agent.position, z: agent.position.z + 12 },
          }).accepted,
        ).toBe(true);
      }
    for (let i = 0; i < 80; i++) {
      a.step();
      b.step();
    }
    expect(a.getState()).toEqual(b.getState());
    expect(a.getState().tick).toBe(80);
    expect(a.getState().simulationTimeMs).toBe(80 * TICK_MS);
    for (const agent of a.getState().agents) {
      expect(agent.position.z).toBeCloseTo(-6, 8);
      expect(agent.status).toBe("idle");
      expect(agent.position.y).toBeCloseTo(
        terrainHeight(world.terrain, agent.position.x, agent.position.z),
        8,
      );
    }
  });
});
