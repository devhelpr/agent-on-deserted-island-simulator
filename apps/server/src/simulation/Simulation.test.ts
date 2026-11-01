import { describe, expect, it } from "vitest";
import {
  distance,
  AGENT_RADIUS,
} from "../../../../packages/shared/src/index.js";
import { Simulation } from "./Simulation.js";
describe("three scripted inhabitants", () => {
  it("runs reproducibly at 20x with valid ownership, movement and bounded state", () => {
    const a = new Simulation("same", 0, 20, "experiment");
    const b = new Simulation("same", 0, 20, "experiment");
    const visited = new Map<string, Set<string>>();
    let pickups = 0;
    let maxSequence = 0;
    for (let now = 50; now <= 30000; now += 50) {
      a.advance(now);
      b.advance(now);
      const state = a.engine.getState();
      for (const agent of state.agents) {
        const points = visited.get(agent.id) ?? new Set<string>();
        points.add(
          `${Math.round(agent.position.x)},${Math.round(agent.position.z)}`,
        );
        visited.set(agent.id, points);
        for (const other of state.agents)
          if (other.id !== agent.id)
            expect(
              distance(agent.position, other.position),
            ).toBeGreaterThanOrEqual(2 * AGENT_RADIUS - 1e-6);
      }
      for (const e of state.entities) {
        const owners = state.agents.filter((agent) =>
          agent.inventory.includes(e.id),
        );
        expect(owners.length).toBe(e.ownerId ? 1 : 0);
        if (e.ownerId) expect(owners[0]!.id).toBe(e.ownerId);
      }
      for (const e of state.events)
        if (e.sequence > maxSequence) {
          if (e.message.includes("pickup succeeded")) pickups++;
          maxSequence = Math.max(maxSequence, e.sequence);
        }
    }
    expect(a.engine.getState()).toEqual(b.engine.getState());
    expect(a.engine.getTick()).toBe(12000);
    for (const points of visited.values())
      expect(points.size).toBeGreaterThan(10);
    expect(pickups).toBeGreaterThan(0);
    expect(a.engine.getState().actions.length).toBeLessThanOrEqual(60);
    a.stop();
    b.stop();
  }, 30000);
});
