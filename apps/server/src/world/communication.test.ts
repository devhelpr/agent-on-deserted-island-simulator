import { describe, expect, it } from "vitest";
import { WorldEngine } from "./WorldEngine.js";
import { flatWorld, p } from "./testFixtures.js";
describe("bounded world communication", () => {
  it("delivers only to visible nearby recipients and preserves the action result for the next decision", () => {
    const engine = new WorldEngine(flatWorld(), [
      { id: "alpha", name: "Alpha", position: p(0, 0) },
      { id: "beta", name: "Beta", position: p(0, 10) },
      { id: "gamma", name: "Gamma", position: p(0, -30) },
    ]);
    engine.submitAction("alpha", {
      type: "communicate",
      recipientId: "beta",
      message: "Hello",
    });
    engine.step();
    expect(engine.observe("beta")!.messages).toEqual([
      { from: "alpha", text: "Hello", tick: 1 },
    ]);
    expect(engine.observe("alpha")!.lastAction!.result).toEqual({
      delivered: true,
    });
    expect(engine.observe("gamma")!.messages).toEqual([]);
    engine.submitAction("alpha", {
      type: "communicate",
      recipientId: "gamma",
      message: "Not visible",
    });
    engine.step();
    expect(engine.observe("alpha")!.lastAction!.error).toBe(
      "RECIPIENT_NOT_VISIBLE",
    );
  });
});
