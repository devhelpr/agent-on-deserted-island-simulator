import { describe, expect, it } from "vitest";
import { NavigationSystem } from "./NavigationSystem.js";
import { flatWorld, p } from "./testFixtures.js";
describe("terrain navmesh", () => {
  it("cannot cross a water channel or navigate onto water", () => {
    const world = flatWorld();
    for (let z = 0; z < 21; z++)
      for (let x = 9; x <= 11; x++) world.terrain.heights[z * 21 + x] = -3;
    const navigation = new NavigationSystem(world.terrain, []);
    expect(navigation.findPath(p(-20, 0), p(20, 0))).toBeNull();
    expect(navigation.findPath(p(-20, 0), p(0, 0))).toBeNull();
    expect(navigation.triangles.some((t) => !t.walkable)).toBe(true);
  });
  it("cannot cross a steep cliff even if both ends are dry", () => {
    const world = flatWorld();
    for (let z = 0; z < 21; z++)
      for (let x = 11; x < 21; x++) world.terrain.heights[z * 21 + x] = 40;
    const navigation = new NavigationSystem(world.terrain, []);
    expect(navigation.findPath(p(-20, 0), { x: 20, y: 40, z: 0 })).toBeNull();
  });
});
