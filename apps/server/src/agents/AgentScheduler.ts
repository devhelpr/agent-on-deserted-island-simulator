import type {
  AgentObservation,
  SchedulerMode,
  WorldActionInput,
} from "../../../../packages/shared/src/index.js";
import { WorldEngine } from "../world/WorldEngine.js";
export type DecisionPolicy = (
  observation: AgentObservation,
) => WorldActionInput | Promise<WorldActionInput>;
interface Decision {
  ready: boolean;
  action?: WorldActionInput;
  timer?: ReturnType<typeof setTimeout>;
}
/** One in-flight decision per agent. Experiment batches flush only when all decisions are ready. */
export class AgentScheduler {
  private readonly decisions = new Map<string, Decision>();
  private epoch = 0;
  constructor(
    private readonly engine: WorldEngine,
    private readonly policy: DecisionPolicy,
    private readonly timeoutMs = 10000,
  ) {}
  pendingAgents(): string[] {
    return [...this.decisions]
      .filter(([, d]) => !d.ready)
      .map(([id]) => id)
      .sort();
  }
  prepare(mode: SchedulerMode): boolean {
    const idle = this.engine.getIdleAgents();
    const idleIds = new Set(idle.map((a) => a.id));
    for (const [id, d] of this.decisions)
      if (!idleIds.has(id)) {
        clearTimeout(d.timer);
        this.decisions.delete(id);
      }
    for (const agent of idle)
      if (!this.decisions.has(agent.id)) {
        const decision: Decision = { ready: false };
        const epoch = this.epoch;
        this.decisions.set(agent.id, decision);
        const resolve = (action: WorldActionInput) => {
          if (
            epoch !== this.epoch ||
            this.decisions.get(agent.id) !== decision ||
            decision.ready
          )
            return;
          clearTimeout(decision.timer);
          decision.action = action;
          decision.ready = true;
        };
        const fallback = () => resolve({ type: "wait", durationMs: 1000 });
        try {
          const result = this.policy(this.engine.observe(agent.id)!);
          if (result instanceof Promise) {
            decision.timer = setTimeout(fallback, this.timeoutMs);
            decision.timer.unref?.();
            void result.then(resolve, fallback);
          } else resolve(result);
        } catch {
          fallback();
        }
      }
    if (mode === "experiment" && this.pendingAgents().length) return false;
    for (const [id, d] of [...this.decisions].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    ))
      if (d.ready) {
        this.engine.submitAction(id, d.action);
        this.decisions.delete(id);
      }
    return true;
  }
  cancel() {
    this.epoch++;
    for (const d of this.decisions.values()) clearTimeout(d.timer);
    this.decisions.clear();
  }
}
