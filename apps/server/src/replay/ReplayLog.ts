import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { Checkpoint } from "../storage/SimulationStore.js";

/** Sorted object keys, preserved array order and exact IEEE-754 JSON numbers.
 * No position rounding: reconstruction never integrates floating point movement. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export const stateHash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const versions = {
  format: 1,
  navigation: 1,
  physics: "kinematic-1",
  positions: "exact-json-number",
};
export class ReplayLog {
  constructor(private readonly db: Database.Database) {}
  // Pure serialization cache: never a patch base or evidence of a durable commit.
  // Static entities and histories otherwise get recursively sorted twice on every tick.
  private readonly fields = new Map<
    string,
    { json: string; canonical: string }[]
  >();
  private canonicalField(key: string, value: unknown) {
    const json = JSON.stringify(value) ?? "null";
    const entries = this.fields.get(key) ?? [];
    const hit = entries.find((entry) => entry.json === json);
    if (hit) return hit.canonical;
    const result = canonical(value);
    this.fields.set(key, [{ json, canonical: result }, ...entries].slice(0, 2));
    return result;
  }
  append(cycleId: string, checkpoint: Checkpoint, generator: number) {
    const last = this.db
      .prepare(
        "SELECT sequence, hash FROM replay_frames WHERE cycle_id=? ORDER BY sequence DESC LIMIT 1",
      )
      .get(cycleId) as { sequence: number; hash: string } | undefined;
    const serialized = `{${Object.entries(checkpoint)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(
        ([key, value]) =>
          `${JSON.stringify(key)}:${this.canonicalField(key, value)}`,
      )
      .join(",")}}`;
    const hash = createHash("sha256").update(serialized).digest("hex");
    if (last?.hash === hash) return;
    const sequence = (last?.sequence ?? 0) + 1;
    // The prior durable checkpoint is the patch base, so rolled-back writes leave no cache behind.
    const previous = this.db
      .prepare("SELECT checkpoint FROM simulation_cycles WHERE id=?")
      .get(cycleId) as { checkpoint: string };
    const base = JSON.parse(previous.checkpoint) as Checkpoint;
    const full = !last || checkpoint.tick % 1200 === 0;
    const payload = full
      ? checkpoint
      : Object.fromEntries(
          Object.entries(checkpoint).filter(
            ([key, value]) =>
              this.canonicalField(key, value) !==
              this.canonicalField(key, base[key as keyof Checkpoint]),
          ),
        );
    this.db
      .prepare(
        "INSERT INTO replay_frames(cycle_id,sequence,tick,full,payload,hash,versions) VALUES(?,?,?,?,?,?,?)",
      )
      .run(
        cycleId,
        sequence,
        checkpoint.tick,
        Number(full),
        JSON.stringify(payload),
        hash,
        JSON.stringify({ ...versions, generator }),
      );
  }
  reconstruct(cycleId: string, tick: number) {
    const anchor = this.db
      .prepare(
        "SELECT sequence,payload FROM replay_frames WHERE cycle_id=? AND tick<=? AND full=1 ORDER BY sequence DESC LIMIT 1",
      )
      .get(cycleId, tick) as { sequence: number; payload: string } | undefined;
    if (!anchor) return null;
    let checkpoint = JSON.parse(anchor.payload) as Checkpoint;
    const rows = this.db
      .prepare(
        "SELECT sequence,payload,hash FROM replay_frames WHERE cycle_id=? AND sequence>=? AND tick<=? ORDER BY sequence",
      )
      .all(cycleId, anchor.sequence, tick) as {
      sequence: number;
      payload: string;
      hash: string;
    }[];
    for (const row of rows)
      checkpoint = Object.assign(checkpoint, JSON.parse(row.payload));
    const hash = stateHash(checkpoint);
    if (hash !== rows.at(-1)!.hash) throw new Error("REPLAY_HASH_MISMATCH");
    return { checkpoint, hash, sequence: rows.at(-1)!.sequence };
  }
}
