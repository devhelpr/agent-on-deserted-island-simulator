import { z } from "zod";
export const TICK_MS = 50;
export const CYCLE_TICKS = 72_000;
export const AGENT_RADIUS = 1.1;
export const INTERACTION_RANGE = 3;
export const VISION_RANGE = 50;
export const LIT_VISION_RANGE = 70;
export const VISION_FIELD_OF_VIEW = Math.PI;
export function visionRange(
  agent: Pick<AgentState, "id" | "position">,
  entities: EntityState[],
): number {
  return entities.some(
    (e) =>
      e.activated &&
      ((e.itemKind === "torch" && e.ownerId === agent.id) ||
        (e.itemKind === "campfire" &&
          !e.ownerId &&
          distance(agent.position, e.position) <= 10)),
  )
    ? LIT_VISION_RANGE
    : VISION_RANGE;
}
export const vectorSchema = z.strictObject({
  x: z.number().finite(),
  y: z.number().finite(),
  z: z.number().finite(),
});
export type Vector3 = z.infer<typeof vectorSchema>;
export const ITEMS = {
  wood: { label: "Hout", description: "Voor planken, gereedschap en vuur." },
  stone: { label: "Steen", description: "Voor gereedschap en een kampvuur." },
  fiber: {
    label: "Plantenvezels",
    description: "Te vlechten tot touw en een mand.",
  },
  flint: { label: "Vuursteen", description: "Om een kampvuur aan te steken." },
  resin: { label: "Hars", description: "Brandstof voor een fakkel." },
  plank: { label: "Plank", description: "Bouwmateriaal voor een werkbank." },
  rope: { label: "Touw", description: "Verbindt materialen tot gereedschap." },
  axe: {
    label: "Bijl",
    description: "Verzamelt twee stukken hout per keer uit bomen.",
  },
  pickaxe: {
    label: "Houweel",
    description: "Verzamelt twee stenen per keer uit rotsen.",
  },
  torch: {
    label: "Fakkel",
    description: "Activeren in de tas vergroot het zicht van 50 naar 70 meter.",
  },
  basket: {
    label: "Draagmand",
    description:
      "Eén mand in de tas geeft 12 extra plekken; meerdere manden stapelen niet.",
  },
  workbench: {
    label: "Werkbank",
    description: "Neerleggen om binnen interactieafstand een houweel te maken.",
  },
  campfire: {
    label: "Kampvuur",
    description:
      "Neerleggen en activeren voor 70 meter zicht binnen 10 meter van het vuur.",
  },
} as const;
export type ItemKind = keyof typeof ITEMS;
export interface CraftingRecipe {
  id: Exclude<ItemKind, "wood" | "stone" | "fiber" | "flint" | "resin">;
  ingredients: Partial<Record<ItemKind, number>>;
  quantity: number;
  station?: "workbench";
}
export const RECIPES: readonly CraftingRecipe[] = [
  { id: "plank", ingredients: { wood: 1 }, quantity: 2 },
  { id: "rope", ingredients: { fiber: 2 }, quantity: 1 },
  { id: "axe", ingredients: { wood: 1, stone: 2, rope: 1 }, quantity: 1 },
  { id: "workbench", ingredients: { plank: 4, rope: 1 }, quantity: 1 },
  {
    id: "pickaxe",
    ingredients: { wood: 2, stone: 3, rope: 1 },
    quantity: 1,
    station: "workbench",
  },
  { id: "torch", ingredients: { wood: 1, resin: 1, fiber: 1 }, quantity: 1 },
  { id: "basket", ingredients: { fiber: 3, rope: 2 }, quantity: 1 },
  { id: "campfire", ingredients: { wood: 3, stone: 3, flint: 1 }, quantity: 1 },
];
export const BASE_INVENTORY_CAPACITY = 24;
export function inventoryCapacity(
  items: readonly Pick<WorldEntity, "itemKind">[],
): number {
  return (
    BASE_INVENTORY_CAPACITY +
    (items.some((e) => e.itemKind === "basket") ? 12 : 0)
  );
}
export type EntityType = "tree" | "rock" | "artifact" | "cave" | "item";
export interface WorldEntity {
  id: string;
  type: EntityType;
  position: Vector3;
  rotation: number;
  scale: number;
  kind?: "crystal" | "shell" | "relic";
  label?: string;
  itemKind?: ItemKind;
  properties: { movable: boolean; inspectable: boolean };
}
export interface EntityState extends WorldEntity {
  ownerId: string | null;
  activated: boolean;
  harvested?: number;
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
  z.strictObject({ type: z.literal("gather"), entityId }),
  z.strictObject({
    type: z.literal("craft"),
    recipeId: z.enum([
      "plank",
      "rope",
      "axe",
      "workbench",
      "pickaxe",
      "torch",
      "basket",
      "campfire",
    ]),
  }),
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
  inventoryCapacity?: number;
  /** Angles are radians; orientation 0 faces +z, positive turns toward +x. */
  perception?: {
    range: number;
    fieldOfView: number;
    occlusion: "opaque obstacles block sight";
  };
  recipes?: readonly (CraftingRecipe & {
    craftable: boolean;
    missing: Partial<Record<ItemKind, number>>;
    stationAvailable: boolean;
  })[];
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
    itemKind?: ItemKind;
    activated?: boolean;
    remainingResources?: number;
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
export const simulationSchema = z
  .strictObject({
    worldId: z
      .enum(["island-48291", "island-48291-v3", "island-48291-v4"])
      .default("island-48291-v4"),
    timeScale: speedSchema.shape.timeScale.default(1),
    schedulerMode: schedulerSchema.shape.schedulerMode.default("live"),
    controller: z.enum(["scripted", "codex"]).default("scripted"),
    agentCount: z.union([z.literal(1), z.literal(3)]).default(3),
    experiment: experimentSchema.optional(),
    codexAgentIds: z
      .array(z.enum(["alpha", "beta", "gamma"]))
      .min(1)
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length)
      .default(["alpha"]),
  })
  .refine(
    (input) =>
      input.agentCount !== 1 ||
      input.controller !== "codex" ||
      input.codexAgentIds.every((id) => id === "alpha"),
    { message: "Solo runs only contain Alpha", path: ["codexAgentIds"] },
  );
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
          : entity.type === "item"
            ? 0.45
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
