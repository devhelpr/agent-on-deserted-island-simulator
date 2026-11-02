import type Database from "better-sqlite3";
import {
  distance,
  type CycleMetrics,
  type DecisionRecord,
  type WorldEvent,
} from "../../../../packages/shared/src/index.js";
import type { Experience } from "./SimulationStore.js";

/** Evidence-based comparisons. Reaching a supplied memory target is a proxy, not proof of model reasoning. */
export function experimentMetrics(
  db: Database.Database,
  runId: string,
): CycleMetrics[] {
  const cycles = db
    .prepare(
      'SELECT id, "index" AS cycleIndex, status, tick FROM simulation_cycles WHERE runId=? ORDER BY "index"',
    )
    .all(runId) as {
    id: string;
    cycleIndex: number;
    status: string;
    tick: number;
  }[];
  const previous = new Map<string, Set<string>>();
  const sources = new Map<string, Experience>();
  const agentIds = (
    db
      .prepare("SELECT id FROM agents WHERE runId=? ORDER BY id")
      .all(runId) as { id: string }[]
  ).map((r) => r.id);
  return cycles.map((cycle) => {
    const experiences = db
      .prepare(
        "SELECT id,agentId,payload FROM agent_experiences WHERE cycleId=? ORDER BY tick,id",
      )
      .all(cycle.id) as { id: string; agentId: string; payload: string }[];
    for (const e of experiences) sources.set(e.id, JSON.parse(e.payload));
    const records = (
      db
        .prepare("SELECT payload FROM agent_decisions WHERE cycleId=?")
        .all(cycle.id) as { payload: string }[]
    ).map((r) => JSON.parse(r.payload) as DecisionRecord);
    // Shared objects require successful explicit interaction by different agents within the cycle.
    const objectActors = new Map<string, Set<string>>();
    const events = timelineAll(db, cycle.id);
    for (const e of events) {
      if (e.type !== "action:succeeded" || !e.targetId) continue;
      const actors = objectActors.get(e.targetId) ?? new Set<string>();
      actors.add(e.actorId);
      objectActors.set(e.targetId, actors);
    }
    return {
      cycleId: cycle.id,
      cycleIndex: cycle.cycleIndex,
      status: cycle.status,
      tick: cycle.tick,
      agents: agentIds.map((agentId) => {
        const own = records.filter((r) => r.agentId === agentId);
        const seen = new Set(
          experiences
            .filter((e) => e.agentId === agentId)
            .flatMap((e) => {
              const data = sources.get(e.id)!;
              return data.kind === "entity" ? [data.entity.id] : [];
            }),
        );
        const earlier = previous.get(agentId) ?? new Set<string>();
        const revisits = [...seen].filter((id) => earlier.has(id)).length;
        previous.set(agentId, new Set([...earlier, ...seen]));
        const checks = new Map<string, boolean>();
        for (const d of own.sort((a, b) => a.tick - b.tick)) {
          for (const m of d.observation.memory?.relevant ?? []) {
            if (m.cycleId === cycle.id || !m.claimKey.startsWith("location:"))
              continue;
            const current = d.observation.visibleEntities.find(
              (e) => m.claimKey === `location:${e.id}`,
            );
            const source = m.sourceEventIds
              .map((id) => sources.get(id))
              .find((e) => e?.kind === "entity");
            if (current && source?.kind === "entity")
              checks.set(
                m.id,
                distance(current.position, source.entity.position) <= 0.1,
              );
          }
        }
        return {
          agentId,
          decisions: own.length,
          failures: own.filter(
            (d) => d.status === "failed" || d.outcome?.status === "failed",
          ).length,
          cancelled: own.filter(
            (d) =>
              d.status === "cancelled" || d.outcome?.status === "cancelled",
          ).length,
          toolCalls: own.reduce((n, d) => n + d.tools.length, 0),
          decisionTimeMs: Math.round(
            own.reduce((n, d) => n + (d.durationMs ?? 0), 0),
          ),
          discoveries: seen.size,
          revisits,
          observationCells: new Set(
            own.map(
              (d) =>
                `${Math.floor(d.observation.position.x / 25)},${Math.floor(d.observation.position.z / 25)}`,
            ),
          ).size,
          messagesSent: events.filter(
            (e) => e.type === "agent:message" && e.actorId === agentId,
          ).length,
          sharedObjects: [...objectActors.values()].filter(
            (actors) => actors.size > 1 && actors.has(agentId),
          ).length,
          movesToMemoryTargets: own.filter((d) => {
            const a = d.action;
            return (
              a?.type === "move" &&
              d.outcome?.status === "succeeded" &&
              d.observation.memory?.relevant.some(
                (m) =>
                  m.cycleId !== cycle.id &&
                  m.target &&
                  distance(m.target, a.target) <= 0.1,
              )
            );
          }).length,
          verifiedLocations: [...checks.values()].filter(Boolean).length,
          contradictedLocations: [...checks.values()].filter((v) => !v).length,
        };
      }),
    };
  });
}
export function timeline(
  db: Database.Database,
  cycleId: string,
  after: number,
): WorldEvent[] {
  return (
    db
      .prepare(
        "SELECT payload FROM world_events WHERE cycleId=? AND sequence>? ORDER BY sequence LIMIT 200",
      )
      .all(cycleId, after) as { payload: string }[]
  ).map((r) => JSON.parse(r.payload));
}

function timelineAll(db: Database.Database, cycleId: string): WorldEvent[] {
  return (
    db
      .prepare(
        "SELECT payload FROM world_events WHERE cycleId=? ORDER BY sequence",
      )
      .all(cycleId) as { payload: string }[]
  ).map((r) => JSON.parse(r.payload));
}
