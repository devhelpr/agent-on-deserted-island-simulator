import {
  integer,
  real,
  sqliteTable,
  text,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import type {
  AgentMemory,
  AgentSessionStatus,
  DecisionRecord,
  WorldDefinition,
} from "../../../../packages/shared/src/index.js";
export const worlds = sqliteTable("world_definitions", {
  id: text().primaryKey(),
  version: integer().notNull(),
  seed: integer().notNull(),
  definition: text({ mode: "json" }).$type<WorldDefinition>().notNull(),
});
export const runs = sqliteTable("simulation_runs", {
  id: text().primaryKey(),
  worldId: text()
    .notNull()
    .references(() => worlds.id),
  configuration: text({ mode: "json" })
    .$type<{ controller: "scripted" | "codex"; codexAgentIds: string[] }>()
    .notNull(),
  status: text().notNull(),
  timeScale: integer().notNull(),
  mode: text().notNull(),
});
export const cycles = sqliteTable("simulation_cycles", {
  id: text().primaryKey(),
  runId: text()
    .notNull()
    .references(() => runs.id),
  index: integer().notNull(),
  status: text().notNull(),
  tick: integer().notNull(),
  checkpoint: text().notNull(),
  outcome: text(),
});
export const agents = sqliteTable(
  "agents",
  {
    runId: text()
      .notNull()
      .references(() => runs.id),
    id: text().notNull(),
    name: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.id] })],
);
export const sessions = sqliteTable(
  "agent_sessions",
  {
    cycleId: text()
      .notNull()
      .references(() => cycles.id),
    agentId: text().notNull(),
    payload: text({ mode: "json" }).$type<AgentSessionStatus>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.agentId] })],
);
export const memories = sqliteTable("agent_memories", {
  id: text().primaryKey(),
  runId: text()
    .notNull()
    .references(() => runs.id),
  agentId: text().notNull(),
  cycleId: text()
    .notNull()
    .references(() => cycles.id),
  type: text().notNull(),
  provenance: text().notNull(),
  claimKey: text().notNull(),
  content: text().notNull(),
  confidence: real().notNull(),
  importance: real().notNull(),
  supersededBy: text(),
  payload: text({ mode: "json" }).$type<AgentMemory>().notNull(),
});
export const revisions = sqliteTable(
  "memory_revisions",
  {
    memoryId: text()
      .notNull()
      .references(() => memories.id),
    revision: integer().notNull(),
    payload: text({ mode: "json" }).$type<AgentMemory>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.memoryId, t.revision] })],
);
export const events = sqliteTable(
  "world_events",
  {
    cycleId: text()
      .notNull()
      .references(() => cycles.id),
    sequence: integer().notNull(),
    tick: integer().notNull(),
    payload: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.sequence] })],
);
export const snapshots = sqliteTable(
  "world_snapshots",
  {
    cycleId: text()
      .notNull()
      .references(() => cycles.id),
    kind: text().notNull(),
    tick: integer().notNull(),
    state: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.kind] })],
);
export const decisions = sqliteTable(
  "agent_decisions",
  {
    cycleId: text()
      .notNull()
      .references(() => cycles.id),
    id: text().notNull(),
    agentId: text().notNull(),
    payload: text({ mode: "json" }).$type<DecisionRecord>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.id] })],
);
export const tools = sqliteTable(
  "tool_calls",
  {
    cycleId: text()
      .notNull()
      .references(() => cycles.id),
    decisionId: text().notNull(),
    index: integer().notNull(),
    payload: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.decisionId, t.index] })],
);
export const experiences = sqliteTable("agent_experiences", {
  id: text().primaryKey(),
  cycleId: text()
    .notNull()
    .references(() => cycles.id),
  agentId: text().notNull(),
  tick: integer().notNull(),
  payload: text().notNull(),
});
export const consolidations = sqliteTable(
  "memory_consolidations",
  {
    cycleId: text()
      .notNull()
      .references(() => cycles.id),
    agentId: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.agentId] })],
);
export const replayFrames = sqliteTable(
  "replay_frames",
  {
    cycleId: text("cycle_id")
      .notNull()
      .references(() => cycles.id),
    sequence: integer().notNull(),
    tick: integer().notNull(),
    full: integer().notNull(),
    payload: text().notNull(),
    hash: text().notNull(),
    versions: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.cycleId, t.sequence] })],
);
