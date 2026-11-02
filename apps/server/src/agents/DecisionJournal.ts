import { randomUUID } from "node:crypto";
import type {
  AgentObservation,
  DecisionRecord,
} from "../../../../packages/shared/src/index.js";
export class DecisionJournal {
  private listener?: (record: DecisionRecord) => void;
  setListener(listener: (record: DecisionRecord) => void) {
    this.listener = listener;
  }
  changed(record: DecisionRecord) {
    this.listener?.(record);
  }
  private readonly records: DecisionRecord[] = [];
  begin(observation: AgentObservation): DecisionRecord {
    const record: DecisionRecord = {
      id: `decision-${randomUUID()}`,
      agentId: observation.agentId,
      tick: observation.tick,
      observation: structuredClone(observation),
      status: "thinking",
      tools: [],
    };
    this.records.push(record);
    this.changed(record);
    while (this.records.length > 256) {
      const index = this.records.findIndex(
        (r) => r.status !== "thinking" && r.status !== "proposed",
      );
      if (index < 0) break;
      this.records.splice(index, 1);
    }
    return record;
  }
  clear() {
    this.records.length = 0;
  }
  list(agentId?: string): DecisionRecord[] {
    return structuredClone(
      this.records.filter((r) => !agentId || r.agentId === agentId),
    );
  }
}
