import { terrainHeight, type AgentState, type WorldDefinition, type WorldSnapshot, type WorldStateDto } from '../../../../packages/shared/src/index.js';

export const TICK_MS = 50;
const ROUTE = [{ x: 18, z: -18 }, { x: 18, z: 18 }, { x: -18, z: 18 }, { x: -18, z: -18 }];
/** Only this engine mutates runtime positions. No Codex or renderer dependencies. */
export class WorldEngine {
  private readonly definition: WorldDefinition;
  private tick = 0;
  private waypoint = 0;
  private readonly agent: AgentState;
  constructor(definition: WorldDefinition) {
    this.definition = structuredClone(definition);
    if (!definition.spawnPoints[0]) throw new Error('World needs a spawn point');
    this.agent = { id: 'alpha', name: 'Alpha', position: { ...definition.spawnPoints[0] }, orientation: 0, status: 'moving', controller: 'scripted' };
  }
  step(): void {
    const target = ROUTE[this.waypoint]!;
    const p = this.agent.position;
    const dx = target.x - p.x; const dz = target.z - p.z;
    const distance = Math.hypot(dx, dz);
    const step = Math.min(distance, 3 * TICK_MS / 1000);
    if (distance > 0) {
      p.x += dx / distance * step; p.z += dz / distance * step;
      p.y = terrainHeight(this.definition.terrain, p.x, p.z);
      this.agent.orientation = Math.atan2(dx, dz);
    }
    if (distance <= step) this.waypoint = (this.waypoint + 1) % ROUTE.length;
    this.tick++;
  }
  getState(): WorldStateDto {
    return { worldId: this.definition.id, tick: this.tick, simulationTimeMs: this.tick * TICK_MS, agents: structuredClone([this.agent]) };
  }
  getSnapshot(): WorldSnapshot { return { definition: structuredClone(this.definition), state: this.getState() }; }
}
