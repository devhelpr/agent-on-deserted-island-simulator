import { describe, expect, it } from "vitest";
import { Simulation } from "../simulation/Simulation.js";
import { SimulationStore } from "../storage/SimulationStore.js";
import { WorldEngine } from "./WorldEngine.js";
import { flatWorld, p, entity } from "./testFixtures.js";
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
    expect(engine.observe("beta")!.messages).toEqual(
      expect.arrayContaining([{ from: "alpha", text: "Hello", tick: 1 }]),
    );
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

describe("encounter greetings", () => {
  it("greets in both directions once, survives restoration, and greets again after separating", () => {
    const engine = new WorldEngine(flatWorld(), [
      { id: "alpha", name: "Alpha", position: p(0, 0) },
      { id: "beta", name: "Beta", position: p(0, 6), orientation: Math.PI },
    ]);
    engine.step();
    expect(engine.observe("alpha")!.messages).toHaveLength(1);
    expect(engine.observe("beta")!.messages).toHaveLength(1);
    expect(
      engine.getState().events.filter((e) => e.type === "agent:greeting"),
    ).toHaveLength(2);
    const saved = engine.checkpoint();
    engine.restore(saved);
    for (let i = 0; i < 50; i++) engine.step();
    expect(engine.observe("alpha")!.messages).toHaveLength(1);
    const apart = engine.checkpoint();
    apart.agents.find(([id]) => id === "beta")![1].position = p(0, 20);
    engine.restore(apart);
    engine.step();
    const together = engine.checkpoint();
    together.agents.find(([id]) => id === "beta")![1].position = p(0, 6);
    engine.restore(together);
    engine.step();
    expect(engine.observe("alpha")!.messages).toHaveLength(2);
    expect(engine.observe("beta")!.messages).toHaveLength(2);
  });
});

it("retains explicit speech and shared interactions as scoped experiment evidence", async () => {
  const store = new SimulationStore();
  const sim = new Simulation("speech", 0, 1, "experiment", null, {
    store,
    definition: flatWorld([entity("rock", "rock", -17, -16)]),
  });
  try {
    for (const id of ["alpha", "beta"])
      sim.engine.submitAction(id, { type: "inspect", entityId: "rock" });
    sim.engine.step();
    sim.engine.submitAction("alpha", {
      type: "look",
      orientation: Math.PI / 2,
    });
    sim.engine.step();
    sim.engine.submitAction("alpha", {
      type: "communicate",
      recipientId: "beta",
      message: "The rock is near (-17, -16).",
    });
    sim.engine.step();
    expect(
      sim.engine
        .observe("beta")!
        .messages!.some((m) => m.text.startsWith("The rock")),
    ).toBe(true);
    const message = store
      .timeline(sim.cycleId, 0)
      .find((e) => e.type === "agent:message")!;
    expect(message).toMatchObject({
      actorId: "alpha",
      targetId: "beta",
      message: "The rock is near (-17, -16).",
    });
    expect(
      sim.engine
        .observe("gamma")!
        .recentEvents.some((e) => e.type === "agent:message"),
    ).toBe(false);
    const metrics = store.metrics(sim.id)[0]!.agents;
    expect(metrics.find((a) => a.agentId === "alpha")).toMatchObject({
      messagesSent: 1,
      sharedObjects: 1,
    });
    expect(metrics.find((a) => a.agentId === "beta")!.sharedObjects).toBe(1);
    await sim.reset();
    expect(
      sim
        .memory!.list("beta")
        .some(
          (m) => m.provenance === "reported" && m.content.includes("The rock"),
        ),
    ).toBe(true);
    expect(
      sim.memory!.list("gamma").some((m) => m.content.includes("The rock")),
    ).toBe(false);
  } finally {
    await sim.shutdown();
    store.close();
  }
});
