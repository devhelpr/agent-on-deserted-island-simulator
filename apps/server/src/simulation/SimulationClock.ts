import {
  speedSchema,
  schedulerSchema,
  TICK_MS,
  type SchedulerMode,
  type SimulationStatus,
} from "../../../../packages/shared/src/index.js";
/** Bounded catch-up: <=100 steps/pump, <=5 s virtual backlog; excess is reported, never hidden. */
export class SimulationClock {
  private previous: number;
  private accumulator = 0;
  private wallTimeMs = 0;
  private dropped = 0;
  private waiting = false;
  private status: SimulationStatus["status"] = "running";
  timeScale: number;
  schedulerMode: SchedulerMode;
  constructor(now = 0, timeScale = 1, schedulerMode: SchedulerMode = "live") {
    this.previous = now;
    this.timeScale = speedSchema.parse({ timeScale }).timeScale;
    this.schedulerMode = schedulerSchema.parse({ schedulerMode }).schedulerMode;
  }
  pump(now: number, step: () => boolean): number {
    if (!Number.isFinite(now) || now < this.previous) return 0;
    const elapsed = now - this.previous;
    this.previous = now;
    this.wallTimeMs += elapsed;
    if (this.status !== "running") return 0;
    this.accumulator += elapsed * this.timeScale;
    if (this.accumulator > 5000) {
      this.dropped += this.accumulator - 5000;
      this.accumulator = 5000;
    }
    let ticks = 0;
    this.waiting = false;
    while (this.accumulator >= TICK_MS && ticks < 100) {
      if (!step()) {
        this.waiting = true;
        this.accumulator = 0;
        break;
      }
      this.accumulator -= TICK_MS;
      ticks++;
    }
    return ticks;
  }
  pause() {
    if (this.status === "running") this.status = "paused";
  }
  resume() {
    if (this.status === "paused") this.status = "running";
  }
  stop() {
    this.status = "stopped";
    this.accumulator = 0;
    this.waiting = false;
  }
  setSpeed(speed: number) {
    this.timeScale = speedSchema.parse({ timeScale: speed }).timeScale;
  }
  setSchedulerMode(mode: SchedulerMode) {
    this.schedulerMode = mode;
    this.accumulator = 0;
    this.waiting = false;
  }
  getStatus(
    id: string,
    tick: number,
    pendingAgents: string[],
  ): SimulationStatus {
    return {
      id,
      status: this.status,
      mode: this.timeScale === 1 ? "realtime" : "accelerated",
      schedulerMode: this.schedulerMode,
      timeScale: this.timeScale,
      tick,
      simulationTimeMs: tick * TICK_MS,
      wallTimeMs: this.wallTimeMs,
      backlogMs: this.accumulator,
      droppedSimulationTimeMs: this.dropped,
      waitingForDecisions: this.waiting,
      pendingAgents,
    };
  }
}
