import { z } from "zod";
export const TICK_MS = 50;
export const CYCLE_TICKS = 72_000;
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
  kind?: "crystal" | "shell" | "relic";
  label?: string;
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
  controller: "scripted" | "codex";
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
    type: z.literal("communicate"),
    recipientId: entityId,
    message: z.string().min(1).max(500),
  }),
  z.strictObject({
    type: z.literal("wait"),
    durationMs: z.number().int().min(50).max(60000),
  }),
]);
export type WorldActionInput = z.infer<typeof actionSchema>;
export type ActionStatus =
  "queued" | "running" | "succeeded" | "failed" | "cancelled";
export const artifactConsiderationSchema = z.strictObject({
  entityId: z.string().min(1).max(80),
  decision: z.enum([
    "pickup",
    "approach",
    "keep",
    "defer",
    "leave",
    "inspect",
    "place",
  ]),
  reason: z.string().min(1).max(300),
});
export type ArtifactConsideration = z.infer<typeof artifactConsiderationSchema>;
export const actionExplanationSchema = z.strictObject({
  motivation: z.string().min(1).max(500).optional(),
  artifactConsiderations: z
    .array(artifactConsiderationSchema)
    .max(8)
    .optional(),
});
export type ActionExplanation = z.infer<typeof actionExplanationSchema>;
export interface ActionRecord extends ActionExplanation {
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
export interface WorldEvent extends ActionExplanation {
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
  lastAction?: ActionRecord;
  messages?: { from: string; text: string; tick: number }[];
  visibleEntities: {
    id: string;
    type: EntityType;
    position: Vector3;
    distance: number;
    direction: number;
    radius: number;
    ownerId: string | null;
    kind?: WorldEntity["kind"];
    label?: string;
    movable?: boolean;
    pickup?: {
      eligible: boolean;
      blocker:
        | "NOT_MOVABLE"
        | "OBJECT_UNAVAILABLE"
        | "INVENTORY_FULL"
        | "OUT_OF_RANGE"
        | null;
      interactionDistance: number;
    };
  }[];
  visibleAgents: { id: string; position: Vector3; distance: number }[];
  recentEvents: WorldEvent[];
  memory?: MemoryContext;
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
export const experimentSchema = z.strictObject({
  maxCycles: z.number().int().min(1).max(100).default(2),
  decisionBudgetPerAgentPerCycle: z
    .number()
    .int()
    .min(1)
    .max(10000)
    .default(120),
});
export type ExperimentConfig = z.infer<typeof experimentSchema>;
export interface ExperimentProgress extends ExperimentConfig {
  decisionsUsed: Record<string, number>;
  exhaustedAgents: string[];
  completed: boolean;
}
export interface CycleMetrics {
  cycleId: string;
  cycleIndex: number;
  status: string;
  tick: number;
  agents: {
    agentId: string;
    decisions: number;
    failures: number;
    cancelled: number;
    toolCalls: number;
    decisionTimeMs: number;
    discoveries: number;
    revisits: number;
    observationCells: number;
    messagesSent: number;
    sharedObjects: number;
    movesToMemoryTargets: number;
    verifiedLocations: number;
    contradictedLocations: number;
  }[];
}
export const simulationSchema = z.strictObject({
  worldId: z
    .enum(["island-48291", "island-48291-v3"])
    .default("island-48291-v3"),
  timeScale: speedSchema.shape.timeScale.default(1),
  schedulerMode: schedulerSchema.shape.schedulerMode.default("live"),
  controller: z.enum(["scripted", "codex"]).default("scripted"),
  experiment: experimentSchema.optional(),
  codexAgentIds: z
    .array(z.enum(["alpha", "beta", "gamma"]))
    .min(1)
    .max(3)
    .refine((ids) => new Set(ids).size === ids.length)
    .default(["alpha"]),
});
export type SchedulerMode = z.infer<typeof schedulerSchema>["schedulerMode"];
export interface AgentSessionStatus {
  agentId: string;
  controller: "scripted" | "codex";
  status: "idle" | "thinking" | "failed";
  threadId: string | null;
  turnId: string | null;
  decisions: number;
  lastError?: string;
}
export interface DecisionRecord extends ActionExplanation {
  id: string;
  agentId: string;
  tick: number;
  observation: AgentObservation;
  status: "thinking" | "proposed" | "submitted" | "failed" | "cancelled";
  threadId?: string;
  turnId?: string;
  action?: WorldActionInput;
  actionId?: string;
  motivation?: string;
  publicMessage?: string;
  error?: string;
  outcome?: ActionRecord;
  durationMs?: number;
  tools: {
    tool: string;
    arguments: unknown;
    result: unknown;
    success: boolean;
  }[];
}
export interface AgentMemory {
  id: string;
  agentId: string;
  cycleId: string;
  type: "episodic" | "semantic" | "procedural";
  provenance: "observed" | "inferred" | "reported";
  content: string;
  confidence: number;
  importance: number;
  sourceEventIds: string[];
  createdAtTick: number;
  claimKey: string;
  supersededBy?: string;
  revision: number;
  conflictsWith?: string[];
  target?: Vector3;
}
export interface MemoryContext {
  summary: string;
  relevant: AgentMemory[];
  recent: string[];
  goals: string[];
}
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
  agentSessions?: AgentSessionStatus[];
  cycleId?: string;
  cycleIndex?: number;
  cycleStatus?: "active" | "closing" | "completed";
  experiment?: ExperimentProgress;
  cycleError?: string;
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
