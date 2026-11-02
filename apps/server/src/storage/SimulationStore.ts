import { experimentMetrics, timeline } from "./experimentMetrics.js";
import { ReplayLog } from "../replay/ReplayLog.js";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.js";
import type {
  AgentObservation,
  DecisionRecord,
  SimulationStatus,
} from "../../../../packages/shared/src/index.js";
import type { WorldEngine } from "../world/WorldEngine.js";
export type Checkpoint = ReturnType<WorldEngine["checkpoint"]>;
export type Experience =
  | {
      kind: "entity";
      entity: AgentObservation["visibleEntities"][number];
      position: AgentObservation["position"];
    }
  | {
      kind: "event";
      event: AgentObservation["recentEvents"][number];
      action?: AgentObservation["lastAction"];
    }
  | {
      kind: "message";
      message: NonNullable<AgentObservation["messages"]>[number];
    };
/** Synchronous SQLite transactions are the commit boundary for the authoritative engine. */
export class SimulationStore {
  readonly sqlite: Database.Database;
  readonly db;
  readonly replay: ReplayLog;
  constructor(path = ":memory:") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sqlite = new Database(path);
    this.sqlite.pragma("journal_mode = WAL");
    this.sqlite.pragma("foreign_keys = ON");
    this.sqlite.pragma("busy_timeout = 5000");
    this.replay = new ReplayLog(this.sqlite);
    this.db = drizzle(this.sqlite, { schema });
    migrate(this.db, {
      migrationsFolder: fileURLToPath(
        new URL("../../drizzle", import.meta.url),
      ),
    });
  }
  transaction<T>(work: () => T): T {
    return this.sqlite.transaction(work)();
  }
  createRun(
    id: string,
    engine: WorldEngine,
    configuration: typeof schema.runs.$inferInsert.configuration,
    status: SimulationStatus,
  ) {
    this.transaction(() => {
      const definition = engine.getDefinition();
      this.db
        .insert(schema.worlds)
        .values({
          id: definition.id,
          version: definition.version,
          seed: definition.seed,
          definition,
        })
        .onConflictDoNothing()
        .run();
      this.db
        .insert(schema.runs)
        .values({
          id,
          worldId: definition.id,
          configuration,
          status: status.status,
          timeScale: status.timeScale,
          mode: status.schedulerMode,
        })
        .run();
      for (const a of engine.getAgents())
        this.db
          .insert(schema.agents)
          .values({ runId: id, id: a.id, name: a.name })
          .run();
    });
  }
  createCycle(runId: string, index: number, engine: WorldEngine) {
    const id = `${runId}:cycle-${index}`;
    this.db
      .insert(schema.cycles)
      .values({
        id,
        runId,
        index,
        status: "active",
        tick: engine.getTick(),
        checkpoint: JSON.stringify(engine.checkpoint()),
      })
      .run();
    this.snapshot(id, "initial", engine);
    return id;
  }
  snapshot(cycleId: string, kind: "initial" | "final", engine: WorldEngine) {
    this.db
      .insert(schema.snapshots)
      .values({
        cycleId,
        kind,
        tick: engine.getTick(),
        state: JSON.stringify(engine.checkpoint()),
      })
      .onConflictDoNothing()
      .run();
  }
  capture(
    runId: string,
    cycleId: string,
    engine: WorldEngine,
    status: SimulationStatus,
    records: DecisionRecord[] = [],
  ) {
    this.transaction(() => {
      const checkpoint = engine.checkpoint();
      this.replay.append(cycleId, checkpoint, engine.getDefinitionVersion());
      this.db
        .update(schema.cycles)
        .set({
          tick: checkpoint.tick,
          checkpoint: JSON.stringify(checkpoint),
          status: status.cycleStatus ?? "active",
        })
        .where(eq(schema.cycles.id, cycleId))
        .run();
      this.db
        .update(schema.runs)
        .set({
          status: status.status,
          timeScale: status.timeScale,
          mode: status.schedulerMode,
        })
        .where(eq(schema.runs.id, runId))
        .run();
      const lastSequence =
        this.db
          .select()
          .from(schema.events)
          .where(eq(schema.events.cycleId, cycleId))
          .orderBy(desc(schema.events.sequence))
          .limit(1)
          .get()?.sequence ?? 0;
      for (const event of checkpoint.events.filter(
        (e) => e.sequence > lastSequence,
      )) {
        this.db
          .insert(schema.events)
          .values({
            cycleId,
            sequence: event.sequence,
            tick: event.tick,
            payload: JSON.stringify(event),
          })
          .run();
        const outcome = event.actionId
          ? engine.getAction(event.actionId)
          : undefined;
        if (outcome)
          for (const row of this.db
            .select()
            .from(schema.decisions)
            .where(eq(schema.decisions.cycleId, cycleId))
            .all()) {
            if (row.payload.actionId === event.actionId)
              this.saveDecision(cycleId, { ...row.payload, outcome });
          }
      }
      for (const agent of engine.getAgents())
        this.observe(cycleId, engine.observe(agent.id)!);
      for (const record of records) this.saveDecision(cycleId, record);
      for (const session of status.agentSessions ?? [])
        this.db
          .insert(schema.sessions)
          .values({ cycleId, agentId: session.agentId, payload: session })
          .onConflictDoUpdate({
            target: [schema.sessions.cycleId, schema.sessions.agentId],
            set: { payload: session },
          })
          .run();
    });
  }
  observe(cycleId: string, o: AgentObservation) {
    const put = (key: string, tick: number, payload: Experience) =>
      this.db
        .insert(schema.experiences)
        .values({
          id: `${cycleId}:${o.agentId}:${key}`,
          cycleId,
          agentId: o.agentId,
          tick,
          payload: JSON.stringify(payload),
        })
        .onConflictDoNothing()
        .run();
    for (const entity of o.visibleEntities)
      put(
        `entity:${entity.id}:${entity.position.x.toFixed(2)}:${entity.position.z.toFixed(2)}:${entity.ownerId ?? "free"}`,
        o.tick,
        { kind: "entity", entity, position: o.position },
      );
    for (const event of o.recentEvents)
      put(`event:${event.sequence}`, event.tick, {
        kind: "event",
        event,
        action: o.lastAction?.id === event.actionId ? o.lastAction : undefined,
      });
    for (const message of o.messages ?? [])
      put(
        `message:${message.from}:${message.tick}:${message.text}`,
        message.tick,
        { kind: "message", message },
      );
  }
  saveDecision(cycleId: string, record: DecisionRecord) {
    this.db
      .insert(schema.decisions)
      .values({
        cycleId,
        id: record.id,
        agentId: record.agentId,
        payload: record,
      })
      .onConflictDoUpdate({
        target: [schema.decisions.cycleId, schema.decisions.id],
        set: { payload: record },
      })
      .run();
    record.tools.forEach((tool, index) =>
      this.db
        .insert(schema.tools)
        .values({
          cycleId,
          decisionId: record.id,
          index,
          payload: JSON.stringify(tool),
        })
        .onConflictDoUpdate({
          target: [
            schema.tools.cycleId,
            schema.tools.decisionId,
            schema.tools.index,
          ],
          set: { payload: JSON.stringify(tool) },
        })
        .run(),
    );
  }
  listDecisions(runId: string, agentId: string) {
    return this.db
      .select({
        cycleId: schema.decisions.cycleId,
        cycleIndex: schema.cycles.index,
        payload: schema.decisions.payload,
      })
      .from(schema.decisions)
      .innerJoin(schema.cycles, eq(schema.cycles.id, schema.decisions.cycleId))
      .where(
        and(
          eq(schema.cycles.runId, runId),
          eq(schema.decisions.agentId, agentId),
        ),
      )
      .all()
      .sort(
        (a, b) =>
          a.cycleIndex - b.cycleIndex ||
          a.payload.tick - b.payload.tick ||
          a.payload.id.localeCompare(b.payload.id),
      )
      .map((r) => ({ ...r.payload, cycleId: r.cycleId }));
  }
  recoverableRuns() {
    return this.db
      .select()
      .from(schema.runs)
      .all()
      .map((run) => {
        const cycle = this.db
          .select()
          .from(schema.cycles)
          .where(eq(schema.cycles.runId, run.id))
          .all()
          .sort((a, b) => b.index - a.index)[0]!;
        const definition = this.db
          .select()
          .from(schema.worlds)
          .where(eq(schema.worlds.id, run.worldId))
          .get()!.definition;
        return { run, cycle, definition };
      });
  }
  metrics(runId: string) {
    return experimentMetrics(this.sqlite, runId);
  }
  timeline(cycleId: string, after: number) {
    return timeline(this.sqlite, cycleId, after);
  }
  close() {
    this.sqlite.close();
  }
}
