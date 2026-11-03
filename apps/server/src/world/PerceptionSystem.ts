import {
  distance,
  inventoryCapacity,
  INTERACTION_RANGE,
  entityRadius,
  type AgentObservation,
  type AgentState,
  type EntityState,
  type Vector3,
  type WorldEvent,
} from "../../../../packages/shared/src/index.js";
import { segmentDistance } from "./NavigationSystem.js";
const angleDifference = (a: number, b: number) =>
  Math.atan2(Math.sin(a - b), Math.cos(a - b));
export function canSee(
  agent: AgentState,
  target: Vector3,
  entities: EntityState[],
  targetId?: string,
): boolean {
  const d = distance(agent.position, target);
  const lit = entities.some(
    (e) =>
      e.activated &&
      ((e.itemKind === "torch" && e.ownerId === agent.id) ||
        (e.itemKind === "campfire" &&
          !e.ownerId &&
          distance(agent.position, e.position) <= 10)),
  );
  if (
    d > (lit ? 35 : 25) ||
    (d > 0.001 &&
      Math.abs(
        angleDifference(
          Math.atan2(target.x - agent.position.x, target.z - agent.position.z),
          agent.orientation,
        ),
      ) >
        Math.PI / 3 + 1e-9)
  )
    return false;
  return !entities.some(
    (e) =>
      e.id !== targetId &&
      !e.ownerId &&
      e.type !== "artifact" &&
      e.type !== "item" &&
      distance(e.position, agent.position) < d &&
      segmentDistance(e.position, agent.position, target) < entityRadius(e),
  );
}
export function observe(
  agent: AgentState,
  agents: AgentState[],
  entities: EntityState[],
  tick: number,
  observedEvents: WorldEvent[],
): AgentObservation {
  const held = entities.filter((e) => e.ownerId === agent.id);
  const capacity = inventoryCapacity(held);
  return {
    tick,
    agentId: agent.id,
    position: { ...agent.position },
    orientation: agent.orientation,
    inventory: [...agent.inventory],
    visibleEntities: entities
      .filter(
        (e) =>
          e.ownerId === agent.id || canSee(agent, e.position, entities, e.id),
      )
      .map((e) => ({
        id: e.id,
        type: e.type,
        position: { ...e.position },
        distance: distance(agent.position, e.position),
        direction: Math.atan2(
          e.position.x - agent.position.x,
          e.position.z - agent.position.z,
        ),
        radius: entityRadius(e),
        ownerId: e.ownerId,
        kind: e.kind,
        label: e.label,
        itemKind: e.itemKind,
        activated: e.activated,
        remainingResources: ["tree", "rock"].includes(e.type)
          ? 6 - (e.harvested ?? 0)
          : undefined,
        movable: e.properties.movable,
        pickup: {
          eligible:
            e.properties.movable &&
            !e.ownerId &&
            agent.inventory.length < inventoryCapacity([...held, e]) &&
            distance(agent.position, e.position) <=
              INTERACTION_RANGE + entityRadius(e),
          blocker: !e.properties.movable
            ? "NOT_MOVABLE"
            : e.ownerId
              ? "OBJECT_UNAVAILABLE"
              : agent.inventory.length >=
                  (e.itemKind === "basket"
                    ? inventoryCapacity([...held, e])
                    : capacity)
                ? "INVENTORY_FULL"
                : distance(agent.position, e.position) >
                    INTERACTION_RANGE + entityRadius(e)
                  ? "OUT_OF_RANGE"
                  : null,
          interactionDistance: INTERACTION_RANGE + entityRadius(e),
        },
      })),
    visibleAgents: agents
      .filter((a) => a.id !== agent.id && canSee(agent, a.position, entities))
      .map((a) => ({
        id: a.id,
        position: { ...a.position },
        distance: distance(agent.position, a.position),
      })),
    recentEvents: structuredClone(
      observedEvents.filter((e) => tick - e.tick <= 200).slice(-20),
    ),
  };
}
