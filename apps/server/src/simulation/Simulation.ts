import type {
  SchedulerMode,
  WorldSnapshot,
} from "../../../../packages/shared/src/index.js";
import {
  AgentScheduler,
  type DecisionPolicy,
} from "../agents/AgentScheduler.js";
import { createScriptedPolicy } from "../agents/ScriptedPolicy.js";
import { generateWorld } from "../world/generateWorld.js";
import { WorldEngine } from "../world/WorldEngine.js";
import { SimulationClock } from "./SimulationClock.js";
export class Simulation {
  readonly engine: WorldEngine;
  readonly clock: SimulationClock;
  readonly scheduler: AgentScheduler | null;
  constructor(
    readonly id: string,
    now: number,
    timeScale = 1,
    mode: SchedulerMode = "live",
    policy: DecisionPolicy | null = createScriptedPolicy(),
  ) {
    this.engine = new WorldEngine(generateWorld());
    this.clock = new SimulationClock(now, timeScale, mode);
    this.scheduler = policy ? new AgentScheduler(this.engine, policy) : null;
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
    return this.clock.getStatus(
      this.id,
      this.engine.getTick(),
      this.scheduler?.pendingAgents() ?? [],
    );
  }
  snapshot(): WorldSnapshot {
    return {
      simulation: this.status(),
      definition: this.engine.getDefinition(),
      state: this.engine.getState(),
    };
  }
  stop() {
    this.clock.stop();
    this.scheduler?.cancel();
    this.engine.cancelAll();
  }
}
