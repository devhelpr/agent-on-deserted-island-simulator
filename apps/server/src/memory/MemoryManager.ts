import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type {
  AgentMemory,
  AgentObservation,
  MemoryContext,
} from "../../../../packages/shared/src/index.js";
import {
  SimulationStore,
  type Experience,
} from "../storage/SimulationStore.js";
import {
  consolidations,
  experiences,
  memories,
  revisions,
  cycles,
} from "../storage/schema.js";
export class MemoryManager {
  constructor(
    private readonly store: SimulationStore,
    readonly runId: string,
  ) {}
  list(agentId: string, query = "", limit = 100): AgentMemory[] {
    const terms = query.match(/[\p{L}\p{N}_-]+/gu)?.slice(0, 12) ?? [];
    if (terms.length) {
      const match = terms
        .map((t) => `"${t.replaceAll('"', '""')}"`)
        .join(" OR ");
      return (
        this.store.sqlite
          .prepare(
            `SELECT m.payload FROM memory_search f JOIN agent_memories m ON m.rowid=f.rowid
        WHERE memory_search MATCH ? AND m.runId=? AND m.agentId=? AND m.supersededBy IS NULL
        ORDER BY bm25(memory_search), m.importance DESC LIMIT ?`,
          )
          .all(match, this.runId, agentId, limit) as { payload: string }[]
      ).map((r) => JSON.parse(r.payload));
    }
    return this.store.db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.runId, this.runId),
          eq(memories.agentId, agentId),
          isNull(memories.supersededBy),
        ),
      )
      .orderBy(
        desc(memories.importance),
        desc(memories.confidence),
        asc(memories.id),
      )
      .limit(limit)
      .all()
      .map((r) => r.payload);
  }
  remember(
    agentId: string,
    cycleId: string,
    input: Omit<AgentMemory, "id" | "agentId" | "cycleId" | "revision">,
  ) {
    return this.store.transaction(() => {
      const cycle = this.store.db
        .select()
        .from(cycles)
        .where(eq(cycles.id, cycleId))
        .get();
      if (!cycle || cycle.runId !== this.runId)
        throw new Error("MEMORY_SOURCE_SCOPE_DENIED");
      for (const source of input.sourceEventIds) {
        const event = this.store.db
          .select()
          .from(experiences)
          .where(eq(experiences.id, source))
          .get();
        if (!event || event.agentId !== agentId || event.cycleId !== cycleId)
          throw new Error("MEMORY_SOURCE_SCOPE_DENIED");
      }
      if (
        !input.sourceEventIds.length ||
        input.confidence < 0 ||
        input.confidence > 1 ||
        input.importance < 0 ||
        input.importance > 1
      )
        throw new Error("INVALID_MEMORY");
      const claims = this.store.db
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.runId, this.runId),
            eq(memories.agentId, agentId),
            eq(memories.claimKey, input.claimKey),
            isNull(memories.supersededBy),
          ),
        )
        .all();
      const duplicate = claims.find(
        (m) => m.content === input.content && m.provenance === input.provenance,
      );
      const memory: AgentMemory = duplicate
        ? {
            ...duplicate.payload,
            sourceEventIds: [
              ...new Set([
                ...duplicate.payload.sourceEventIds,
                ...input.sourceEventIds,
              ]),
            ],
            revision: duplicate.payload.revision + 1,
          }
        : {
            ...input,
            id: randomUUID(),
            agentId,
            cycleId,
            revision: 1,
            conflictsWith: claims.map((m) => m.id),
          };
      if (
        duplicate &&
        memory.sourceEventIds.length === duplicate.payload.sourceEventIds.length
      )
        return duplicate.payload;
      const row = {
        id: memory.id,
        runId: this.runId,
        agentId,
        cycleId: memory.cycleId,
        type: memory.type,
        provenance: memory.provenance,
        claimKey: memory.claimKey,
        content: memory.content,
        confidence: memory.confidence,
        importance: memory.importance,
        payload: memory,
      };
      this.store.db
        .insert(memories)
        .values(row)
        .onConflictDoUpdate({ target: memories.id, set: { payload: memory } })
        .run();
      this.store.db
        .insert(revisions)
        .values({
          memoryId: memory.id,
          revision: memory.revision,
          payload: memory,
        })
        .run();
      for (const old of claims.filter((m) => m.id !== duplicate?.id)) {
        const supersede =
          memory.provenance === "observed" && old.provenance === "observed";
        const updated = {
          ...old.payload,
          revision: old.payload.revision + 1,
          conflictsWith: [
            ...new Set([...(old.payload.conflictsWith ?? []), memory.id]),
          ],
          ...(supersede ? { supersededBy: memory.id } : {}),
        };
        this.store.db
          .update(memories)
          .set({ payload: updated, supersededBy: updated.supersededBy ?? null })
          .where(eq(memories.id, old.id))
          .run();
        this.store.db
          .insert(revisions)
          .values({
            memoryId: old.id,
            revision: updated.revision,
            payload: updated,
          })
          .run();
      }
      return memory;
    });
  }
  consolidate(cycleId: string, agentId: string) {
    this.store.transaction(() => {
      if (
        this.store.db
          .select()
          .from(consolidations)
          .where(
            and(
              eq(consolidations.cycleId, cycleId),
              eq(consolidations.agentId, agentId),
            ),
          )
          .get()
      )
        return;
      const own = this.store.db
        .select()
        .from(experiences)
        .where(
          and(
            eq(experiences.cycleId, cycleId),
            eq(experiences.agentId, agentId),
          ),
        )
        .all()
        .sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
      for (const experience of own) {
        const e: Experience = JSON.parse(experience.payload);
        const base = {
          createdAtTick: experience.tick,
          sourceEventIds: [experience.id],
        };
        if (e.kind === "entity")
          this.remember(agentId, cycleId, {
            ...base,
            type: "semantic",
            provenance: "observed",
            claimKey: `location:${e.entity.id}`,
            content: `${e.entity.type} ${e.entity.id} at (${e.entity.position.x.toFixed(2)}, ${e.entity.position.z.toFixed(2)}).`,
            confidence: 1,
            importance: e.entity.type === "cave" ? 1 : 0.4,
            target: e.position,
          });
        if (e.kind === "message")
          this.remember(agentId, cycleId, {
            ...base,
            type: "episodic",
            provenance: "reported",
            claimKey: `report:${e.message.from}:${e.message.text}`,
            content: `${e.message.from} reported: ${e.message.text}`,
            confidence: 0.5,
            importance: 0.6,
          });
        if (e.kind === "event" && e.event.actorId === agentId) {
          this.remember(agentId, cycleId, {
            ...base,
            type: "episodic",
            provenance: "observed",
            claimKey: `event:${experience.id}`,
            content: e.event.message,
            confidence: 1,
            importance: 0.3,
          });
          if (
            e.action?.input.type === "move" &&
            e.action.status === "succeeded"
          )
            this.remember(agentId, cycleId, {
              ...base,
              type: "procedural",
              provenance: "inferred",
              claimKey: `route:${e.event.position.x.toFixed(1)}:${e.event.position.z.toFixed(1)}`,
              content: `Previously reached (${e.event.position.x.toFixed(1)}, ${e.event.position.z.toFixed(1)}); this approach may work again.`,
              target: e.event.position,
              confidence: 0.8,
              importance: 0.5,
            });
        }
      }
      this.store.db.insert(consolidations).values({ cycleId, agentId }).run();
    });
  }
  context(
    agentId: string,
    cycleId: string,
    observation: AgentObservation,
  ): MemoryContext {
    const top = this.list(agentId, "", 6);
    const relevant = this.list(
      agentId,
      observation.visibleEntities.map((e) => e.id).join(" "),
      6,
    );
    const recent = this.store.db
      .select()
      .from(experiences)
      .where(
        and(eq(experiences.cycleId, cycleId), eq(experiences.agentId, agentId)),
      )
      .orderBy(desc(experiences.tick))
      .limit(4)
      .all()
      .map((e) => {
        const payload: Experience = JSON.parse(e.payload);
        return payload.kind === "entity"
          ? `Saw ${payload.entity.type} ${payload.entity.id}`
          : payload.kind === "event"
            ? payload.event.message
            : `${payload.message.from} reported: ${payload.message.text}`;
      });
    return {
      summary: top
        .map((m) => `[${m.provenance}] ${m.content}`)
        .join("\n")
        .slice(0, 2000),
      relevant: [
        ...new Map([...top, ...relevant].map((m) => [m.id, m])).values(),
      ]
        .slice(0, 10)
        .map((m) => ({
          ...m,
          content: m.content.slice(0, 1000),
          sourceEventIds: m.sourceEventIds.slice(-8),
          conflictsWith: m.conflictsWith?.slice(-8),
        })),
      recent,
      goals: top.some((m) => m.content.startsWith("cave "))
        ? ["Revisit the remembered cave and verify its location."]
        : ["Explore unfamiliar ground and find landmarks."],
    };
  }
}
