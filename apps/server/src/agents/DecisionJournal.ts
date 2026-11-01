import type {
  AgentObservation,
  DecisionRecord,
} from "../../../../packages/shared/src/index.js";
export class DecisionJournal {
  private next = 1;
  private readonly records: DecisionRecord[] = [];
  begin(observation: AgentObservation): DecisionRecord {
    const record: DecisionRecord = {
      id: `decision-${this.next++}`,
      agentId: observation.agentId,
      tick: observation.tick,
      observation: structuredClone(observation),
      status: "thinking",
      tools: [],
    };
    this.records.push(record);
    while (this.records.length > 256) {
      const index = this.records.findIndex(
        (r) => r.status !== "thinking" && r.status !== "proposed",
      );
      if (index < 0) break;
      this.records.splice(index, 1);
    }
    return record;
  }
  list(agentId?: string): DecisionRecord[] {
    return structuredClone(
      this.records.filter((r) => !agentId || r.agentId === agentId),
    );
  }
}
