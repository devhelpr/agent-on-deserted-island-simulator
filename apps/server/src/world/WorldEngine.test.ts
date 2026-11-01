import { describe, expect, it } from 'vitest';
import { terrainHeight } from '../../../../packages/shared/src/index.js';
import { generateWorld, DEFAULT_WORLD } from './generateWorld.js';
import { TICK_MS, WorldEngine } from './WorldEngine.js';

describe('deterministic world', () => {
  it('reproduces the same definition and changes with a different seed', () => {
    expect(generateWorld()).toEqual(generateWorld());
    expect(generateWorld({ ...DEFAULT_WORLD, seed: 7 })).not.toEqual(generateWorld());
  });
  it('places all requested objects on terrain with unique IDs', () => {
    const world = generateWorld();
    expect(world.entities).toHaveLength(213);
    expect(new Set(world.entities.map(e => e.id)).size).toBe(213);
    for (const entity of world.entities) {
      expect(entity.position.y).toBeGreaterThan(1);
      expect(entity.position.y).toBeCloseTo(terrainHeight(world.terrain, entity.position.x, entity.position.z), 2);
    }
    expect(world.terrain.heights).toHaveLength(81 * 81);
  });
  it('rejects invalid generator configuration', () => {
    expect(() => generateWorld({ ...DEFAULT_WORLD, size: NaN })).toThrow();
    expect(() => generateWorld({ ...DEFAULT_WORLD, rocks: -1 })).toThrow();
  });
});
describe('authoritative engine', () => {
  it('moves Alpha at 3 m/s, follows terrain and rounds the route without drift', () => {
    const world = generateWorld(); const engine = new WorldEngine(world);
    for (let i = 0; i < 240; i++) engine.step();
    const state = engine.getState();
    expect(state.tick).toBe(240); expect(state.simulationTimeMs).toBe(240 * TICK_MS);
    expect(state.agents[0]!.position.x).toBeCloseTo(18, 8);
    expect(state.agents[0]!.position.z).toBeCloseTo(-18, 8);
    for (let i = 0; i < 720; i++) engine.step();
    expect(engine.getState().agents[0]!.position.x).toBeCloseTo(-18, 8);
    expect(engine.getState().agents[0]!.position.z).toBeCloseTo(-18, 8);
    const p = engine.getState().agents[0]!.position;
    expect(p.y).toBeCloseTo(terrainHeight(world.terrain, p.x, p.z), 8);
  });
  it('isolates definition and snapshots from caller mutations', () => {
    const input = generateWorld(); const engine = new WorldEngine(input);
    input.entities[0]!.position.x = 99999;
    const snapshot = engine.getSnapshot();
    snapshot.definition.entities[0]!.position.x = 99999;
    snapshot.state.agents[0]!.position.x = 99999;
    expect(engine.getSnapshot().definition.entities[0]!.position.x).not.toBe(99999);
    expect(engine.getState().agents[0]!.position.x).toBe(-18);
  });
  it('produces identical states from identical scripted inputs', () => {
    const a = new WorldEngine(generateWorld()); const b = new WorldEngine(generateWorld());
    for (let i = 0; i < 2400; i++) { a.step(); b.step(); }
    expect(a.getState()).toEqual(b.getState());
  });
});
