import {
  INTERACTION_RANGE,
  type AgentObservation,
  type WorldActionInput,
} from "../../../../packages/shared/src/index.js";
import type { DecisionPolicy } from "./AgentScheduler.js";
interface PolicyState {
  turn: number;
  seenEvent: number;
  visited: Set<string>;
  lastTarget?: string;
  failures: number;
}
/** Deterministic policy using only the filtered observations exposed to inhabitants. */
export function createScriptedPolicy(): DecisionPolicy {
  const states = new Map<string, PolicyState>();
  return (observation) => {
    const state = states.get(observation.agentId) ?? {
      turn: 0,
      seenEvent: 0,
      visited: new Set<string>(),
      failures: 0,
    };
    states.set(observation.agentId, state);
    state.turn++;
    const offset =
      (["alpha", "beta", "gamma"].indexOf(observation.agentId) * 2 * Math.PI) /
      3;
    const angle = Math.atan2(
      Math.sin(state.turn * 2.39996 + offset),
      Math.cos(state.turn * 2.39996 + offset),
    );
    const p = observation.position;
    const explore = (flee = false): WorldActionInput => {
      const neighbors = observation.visibleAgents.filter(
        (a) => a.distance < 10,
      );
      let dx = Math.sin(angle),
        dz = Math.cos(angle);
      if (flee && neighbors.length) {
        dx = neighbors.reduce(
          (n, a) => n + (p.x - a.position.x) / Math.max(1, a.distance),
          0,
        );
        dz = neighbors.reduce(
          (n, a) => n + (p.z - a.position.z) / Math.max(1, a.distance),
          0,
        );
      }
      const length = Math.hypot(dx, dz) || 1;
      return {
        type: "move",
        target: {
          x: p.x + (dx / length) * 15,
          y: 0,
          z: p.z + (dz / length) * 15,
        },
      };
    };
    const recent = observation.recentEvents
      .filter((e) => e.actorId === observation.agentId)
      .at(-1);
    let failed = false;
    if (recent && recent.sequence > state.seenEvent) {
      state.seenEvent = recent.sequence;
      failed = recent.type === "action:failed";
      state.failures = failed ? state.failures + 1 : 0;
      if (
        (recent.message.includes("pickup succeeded") ||
          recent.message.includes("interact succeeded")) &&
        recent.targetId
      )
        state.visited.add(recent.targetId);
      if (failed && state.lastTarget) state.visited.add(state.lastTarget);
    }
    if (observation.inventory.length) {
      if (state.failures > 0 && state.failures % 4 === 0) return explore(true);
      const entity = observation.visibleEntities.find(
        (e) => e.id === observation.inventory[0],
      );
      const r = entity?.radius ?? 3;
      return {
        type: "drop",
        entityId: observation.inventory[0]!,
        target: {
          x: p.x + Math.sin(angle) * (r + 1.7),
          y: 0,
          z: p.z + Math.cos(angle) * (r + 1.7),
        },
      };
    }
    if (failed) return explore(true);
    const target = observation.visibleEntities
      .filter((e) => !e.ownerId && !state.visited.has(e.id))
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))
      .find((e) => e.type === "rock" || e.type === "artifact");
    if (target) {
      state.lastTarget = target.id;
      if (target.distance <= INTERACTION_RANGE + target.radius) {
        if (state.turn % 3 === 0)
          return { type: "inspect", entityId: target.id };
        return target.type === "rock"
          ? { type: "pickup", entityId: target.id }
          : { type: "interact", entityId: target.id, interaction: "activate" };
      }
      const standOff = target.radius + 2;
      return {
        type: "move",
        target: {
          x:
            target.position.x +
            ((p.x - target.position.x) / target.distance) * standOff,
          y: 0,
          z:
            target.position.z +
            ((p.z - target.position.z) / target.distance) * standOff,
        },
      };
    }
    state.lastTarget = undefined;
    return state.turn % 3 === 1
      ? { type: "look", orientation: angle }
      : explore();
  };
}
