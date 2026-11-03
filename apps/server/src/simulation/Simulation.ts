import { eq } from "drizzle-orm";
import {
  CYCLE_TICKS,
  type SchedulerMode,
  type ExperimentConfig,
  type WorldDefinition,
  type WorldSnapshot,
  type DecisionRecord,
} from "../../../../packages/shared/src/index.js";
import {
  AgentScheduler,
  type DecisionPolicy,
  type PolicyOutput,
  type PolicyProposal,
} from "../agents/AgentScheduler.js";
import { createScriptedPolicy } from "../agents/ScriptedPolicy.js";
import { CodexAdapter } from "../agents/CodexAdapter.js";
import { DecisionJournal } from "../agents/DecisionJournal.js";
import { generateWorld } from "../world/generateWorld.js";
import { WorldEngine } from "../world/WorldEngine.js";
import { MemoryManager } from "../memory/MemoryManager.js";
import {
  SimulationStore,
  type Checkpoint,
} from "../storage/SimulationStore.js";
import { cycles } from "../storage/schema.js";
import { SimulationClock } from "./SimulationClock.js";
export interface AgentRuntimeOptions {
  controller?: "scripted" | "codex";
  experiment?: ExperimentConfig;
  codexAgentIds?: string[];
  adapter?: CodexAdapter;
  store?: SimulationStore;
  definition?: WorldDefinition;
  restore?: {
    checkpoint: Checkpoint;
    cycleIndex: number;
    cycleStatus: string;
    status: string;
  };
}
export class Simulation {
  engine: WorldEngine;
  readonly clock: SimulationClock;
  scheduler: AgentScheduler | null = null;
  readonly codex: CodexAdapter | null;
  readonly memory: MemoryManager | null;
  readonly journal = new DecisionJournal();
  cycleIndex: number;
  cycleId: string;
  cycleStatus: "active" | "closing" | "completed" = "active";
  private readonly decisionsUsed: Record<string, number> = {};
  cycleError?: string;
  private resetting: Promise<void> | null = null;
  private stopped: Promise<void> | null = null;
  constructor(
    readonly id: string,
    now: number,
    timeScale = 1,
    mode: SchedulerMode = "live",
    private readonly policy: DecisionPolicy | null | undefined = undefined,
    private readonly options: AgentRuntimeOptions = {},
  ) {
    this.engine = this.newEngine();
    this.clock = new SimulationClock(now, timeScale, mode);
    this.codex =
      options.controller === "codex"
        ? (options.adapter ?? new CodexAdapter())
        : null;
    this.memory = options.store ? new MemoryManager(options.store, id) : null;
    this.cycleIndex = options.restore?.cycleIndex ?? 1;
    this.cycleId = `${id}:cycle-${this.cycleIndex}`;
    if (options.restore) {
      this.engine.restore(options.restore.checkpoint);
      this.cycleStatus =
        options.restore.cycleStatus === "completed"
          ? "completed"
          : options.restore.cycleStatus === "closing"
            ? "closing"
            : "active";
      // Recovery requires operator resume and starts fresh model threads.
      if (
        options.restore.status === "stopped" ||
        this.cycleStatus === "completed"
      )
        this.clock.stop();
      else this.clock.pause();
      for (const record of options
        .store!.listDecisions(id, "alpha")
        .concat(
          options.store!.listDecisions(id, "beta"),
          options.store!.listDecisions(id, "gamma"),
        )) {
        if (
          record.cycleId === this.cycleId &&
          ["thinking", "proposed"].includes(record.status)
        ) {
          record.status = "cancelled";
          record.error = "SERVER_RECOVERED";
          options.store!.saveDecision(this.cycleId, record);
        }
      }
    } else if (options.store) {
      options.store.transaction(() => {
        options.store!.createRun(
          id,
          this.engine,
          {
            controller: options.controller ?? "scripted",
            codexAgentIds: options.codexAgentIds ?? ["alpha"],
            experiment: options.experiment,
          },
          this.status(),
        );
        options.store!.createCycle(id, this.cycleIndex, this.engine);
      });
    }
    if (options.store)
      for (const agent of this.engine.getAgents())
        this.decisionsUsed[agent.id] = options.store
          .listDecisions(id, agent.id)
          .filter((r) => r.cycleId === this.cycleId).length;
    this.attachEngine();
    this.configureScheduler();
    this.journal.setListener((record) => this.saveDecision(record));
    this.codex?.journal.setListener((record) => this.saveDecision(record));
    this.persist();
  }
  private newEngine() {
    const engine = new WorldEngine(this.options.definition ?? generateWorld());
    if (this.options.controller === "codex")
      for (const id of this.options.codexAgentIds ?? ["alpha"])
        engine.setController(id, "codex");
    return engine;
  }
  private attachEngine() {
    if (this.options.store) this.engine.setCommit(() => this.persist());
    this.engine.setAccepting(
      this.cycleStatus === "active" &&
        this.clock.getStatus(this.id, 0, []).status !== "stopped",
    );
  }
  private saveDecision(record: DecisionRecord) {
    this.options.store?.saveDecision(this.cycleId, record);
  }
  private configureScheduler() {
    const scripted =
      this.policy === undefined ? createScriptedPolicy() : this.policy;
    const codexIds = new Set(this.options.codexAgentIds ?? ["alpha"]);
    const policy: DecisionPolicy = (observation, signal) => {
      const cycleId = this.cycleId;
      this.decisionsUsed[observation.agentId] =
        (this.decisionsUsed[observation.agentId] ?? 0) + 1;
      const started = performance.now();
      const save = (record: DecisionRecord) =>
        this.options.store?.saveDecision(cycleId, record);
      if (this.memory)
        observation.memory = this.memory.context(
          observation.agentId,
          this.cycleId,
          observation,
        );
      let removeAbort = () => {};
      const wrap = (
        output: PolicyOutput,
        record?: DecisionRecord,
      ): PolicyProposal => {
        const proposal = "action" in output ? output : { action: output };
        if (record) {
          record.durationMs = performance.now() - started;
          record.action = proposal.action;
          record.motivation = proposal.motivation ?? record.motivation;
          record.artifactConsiderations =
            proposal.artifactConsiderations ?? record.artifactConsiderations;
          record.status = signal?.aborted ? "cancelled" : "proposed";
          save(record);
        }
        return {
          action: proposal.action,
          motivation: proposal.motivation ?? record?.motivation,
          artifactConsiderations:
            proposal.artifactConsiderations ?? record?.artifactConsiderations,
          onSubmitted: (result) => {
            proposal.onSubmitted?.(result);
            if (record) {
              removeAbort();
              record.status = result.accepted ? "submitted" : "failed";
              if (result.accepted) record.actionId = result.actionId;
              else record.error = result.error;
              save(record);
            }
          },
          onCancelled: () => {
            proposal.onCancelled?.();
            if (record) {
              removeAbort();
              record.status = "cancelled";
              save(record);
            }
          },
        };
      };
      if (this.codex && codexIds.has(observation.agentId))
        return this.codex
          .decide(observation, signal)
          .then((d) => wrap(d, d.record));
      // Keep scripted decisions synchronous for deterministic accelerated runs.
      const record = this.options.store
        ? this.journal.begin(observation)
        : undefined;
      const onAbort = () => {
        if (record) {
          record.status = "cancelled";
          record.error = "DECISION_CANCELLED";
          save(record);
        }
      };
      if (record) signal?.addEventListener("abort", onAbort, { once: true });
      removeAbort = () => signal?.removeEventListener("abort", onAbort);
      try {
        const result = scripted
          ? scripted(observation, signal)
          : { type: "wait" as const, durationMs: 1000 };
        return result instanceof Promise
          ? result.then(
              (r) => wrap(r, record),
              (error) => {
                if (record) {
                  record.status = signal?.aborted ? "cancelled" : "failed";
                  removeAbort();
                  record.durationMs = performance.now() - started;
                  record.error = String(error);
                  save(record);
                }
                throw error;
              },
            )
          : wrap(result, record);
      } catch (error) {
        removeAbort();
        if (record) {
          record.status = signal?.aborted ? "cancelled" : "failed";
          record.durationMs = performance.now() - started;
          record.error = String(error);
          save(record);
        }
        throw error;
      }
    };
    this.scheduler =
      this.codex || scripted
        ? new AgentScheduler(
            this.engine,
            policy,
            this.codex ? 90000 : 10000,
            (id) =>
              (!this.codex || !codexIds.has(id) || this.codex.canDecide()) &&
              (!this.options.experiment ||
                (this.decisionsUsed[id] ?? 0) <
                  this.options.experiment.decisionBudgetPerAgentPerCycle),
          )
        : null;
  }
  persist() {
    this.options.store?.capture(
      this.id,
      this.cycleId,
      this.engine,
      this.status(),
    );
  }
  advance(now: number) {
    this.clock.pump(now, () => {
      if (this.cycleStatus !== "active") return false;
      if (this.engine.getTick() >= CYCLE_TICKS) return false;
      if (this.scheduler && !this.scheduler.prepare(this.clock.schedulerMode))
        return false;
      this.engine.step();
      return true;
    });
    if (
      this.engine.getTick() >= CYCLE_TICKS &&
      !this.resetting &&
      !this.cycleError &&
      !this.stopped &&
      this.cycleStatus !== "completed"
    )
      void this.reset().catch(() => {});
  }
  status() {
    const state = this.clock.getStatus(
      this.id,
      this.engine.getTick(),
      this.scheduler?.pendingAgents() ?? [],
    );
    state.cycleId = this.cycleId;
    state.cycleIndex = this.cycleIndex;
    state.cycleStatus = this.cycleStatus;
    state.cycleError = this.cycleError;
    if (this.options.experiment)
      state.experiment = {
        ...this.options.experiment,
        decisionsUsed: { ...this.decisionsUsed },
        exhaustedAgents: this.engine
          .getAgents()
          .filter(
            (a) =>
              (this.decisionsUsed[a.id] ?? 0) >=
              this.options.experiment!.decisionBudgetPerAgentPerCycle,
          )
          .map((a) => a.id),
        completed: this.cycleStatus === "completed",
      };
    const sessions = this.codex?.statuses() ?? [];
    state.agentSessions = this.engine.getAgents().map(
      (a) =>
        sessions.find((s) => s.agentId === a.id) ?? {
          agentId: a.id,
          controller: a.controller,
          status: "idle",
          threadId: null,
          turnId: null,
          decisions: 0,
        },
    );
    return state;
  }
  snapshot(): WorldSnapshot {
    return {
      simulation: this.status(),
      definition: this.engine.getDefinition(),
      state: this.engine.getState(),
    };
  }
  reset(): Promise<void> {
    if (this.resetting) return this.resetting;
    if (this.stopped || this.status().status === "stopped")
      return Promise.reject(new Error("SIMULATION_STOPPED"));
    this.cycleStatus = "closing";
    this.cycleError = undefined;
    this.engine.setAccepting(false);
    const closing = this.cycleId;
    this.resetting = (async () => {
      this.scheduler?.cancel();
      this.engine.cancelAll();
      this.persist();
      await this.codex?.resetCycle();
      const finished =
        !!this.options.experiment &&
        this.cycleIndex >= this.options.experiment.maxCycles;
      const next = this.newEngine();
      const complete = () => {
        this.options.store?.snapshot(closing, "final", this.engine);
        for (const agent of this.engine.getAgents())
          this.memory?.consolidate(closing, agent.id);
        this.options.store?.db
          .update(cycles)
          .set({
            status: "completed",
            outcome:
              this.engine.getTick() >= CYCLE_TICKS
                ? "duration"
                : "manual_reset",
          })
          .where(eq(cycles.id, closing))
          .run();
        if (!finished)
          this.options.store?.createCycle(this.id, this.cycleIndex + 1, next);
      };
      if (this.options.store) this.options.store.transaction(complete);
      else complete();
      if (finished) {
        this.cycleStatus = "completed";
        this.clock.stop();
        await this.codex?.close();
        this.persist();
        return;
      }
      for (const id of Object.keys(this.decisionsUsed))
        this.decisionsUsed[id] = 0;
      this.journal.clear();
      this.engine = next;
      this.cycleIndex++;
      this.cycleId = `${this.id}:cycle-${this.cycleIndex}`;
      this.cycleStatus = "active";
      this.attachEngine();
      this.configureScheduler();
      this.persist();
    })()
      .catch((error) => {
        this.cycleError =
          error instanceof Error ? error.message : "RESET_FAILED";
        this.clock.pause();
        throw error;
      })
      .finally(() => {
        this.resetting = null;
      });
    return this.resetting;
  }
  async shutdown() {
    await this.resetting?.catch(() => {});
    this.scheduler?.cancel();
    await this.codex?.close();
    this.persist();
  }
  stop(): Promise<void> {
    if (this.stopped) return this.stopped;
    this.clock.stop();
    this.scheduler?.cancel();
    this.engine.setAccepting(false);
    this.engine.cancelAll();
    return (this.stopped = (async () => {
      await this.resetting?.catch(() => {});
      this.clock.stop();
      this.engine.setAccepting(false);
      this.engine.cancelAll();
      await this.codex?.close();
      this.persist();
    })());
  }
}
