export interface Vector3 { x: number; y: number; z: number }
export type EntityType = 'tree' | 'rock' | 'artifact' | 'cave';
export interface WorldEntity {
  id: string; type: EntityType; position: Vector3; rotation: number; scale: number;
  properties: { movable: boolean; inspectable: boolean };
}
export interface Terrain {
  width: number; depth: number; resolution: number; heights: number[];
}
export interface WorldDefinition {
  id: string; version: number; seed: number; terrain: Terrain;
  spawnPoints: Vector3[]; entities: WorldEntity[];
}
export interface AgentState {
  id: string; name: string; position: Vector3; orientation: number;
  status: 'moving'; controller: 'scripted';
}
export interface WorldStateDto {
  worldId: string; tick: number; simulationTimeMs: number; agents: AgentState[];
}
export interface WorldSnapshot { definition: WorldDefinition; state: WorldStateDto }
export interface ServerEvents {
  'world:snapshot': (snapshot: WorldSnapshot) => void;
  'world:delta': (state: WorldStateDto) => void;
}
export interface ClientEvents {}

/** Bilinear sampling of the authoritative, row-major heightmap (metres). */
export function terrainHeight(terrain: Terrain, x: number, z: number): number {
  const { resolution: n, width, depth, heights } = terrain;
  const gx = Math.max(0, Math.min(n - 1, (x / width + 0.5) * (n - 1)));
  const gz = Math.max(0, Math.min(n - 1, (z / depth + 0.5) * (n - 1)));
  const x0 = Math.min(n - 2, Math.floor(gx));
  const z0 = Math.min(n - 2, Math.floor(gz));
  const tx = gx - x0; const tz = gz - z0;
  const a = heights[z0 * n + x0]! * (1 - tx) + heights[z0 * n + x0 + 1]! * tx;
  const b = heights[(z0 + 1) * n + x0]! * (1 - tx) + heights[(z0 + 1) * n + x0 + 1]! * tx;
  return a * (1 - tz) + b * tz;
}
