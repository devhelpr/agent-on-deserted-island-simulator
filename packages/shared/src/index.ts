import { z } from "zod";
export const TICK_MS = 50;
export const AGENT_RADIUS = 1.1;
export const INTERACTION_RANGE = 3;
export const vectorSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
export type Vector3 = z.infer<typeof vectorSchema>;
export type EntityType = "tree" | "rock" | "artifact" | "cave";
export interface WorldEntity {
  id: string;
  type: EntityType;
  position: Vector3;
  rotation: number;
  scale: number;
  properties: { movable: boolean; inspectable: boolean };
}
export interface EntityState extends WorldEntity {
  ownerId: string | null;
  activated: boolean;
}
export interface Terrain {
  width: number;
  depth: number;
  resolution: number;
  heights: number[];
}
export interface WorldDefinition {
  id: string;
  version: number;
  seed: number;
  terrain: Terrain;
  spawnPoints: Vector3[];
  entities: WorldEntity[];
}
export interface AgentState {
  id: string;
  name: string;
  position: Vector3;
  orientation: number;
  status: "idle" | "queued" | "moving" | "waiting";
  controller: "scripted";
  inventory: string[];
  activeActionId: string | null;
}
const entityId = z.string().min(1).max(80);
export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("move"), target: vectorSchema }),
  z.strictObject({
    type: z.literal("look"),
    orientation: z.number().finite().min(-Math.PI).max(Math.PI),
  }),
  z.strictObject({ type: z.literal("inspect"), entityId }),
  z.strictObject({
    type: z.literal("interact"),
    entityId,
    interaction: z.literal("activate"),
  }),
  z.strictObject({ type: z.literal("pickup"), entityId }),
  z.strictObject({ type: z.literal("drop"), entityId, target: vectorSchema }),
  z.strictObject({
    type: z.literal("wait"),
    durationMs: z.number().int().min(50).max(60000),
  }),
]);
export type WorldActionInput = z.infer<typeof actionSchema>;
export type ActionStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";
export interface ActionRecord {
  id: string;
  agentId: string;
  input: WorldActionInput;
  status: ActionStatus;
  submittedAtTick: number;
  startedAtTick?: number;
  finishedAtTick?: number;
  error?: string;
  result?: unknown;
}
export interface WorldEvent {
  sequence: number;
  tick: number;
  type: string;
  actorId: string;
  actionId?: string;
  targetId?: string;
  position: Vector3;
  message: string;
}
export interface AgentObservation {
  tick: number;
  agentId: string;
  position: Vector3;
  orientation: number;
  inventory: string[];
  visibleEntities: {
    id: string;
    type: EntityType;
    position: Vector3;
    distance: number;
    direction: number;
    radius: number;
    ownerId: string | null;
  }[];
  visibleAgents: { id: string; position: Vector3; distance: number }[];
  recentEvents: WorldEvent[];
}
export interface WorldStateDto {
  worldId: string;
  tick: number;
  simulationTimeMs: number;
  agents: AgentState[];
  entities: EntityState[];
  actions: ActionRecord[];
  events: WorldEvent[];
}
export const speedSchema = z.strictObject({
  timeScale: z.union([
    z.literal(1),
    z.literal(2),
    z.literal(5),
    z.literal(10),
    z.literal(20),
  ]),
});
export const schedulerSchema = z.strictObject({
  schedulerMode: z.enum(["live", "experiment"]),
});
export const simulationSchema = z.strictObject({
  worldId: z.literal("island-48291").default("island-48291"),
  timeScale: speedSchema.shape.timeScale.default(1),
  schedulerMode: schedulerSchema.shape.schedulerMode.default("live"),
});
export type SchedulerMode = z.infer<typeof schedulerSchema>["schedulerMode"];
export interface SimulationStatus {
  id: string;
  status: "running" | "paused" | "stopped";
  mode: "realtime" | "accelerated";
  schedulerMode: SchedulerMode;
  timeScale: number;
  tick: number;
  simulationTimeMs: number;
  wallTimeMs: number;
  backlogMs: number;
  droppedSimulationTimeMs: number;
  waitingForDecisions: boolean;
  pendingAgents: string[];
}
export interface WorldSnapshot {
  simulation: SimulationStatus;
  definition: WorldDefinition;
  state: WorldStateDto;
}
export interface ServerEvents {
  "world:snapshot": (snapshot: WorldSnapshot) => void;
  "world:delta": (update: {
    simulationId: string;
    state: WorldStateDto;
  }) => void;
  "simulation:state": (state: SimulationStatus) => void;
}
export interface ClientEvents {
  "simulation:subscribe": (
    id: string,
    ack: (result: { ok: boolean; error?: string }) => void,
  ) => void;
}
export function entityRadius(entity: WorldEntity): number {
  return (
    (entity.type === "tree"
      ? 0.9
      : entity.type === "rock"
        ? 2.9
        : entity.type === "cave"
          ? 10
          : 1.5) * entity.scale
  );
}
export function distance(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
/** Bilinear sampling of the authoritative, row-major heightmap (metres). */
export function terrainHeight(terrain: Terrain, x: number, z: number): number {
  const { resolution: n, width, depth, heights } = terrain;
  const gx = Math.max(0, Math.min(n - 1, (x / width + 0.5) * (n - 1)));
  const gz = Math.max(0, Math.min(n - 1, (z / depth + 0.5) * (n - 1)));
  const x0 = Math.min(n - 2, Math.floor(gx));
  const z0 = Math.min(n - 2, Math.floor(gz));
  const tx = gx - x0;
  const tz = gz - z0;
  const a = heights[z0 * n + x0]! * (1 - tx) + heights[z0 * n + x0 + 1]! * tx;
  const b =
    heights[(z0 + 1) * n + x0]! * (1 - tx) +
    heights[(z0 + 1) * n + x0 + 1]! * tx;
  return a * (1 - tz) + b * tz;
}
