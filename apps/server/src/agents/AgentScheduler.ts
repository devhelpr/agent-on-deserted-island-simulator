import {
  actionSchema,
  type AgentObservation,
  type SchedulerMode,
  type WorldActionInput,
} from "../../../../packages/shared/src/index.js";
import { WorldEngine, type ActionSubmission } from "../world/WorldEngine.js";
export interface PolicyProposal {
  action: WorldActionInput;
  onSubmitted?: (result: ActionSubmission) => void;
  onCancelled?: () => void;
}
export type PolicyOutput = WorldActionInput | PolicyProposal;
export type DecisionPolicy = (
  observation: AgentObservation,
  signal?: AbortSignal,
) => PolicyOutput | Promise<PolicyOutput>;
interface Decision {
  ready: boolean;
  proposal?: PolicyProposal;
  timer?: ReturnType<typeof setTimeout>;
  controller: AbortController;
}
/** One in-flight decision per agent; cancellation reaches the adapter, not only the scheduler's bookkeeping. */
export class AgentScheduler {
  private readonly decisions = new Map<string, Decision>();
  private epoch = 0;
  constructor(
    private readonly engine: WorldEngine,
    private readonly policy: DecisionPolicy,
    private readonly timeoutMs = 10000,
    private readonly canDecide: (agentId: string) => boolean = () => true,
  ) {}
  pendingAgents(): string[] {
    return [...this.decisions]
      .filter(([, d]) => !d.ready)
      .map(([id]) => id)
      .sort();
  }
  private discard(d: Decision) {
    clearTimeout(d.timer);
    d.controller.abort(new Error("DECISION_CANCELLED"));
    d.proposal?.onCancelled?.();
  }
  prepare(mode: SchedulerMode): boolean {
    const idle = this.engine.getIdleAgents();
    const idleIds = new Set(idle.map((a) => a.id));
    for (const [id, d] of this.decisions)
      if (!idleIds.has(id)) {
        this.discard(d);
        this.decisions.delete(id);
      }
    for (const agent of idle)
      if (!this.decisions.has(agent.id) && this.canDecide(agent.id)) {
        const d: Decision = { ready: false, controller: new AbortController() };
        const epoch = this.epoch;
        this.decisions.set(agent.id, d);
        const resolve = (output: PolicyOutput) => {
          const proposal: PolicyProposal =
            output && typeof output === "object" && "action" in output
              ? output
              : { action: output as WorldActionInput };
          if (
            epoch !== this.epoch ||
            this.decisions.get(agent.id) !== d ||
            d.ready
          ) {
            proposal.onCancelled?.();
            return;
          }
          clearTimeout(d.timer);
          if (!actionSchema.safeParse(proposal.action).success) {
            proposal.onCancelled?.();
            d.proposal = { action: { type: "wait", durationMs: 1000 } };
          } else d.proposal = proposal;
          d.ready = true;
        };
        const fallback = () => {
          if (!d.ready) resolve({ type: "wait", durationMs: 1000 });
        };
        try {
          const result = this.policy(
            this.engine.observe(agent.id)!,
            d.controller.signal,
          );
          if (result instanceof Promise) {
            d.timer = setTimeout(() => {
              d.controller.abort(new Error("DECISION_TIMEOUT"));
              fallback();
            }, this.timeoutMs);
            d.timer.unref?.();
            void result.then(resolve, fallback).catch(fallback);
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
        const result = this.engine.submitAction(id, d.proposal!.action);
        d.proposal?.onSubmitted?.(result);
        this.decisions.delete(id);
      }
    return true;
  }
  cancel() {
    this.epoch++;
    for (const d of this.decisions.values()) this.discard(d);
    this.decisions.clear();
  }
}
