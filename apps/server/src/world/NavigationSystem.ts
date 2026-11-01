import {
  AGENT_RADIUS,
  distance,
  entityRadius,
  terrainHeight,
  type EntityState,
  type Terrain,
  type Vector3,
} from "../../../../packages/shared/src/index.js";

interface Triangle {
  id: number;
  center: Vector3;
  neighbors: number[];
  walkable: boolean;
}
export function segmentDistance(p: Vector3, a: Vector3, b: Vector3): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1),
    ),
  );
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
/** A terrain-derived triangular navmesh. A* joins triangle centroids; each edge is clearance-tested. */
export class NavigationSystem {
  readonly triangles: Triangle[] = [];
  private readonly cells: number;
  private obstacles: EntityState[] = [];
  private readonly edgeCache = new Map<string, boolean>();
  constructor(
    readonly terrain: Terrain,
    entities: EntityState[],
  ) {
    this.cells = terrain.resolution - 1;
    const edges = new Map<string, number>();
    const vertex = (x: number, z: number): Vector3 => ({
      x: (x / this.cells - 0.5) * terrain.width,
      y: terrain.heights[z * terrain.resolution + x]!,
      z: (z / this.cells - 0.5) * terrain.depth,
    });
    for (let z = 0; z < this.cells; z++)
      for (let x = 0; x < this.cells; x++) {
        const a = z * terrain.resolution + x;
        const b = a + 1;
        const c = a + terrain.resolution;
        const d = c + 1;
        for (const vertices of [
          [a, c, b],
          [b, c, d],
        ]) {
          const points = vertices.map((v) =>
            vertex(v % terrain.resolution, Math.floor(v / terrain.resolution)),
          );
          const center = {
            x: points.reduce((s, p) => s + p.x, 0) / 3,
            y: 0,
            z: points.reduce((s, p) => s + p.z, 0) / 3,
          };
          center.y = terrainHeight(terrain, center.x, center.z);
          const walkable =
            points.every((p) => p.y > 0.5) &&
            points.every((p, i) => {
              const q = points[(i + 1) % 3]!;
              return Math.abs(p.y - q.y) / distance(p, q) <= 0.8;
            });
          const triangle: Triangle = {
            id: this.triangles.length,
            center,
            neighbors: [],
            walkable,
          };
          this.triangles.push(triangle);
          for (let i = 0; i < 3; i++) {
            const v = vertices[i]!;
            const w = vertices[(i + 1) % 3]!;
            const key = `${Math.min(v, w)}:${Math.max(v, w)}`;
            const neighbor = edges.get(key);
            if (neighbor !== undefined) {
              triangle.neighbors.push(neighbor);
              this.triangles[neighbor]!.neighbors.push(triangle.id);
            } else edges.set(key, triangle.id);
          }
        }
      }
    this.updateObstacles(entities);
  }
  updateObstacles(entities: EntityState[]) {
    this.obstacles = structuredClone(entities.filter((e) => !e.ownerId));
    this.edgeCache.clear();
  }
  point(x: number, z: number): Vector3 {
    return { x, y: terrainHeight(this.terrain, x, z), z };
  }
  isWalkable(p: Vector3, clearance = AGENT_RADIUS): boolean {
    const t = this.terrain;
    if (
      Math.abs(p.x) > t.width / 2 - clearance ||
      Math.abs(p.z) > t.depth / 2 - clearance
    )
      return false;
    const height = terrainHeight(t, p.x, p.z);
    if (height < 0.5) return false;
    // Probe the agent footprint, including local slope and shore clearance.
    for (const [dx, dz] of [
      [clearance, 0],
      [-clearance, 0],
      [0, clearance],
      [0, -clearance],
    ]) {
      const h = terrainHeight(t, p.x + dx!, p.z + dz!);
      if (h < 0.5 || Math.abs(h - height) / clearance > 0.8) return false;
    }
    return !this.obstacles.some(
      (e) => distance(e.position, p) < entityRadius(e) + clearance - 1e-7,
    );
  }
  canTraverse(a: Vector3, b: Vector3, clearance = AGENT_RADIUS): boolean {
    if (
      this.obstacles.some(
        (e) =>
          segmentDistance(e.position, a, b) <
          entityRadius(e) + clearance - 1e-7,
      )
    )
      return false;
    const samples = Math.max(1, Math.ceil(distance(a, b) / 0.75));
    for (let i = 0; i <= samples; i++)
      if (
        !this.isWalkable(
          this.point(
            a.x + ((b.x - a.x) * i) / samples,
            a.z + ((b.z - a.z) * i) / samples,
          ),
          clearance,
        )
      )
        return false;
    return true;
  }
  private anchors(p: Vector3): Triangle[] {
    const x = Math.floor((p.x / this.terrain.width + 0.5) * this.cells);
    const z = Math.floor((p.z / this.terrain.depth + 0.5) * this.cells);
    const candidates: Triangle[] = [];
    for (let dz = -2; dz <= 2; dz++)
      for (let dx = -2; dx <= 2; dx++) {
        const cx = x + dx;
        const cz = z + dz;
        if (cx < 0 || cz < 0 || cx >= this.cells || cz >= this.cells) continue;
        for (let side = 0; side < 2; side++) {
          const tri = this.triangles[(cz * this.cells + cx) * 2 + side]!;
          if (tri.walkable) candidates.push(tri);
        }
      }
    return candidates
      .sort(
        (a, b) => distance(a.center, p) - distance(b.center, p) || a.id - b.id,
      )
      .filter((t) => this.canTraverse(p, t.center))
      .slice(0, 4);
  }
  findPath(from: Vector3, to: Vector3): Vector3[] | null {
    const start = this.point(from.x, from.z);
    const goal = this.point(to.x, to.z);
    if (!this.isWalkable(start) || !this.isWalkable(goal)) return null;
    if (this.canTraverse(start, goal)) return [goal];
    const starts = this.anchors(start);
    const goals = this.anchors(goal);
    const goalIds = new Set(goals.map((t) => t.id));
    if (!starts.length || !goals.length) return null;
    const open = new Set<number>();
    const costs = new Map<number, number>();
    const parent = new Map<number, number>();
    for (const t of starts) {
      open.add(t.id);
      costs.set(t.id, distance(start, t.center));
    }
    while (open.size) {
      let current = -1;
      let best = Infinity;
      for (const id of open) {
        const f = costs.get(id)! + distance(this.triangles[id]!.center, goal);
        if (f < best || (f === best && id < current)) {
          best = f;
          current = id;
        }
      }
      if (goalIds.has(current)) {
        const route: Vector3[] = [goal];
        let id: number | undefined = current;
        while (id !== undefined) {
          route.unshift({ ...this.triangles[id]!.center });
          id = parent.get(id);
        }
        // Greedy line-of-sight smoothing, always validated against terrain and obstacles.
        const smooth: Vector3[] = [];
        let p = start;
        while (route.length) {
          let i = route.length - 1;
          while (i > 0 && !this.canTraverse(p, route[i]!)) i--;
          p = route[i]!;
          smooth.push(p);
          route.splice(0, i + 1);
        }
        return smooth;
      }
      open.delete(current);
      const triangle = this.triangles[current]!;
      for (const id of triangle.neighbors) {
        const next = this.triangles[id]!;
        if (!next.walkable) continue;
        const key = `${Math.min(current, id)}:${Math.max(current, id)}`;
        let clear = this.edgeCache.get(key);
        if (clear === undefined) {
          clear = this.canTraverse(triangle.center, next.center);
          this.edgeCache.set(key, clear);
        }
        if (!clear) continue;
        const cost =
          costs.get(current)! + distance(triangle.center, next.center);
        if (cost < (costs.get(id) ?? Infinity)) {
          parent.set(id, current);
          costs.set(id, cost);
          open.add(id);
        }
      }
    }
    return null;
  }
}
