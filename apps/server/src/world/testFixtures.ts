import type {
  EntityType,
  Vector3,
  WorldDefinition,
  WorldEntity,
} from "../../../../packages/shared/src/index.js";
export const p = (x: number, z: number): Vector3 => ({ x, y: 2, z });
export function entity(
  id: string,
  type: EntityType,
  x: number,
  z: number,
  scale = 1,
): WorldEntity {
  return {
    id,
    type,
    position: p(x, z),
    rotation: 0,
    scale,
    properties: { movable: type === "rock", inspectable: true },
  };
}
export function flatWorld(entities: WorldEntity[] = []): WorldDefinition {
  return {
    id: "test",
    version: 1,
    seed: 1,
    terrain: {
      width: 100,
      depth: 100,
      resolution: 21,
      heights: Array<number>(441).fill(2),
    },
    spawnPoints: [p(-20, -20), p(-14, -20), p(-8, -20)],
    entities,
  };
}
