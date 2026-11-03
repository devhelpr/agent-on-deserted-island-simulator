import {
  distance,
  entityHeight,
  entityRadius,
  terrainHeight,
  type EntityState,
  type Terrain,
  type Vector3,
} from "../../../../packages/shared/src/index.js";

export const GRAVITY = 10;
export const JUMP_HEIGHT = 4;
export const JUMP_RANGE = 8;
export const THROW_RANGE = 16;
export const AGENT_HEIGHT = 4.5;

/** Solid cylinders use the same origins, heights and radii as world objects. */
export class SpatialPhysics {
  constructor(readonly terrain: Terrain) {}

  inBounds(p: Vector3, radius: number) {
    return (
      Math.abs(p.x) <= this.terrain.width / 2 - radius &&
      Math.abs(p.z) <= this.terrain.depth / 2 - radius &&
      terrainHeight(this.terrain, p.x, p.z) >= 0.5
    );
  }

  surface(p: Vector3, entities: EntityState[], ceiling = Infinity): Vector3 {
    let y = terrainHeight(this.terrain, p.x, p.z);
    for (const entity of entities) {
      const top = entity.position.y + entityHeight(entity);
      if (
        !entity.ownerId &&
        distance(p, entity.position) <= entityRadius(entity) &&
        top <= ceiling + 1e-7
      )
        y = Math.max(y, top);
    }
    return { x: p.x, y, z: p.z };
  }

  clear(p: Vector3, radius: number, height: number, entities: EntityState[]) {
    return (
      this.inBounds(p, radius) &&
      p.y >= terrainHeight(this.terrain, p.x, p.z) - 1e-7 &&
      !entities.some(
        (e) =>
          !e.ownerId &&
          distance(p, e.position) < radius + entityRadius(e) - 1e-7 &&
          p.y < e.position.y + entityHeight(e) - 1e-7 &&
          p.y + height > e.position.y + 1e-7,
      )
    );
  }
}

export interface Flight {
  agentId: string;
  entityId?: string;
  from: Vector3;
  to: Vector3;
  velocity: number;
  duration: number;
  elapsed: number;
}

export function flightPoint(flight: Flight, elapsed: number): Vector3 {
  const t = Math.min(elapsed, flight.duration);
  const progress = t / flight.duration;
  return {
    x: flight.from.x + (flight.to.x - flight.from.x) * progress,
    y: flight.from.y + flight.velocity * t - (GRAVITY * t * t) / 2,
    z: flight.from.z + (flight.to.z - flight.from.z) * progress,
  };
}
