import { describe, expect, it } from "vitest";
import { SimulationClock } from "./SimulationClock.js";
describe("fixed virtual clock", () => {
  it.each([1, 2, 5, 10, 20])(
    "advances at %ix independently of pump frequency",
    (scale) => {
      const clock = new SimulationClock(0, scale);
      let ticks = 0;
      for (let now = 10; now <= 1000; now += 10)
        clock.pump(now, () => {
          ticks++;
          return true;
        });
      expect(ticks).toBe(20 * scale);
      expect(clock.getStatus("test", ticks, []).simulationTimeMs).toBe(
        1000 * scale,
      );
    },
  );
  it("pauses without debt and applies speed changes prospectively", () => {
    const clock = new SimulationClock();
    let ticks = 0;
    const step = () => {
      ticks++;
      return true;
    };
    clock.pump(1000, step);
    clock.pause();
    clock.pump(6000, step);
    expect(ticks).toBe(20);
    clock.setSpeed(10);
    clock.resume();
    clock.pump(6100, step);
    expect(ticks).toBe(40);
    clock.stop();
    clock.resume();
    clock.pump(9000, step);
    expect(ticks).toBe(40);
    expect(clock.getStatus("test", ticks, []).status).toBe("stopped");
  });
  it("bounds catch-up and reports dropped virtual time", () => {
    const clock = new SimulationClock(0, 20);
    let ticks = 0;
    clock.pump(10000, () => {
      ticks++;
      return true;
    });
    expect(ticks).toBe(100);
    expect(clock.getStatus("test", ticks, []).droppedSimulationTimeMs).toBe(
      195000,
    );
    clock.pump(9999, () => {
      ticks++;
      return true;
    });
    expect(ticks).toBe(100);
  });
  it("blocks virtual time at a decision barrier without catching up the waiting time", () => {
    const clock = new SimulationClock(0, 20, "experiment");
    clock.pump(1000, () => false);
    expect(clock.getStatus("test", 0, []).waitingForDecisions).toBe(true);
    let ticks = 0;
    clock.pump(1010, () => {
      ticks++;
      return true;
    });
    expect(ticks).toBe(4);
  });
});
