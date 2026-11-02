import {
  terrainHeight,
  type WorldDefinition,
  type WorldEntity,
  type EntityType,
} from "../../../../packages/shared/src/index.js";

export interface WorldConfig {
  seed: number;
  size: number;
  trees: number;
  rocks: number;
  artifacts: number;
  caves: number;
}
export const DEFAULT_WORLD: WorldConfig = {
  seed: 48291,
  size: 500,
  trees: 120,
  rocks: 80,
  artifacts: 12,
  caves: 1,
};
function randomGenerator(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mm = (n: number) => Math.round(n * 1000) / 1000;
export function generateWorld(
  config: WorldConfig = DEFAULT_WORLD,
): WorldDefinition {
  if (
    !Number.isInteger(config.seed) ||
    !Number.isFinite(config.size) ||
    config.size < 100 ||
    [config.trees, config.rocks, config.artifacts, config.caves].some(
      (n) => !Number.isInteger(n) || n < 0 || n > 10000,
    )
  ) {
    throw new Error("Invalid world configuration");
  }
  const random = randomGenerator(config.seed);
  const phase = random() * Math.PI * 2;
  const resolution = 81;
  const terrain = {
    width: config.size,
    depth: config.size,
    resolution,
    heights: [] as number[],
  };
  for (let z = 0; z < resolution; z++)
    for (let x = 0; x < resolution; x++) {
      const nx = (x / (resolution - 1) - 0.5) * 2;
      const nz = (z / (resolution - 1) - 0.5) * 2;
      const angle = Math.atan2(nz, nx);
      const radius =
        Math.hypot(nx, nz) /
        (0.83 +
          0.06 * Math.sin(angle * 5 + phase) +
          0.04 * Math.cos(angle * 3));
      const hill = Math.max(0, 1 - radius);
      const height =
        hill * 27 + Math.sin(nx * 9 + phase) * Math.cos(nz * 7) * hill * 6 - 3;
      terrain.heights.push(mm(height));
    }
  const position = (x: number, z: number) => ({
    x: mm(x),
    y: mm(terrainHeight(terrain, mm(x), mm(z))),
    z: mm(z),
  });
  const entities: WorldEntity[] = [];
  const counts: [EntityType, number][] = [
    ["tree", config.trees],
    ["rock", config.rocks],
    ["artifact", config.artifacts],
    ["cave", config.caves],
  ];
  for (const [type, count] of counts)
    for (let i = 0; i < count; i++) {
      let placed = false;
      for (let attempt = 0; attempt < 2000; attempt++) {
        const p =
          type === "artifact" && i < 3 && attempt === 0
            ? position(-26, -16 + i * 6)
            : position(
                (random() - 0.5) * config.size,
                (random() - 0.5) * config.size,
              );
        // Keep the spawn area clear for the three agents.
        if (
          p.y < 1 ||
          (Math.hypot(p.x, p.z) < 30 && type !== "artifact") ||
          entities.some(
            (e) => Math.hypot(e.position.x - p.x, e.position.z - p.z) < 4,
          )
        )
          continue;
        entities.push({
          id: `${type}-${i + 1}`,
          type,
          position: p,
          rotation: mm(random() * Math.PI * 2),
          scale: mm(0.8 + random() * 0.7),
          ...(type === "artifact"
            ? {
                kind: (["crystal", "shell", "relic"] as const)[i % 3],
                label: ["Glowing crystal", "Golden shell", "Ancient relic"][
                  i % 3
                ],
              }
            : {}),
          properties: {
            movable: type === "rock" || type === "artifact",
            inspectable: true,
          },
        });
        placed = true;
        break;
      }
      if (!placed)
        throw new Error(
          "World configuration is too dense to place all objects",
        );
    }
  return {
    id: `island-${config.seed}-v3`,
    version: 3,
    seed: config.seed,
    terrain,
    spawnPoints: [position(-18, -18), position(-12, -18), position(-6, -18)],
    entities,
  };
}
