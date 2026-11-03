import {
  actionSchema,
  distance,
  type Vector3,
  type ActionExplanation,
  type AgentObservation,
  type SchedulerMode,
  type WorldActionInput,
} from "../../../../packages/shared/src/index.js";
import { WorldEngine, type ActionSubmission } from "../world/WorldEngine.js";
export interface PolicyProposal extends ActionExplanation {
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
  private readonly lastDecisionActions = new Map<string, string | null>();
  private readonly lastDecisionPoses = new Map<
    string,
    { position: Vector3; orientation: number }
  >();
  private readonly nearby = new Map<string, Set<string>>();
  private readonly encounters = new Set<string>();
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
    for (const agent of this.engine.getAgents()) {
      if (!this.canDecide(agent.id)) continue;
      const current = new Set(this.engine.getEncounterIds(agent.id));
      const previous = this.nearby.get(agent.id);
      if (previous && [...current].some((id) => !previous.has(id)))
        this.encounters.add(agent.id);
      this.nearby.set(agent.id, current);
      if (!agent.activeActionId || !this.encounters.has(agent.id)) continue;
      const action = this.engine.getAction(agent.activeActionId);
      // Walking may stop for an encounter; an airborne agent must land first.
      if (
        action?.status === "running" &&
        action.input.type === "move" &&
        this.canDecide(agent.id)
      )
        this.engine.cancelAction(agent.id, action.id, "ENCOUNTER");
    }
    const idle = this.engine.getIdleAgents();
    const idleIds = new Set(idle.map((a) => a.id));
    for (const [id, d] of this.decisions)
      if (!idleIds.has(id)) {
        this.discard(d);
        this.decisions.delete(id);
      }
    for (const agent of idle)
      if (!this.decisions.has(agent.id) && this.canDecide(agent.id)) {
        const observation = this.engine.observe(agent.id)!;
        const action = observation.lastAction;
        const actionId = action?.id ?? null;
        const pose = this.lastDecisionPoses.get(agent.id);
        const unchangedPose =
          pose &&
          Math.hypot(
            distance(pose.position, observation.position),
            pose.position.y - observation.position.y,
          ) < 1e-6 &&
          Math.abs(pose.orientation - observation.orientation) < 1e-6;
        const noNewStop =
          action?.status === "succeeded" &&
          ["move", "look"].includes(action.input.type) &&
          unchangedPose;
        if (noNewStop && !this.encounters.has(agent.id)) {
          this.lastDecisionActions.set(agent.id, actionId);
          continue;
        }
        if (
          this.lastDecisionActions.has(agent.id) &&
          this.lastDecisionActions.get(agent.id) === actionId &&
          !this.encounters.has(agent.id)
        )
          continue;
        this.lastDecisionActions.set(agent.id, actionId);
        this.lastDecisionPoses.set(agent.id, {
          position: { ...observation.position },
          orientation: observation.orientation,
        });
        this.encounters.delete(agent.id);
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
            d.proposal = {
              action: { type: "wait", durationMs: 1000 },
              motivation:
                "De voorgestelde actie was ongeldig; ik wacht kort voordat ik opnieuw kies.",
            };
          } else d.proposal = proposal;
          d.ready = true;
        };
        const fallback = () => {
          if (!d.ready)
            resolve({
              action: { type: "wait", durationMs: 1000 },
              motivation:
                "De beslissing mislukte of duurde te lang; ik wacht kort voordat ik opnieuw kies.",
            });
        };
        try {
          const result = this.policy(observation, d.controller.signal);
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
        const result = this.engine.submitAction(id, d.proposal!.action, {
          motivation: d.proposal!.motivation,
          artifactConsiderations: d.proposal!.artifactConsiderations,
        });
        d.proposal?.onSubmitted?.(result);
        this.decisions.delete(id);
      }
    return true;
  }
  cancel() {
    this.epoch++;
    for (const d of this.decisions.values()) this.discard(d);
    this.decisions.clear();
    this.lastDecisionActions.clear();
    this.lastDecisionPoses.clear();
    this.nearby.clear();
    this.encounters.clear();
  }
}
