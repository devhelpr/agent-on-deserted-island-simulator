import type {
  SchedulerMode,
  WorldSnapshot,
} from "../../../../packages/shared/src/index.js";
import {
  AgentScheduler,
  type DecisionPolicy,
} from "../agents/AgentScheduler.js";
import { createScriptedPolicy } from "../agents/ScriptedPolicy.js";
import { CodexAdapter } from "../agents/CodexAdapter.js";
import { generateWorld } from "../world/generateWorld.js";
import { WorldEngine } from "../world/WorldEngine.js";
import { SimulationClock } from "./SimulationClock.js";
export interface AgentRuntimeOptions {
  controller?: "scripted" | "codex";
  codexAgentIds?: string[];
  adapter?: CodexAdapter;
}
export class Simulation {
  readonly engine: WorldEngine;
  readonly clock: SimulationClock;
  readonly scheduler: AgentScheduler | null;
  readonly codex: CodexAdapter | null;
  private stopped: Promise<void> | null = null;
  constructor(
    readonly id: string,
    now: number,
    timeScale = 1,
    mode: SchedulerMode = "live",
    policy: DecisionPolicy | null | undefined = undefined,
    options: AgentRuntimeOptions = {},
  ) {
    this.engine = new WorldEngine(generateWorld());
    this.clock = new SimulationClock(now, timeScale, mode);
    this.codex =
      options.controller === "codex"
        ? (options.adapter ?? new CodexAdapter())
        : null;
    const codexIds = new Set(options.codexAgentIds ?? ["alpha"]);
    if (this.codex)
      for (const agentId of codexIds)
        this.engine.setController(agentId, "codex");
    const scripted = policy === undefined ? createScriptedPolicy() : policy;
    const combined: DecisionPolicy = async (observation, signal) => {
      if (this.codex && codexIds.has(observation.agentId)) {
        const decision = await this.codex.decide(observation, signal);
        return {
          action: decision.action,
          onSubmitted: (result) => {
            if (result.accepted) {
              decision.record.status = "submitted";
              decision.record.actionId = result.actionId;
            } else {
              decision.record.status = "failed";
              decision.record.error = result.error;
            }
          },
          onCancelled: () => {
            decision.record.status = "cancelled";
          },
        };
      }
      return scripted
        ? scripted(observation, signal)
        : { type: "wait", durationMs: 1000 };
    };
    // Keep synchronous scripted policies synchronous, especially for deterministic accelerated tests.
    this.scheduler = this.codex
      ? new AgentScheduler(this.engine, combined, 90000)
      : scripted
        ? new AgentScheduler(this.engine, scripted)
        : null;
  }
  advance(now: number) {
    this.clock.pump(now, () => {
      if (this.scheduler && !this.scheduler.prepare(this.clock.schedulerMode))
        return false;
      this.engine.step();
      return true;
    });
  }
  status() {
    const state = this.clock.getStatus(
      this.id,
      this.engine.getTick(),
      this.scheduler?.pendingAgents() ?? [],
    );
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
  stop(): Promise<void> {
    if (this.stopped) return this.stopped;
    this.clock.stop();
    this.scheduler?.cancel();
    this.engine.cancelAll();
    return (this.stopped = this.codex?.close() ?? Promise.resolve());
  }
}
