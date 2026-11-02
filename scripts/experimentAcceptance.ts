import type {
  CycleMetrics,
  DecisionRecord,
} from "../packages/shared/src/index.js";

/** S6.7: full first cycle, automatic reset, fresh threads and memory use in cycle two. */
export function assessExperiment(
  metrics: CycleMetrics[],
  records: (DecisionRecord & { cycleId: string })[],
) {
  const first = metrics.find((c) => c.cycleIndex === 1);
  const second = metrics.find((c) => c.cycleIndex === 2);
  const ids = ["alpha", "beta", "gamma"];
  const threads = (cycleId: string, agentId: string) =>
    new Set(
      records
        .filter((r) => r.cycleId === cycleId && r.agentId === agentId)
        .map((r) => r.threadId)
        .filter((id): id is string => !!id),
    );
  return (
    !!first &&
    !!second &&
    first.tick === 72000 &&
    first.status === "completed" &&
    ids.every((id) => {
      const before = threads(first.cycleId, id);
      const after = threads(second.cycleId, id);
      return (
        before.size > 0 &&
        after.size > 0 &&
        [...after].every((thread) => !before.has(thread)) &&
        second.agents.some(
          (a) => a.agentId === id && a.movesToMemoryTargets > 0,
        ) &&
        [first, second].every((c) =>
          records.some(
            (r) =>
              r.cycleId === c.cycleId &&
              r.agentId === id &&
              r.outcome?.status === "succeeded",
          ),
        )
      );
    }) &&
    records.every((r) =>
      (r.observation.memory?.relevant ?? []).every(
        (m) => m.agentId === r.agentId,
      ),
    )
  );
}
