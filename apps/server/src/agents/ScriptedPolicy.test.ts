import { describe, expect, it } from "vitest";
import { createScriptedPolicy } from "./ScriptedPolicy.js";
import type { PolicyProposal } from "./AgentScheduler.js";
import { WorldEngine } from "../world/WorldEngine.js";
import { flatWorld, entity, p } from "../world/testFixtures.js";
import { Simulation } from "../simulation/Simulation.js";
import { SimulationStore } from "../storage/SimulationStore.js";

const artifact = (id = "crystal", x = 0, z = 4, movable = true) => ({
  ...entity(id, "artifact", x, z),
  kind: "crystal" as const,
  label: "Glowing crystal",
  properties: { movable, inspectable: true },
});

describe("purposeful artifact collection", () => {
  it("collects, studies and carries a find visibly before placing it once", () => {
    const engine = new WorldEngine(flatWorld([artifact()]), [
      { id: "alpha", name: "Alpha", position: p(0, 0) },
    ]);
    const policy = createScriptedPolicy();
    const chosen: PolicyProposal[] = [];
    let pickupTick = 0,
      dropTick = 0,
      movedWhileCarrying = false;
    for (let tick = 0; tick < 650; tick++) {
      if (!engine.getAgents()[0]!.activeActionId) {
        const proposal = policy(engine.observe("alpha")!) as PolicyProposal;
        chosen.push(proposal);
        expect(proposal.motivation).toBeTruthy();
        engine.submitAction("alpha", proposal.action, {
          motivation: proposal.motivation,
          artifactConsiderations: proposal.artifactConsiderations,
        });
      }
      engine.step();
      const o = engine.observe("alpha")!;
      if (
        o.lastAction?.input.type === "pickup" &&
        o.lastAction.status === "succeeded"
      )
        pickupTick ||= o.tick;
      if (
        o.lastAction?.input.type === "drop" &&
        o.lastAction.status === "succeeded"
      )
        dropTick ||= o.tick;
      if (o.inventory.length && Math.hypot(o.position.x, o.position.z) >= 12)
        movedWhileCarrying = true;
      if (pickupTick && o.tick < pickupTick + 400)
        expect(o.inventory).toEqual(["crystal"]);
    }
    expect(chosen[0]!.action).toEqual({ type: "pickup", entityId: "crystal" });
    expect(chosen[0]!.artifactConsiderations).toContainEqual(
      expect.objectContaining({ entityId: "crystal", decision: "pickup" }),
    );
    expect(chosen.filter((d) => d.action.type === "pickup")).toHaveLength(1);
    expect(chosen.some((d) => d.action.type === "inspect")).toBe(true);
    expect(chosen.some((d) => d.action.type === "interact")).toBe(true);
    expect(movedWhileCarrying).toBe(true);
    expect(dropTick - pickupTick).toBeGreaterThanOrEqual(400);
  });

  it("approaches a distant find and retries a failed route after a cooldown", () => {
    const engine = new WorldEngine(flatWorld([artifact("distant", 0, 15)]), [
      { id: "alpha", name: "Alpha", position: p(0, 0) },
    ]);
    const policy = createScriptedPolicy();
    const first = policy(engine.observe("alpha")!) as PolicyProposal;
    expect(first.action.type).toBe("move");
    expect(first.artifactConsiderations![0]!.decision).toBe("approach");
    const o = engine.observe("alpha")!;
    o.tick = 50;
    o.lastAction = {
      id: "failed",
      agentId: "alpha",
      input: first.action,
      status: "failed",
      error: "PATH_BLOCKED",
      submittedAtTick: 0,
      finishedAtTick: 50,
    };
    const after = policy(o) as PolicyProposal;
    expect(after.motivation).toContain("PATH_BLOCKED");
    expect(after.artifactConsiderations![0]!.decision).toBe("defer");
    o.tick = 251;
    expect(
      (policy(o) as PolicyProposal).artifactConsiderations![0]!.decision,
    ).toBe("approach");
  });

  it("explains ownership, immovability and capacity without attempting an impossible pickup", () => {
    const engine = new WorldEngine(
      flatWorld([
        artifact("held", 0, 5),
        artifact("fixed", 3, 4, false),
        artifact("free", -3, 4),
      ]),
      [
        { id: "alpha", name: "Alpha", position: p(0, 0) },
        { id: "beta", name: "Beta", position: p(0, 8), orientation: Math.PI },
      ],
    );
    engine.submitAction("beta", { type: "pickup", entityId: "held" });
    engine.step();
    const observation = engine.observe("alpha")!;
    expect(
      observation.visibleEntities.find((e) => e.id === "held")!.pickup,
    ).toMatchObject({ eligible: false, blocker: "OBJECT_UNAVAILABLE" });
    expect(
      observation.visibleEntities.find((e) => e.id === "fixed")!.pickup!
        .blocker,
    ).toBe("NOT_MOVABLE");
    const first = createScriptedPolicy()(observation) as PolicyProposal;
    expect(
      first.artifactConsiderations!.find((c) => c.entityId === "held")!.reason,
    ).toContain("beta");
    expect(
      first.artifactConsiderations!.find((c) => c.entityId === "fixed")!.reason,
    ).toContain("niet verplaatsbaar");
    observation.inventory = ["my-find"];
    const full = createScriptedPolicy()(observation) as PolicyProposal;
    expect(full.action.type).not.toBe("pickup");
    expect(
      full.artifactConsiderations!.find((c) => c.entityId === "free")!.reason,
    ).toContain("bezet");
  });

  it("retains the same public explanation in decisions, queued actions, outcomes and replay", async () => {
    const store = new SimulationStore();
    const sim = new Simulation("explanation", 0, 1, "experiment", undefined, {
      store,
      definition: flatWorld([artifact("near", -20, -16)]),
    });
    try {
      sim.advance(50);
      const record = store.listDecisions(sim.id, "alpha")[0]!;
      expect(record.action!.type).toBe("pickup");
      expect(record.motivation).toContain("vrije inventarisplek");
      const outcome = sim.engine.getAction(record.actionId!)!;
      expect(outcome.status).toBe("succeeded");
      expect(outcome.motivation).toBe(record.motivation);
      const event = store
        .timeline(sim.cycleId, 0)
        .find((e) => e.actionId === record.actionId)!;
      expect(event.artifactConsiderations).toEqual(
        record.artifactConsiderations,
      );
      const replay = store.replay.reconstruct(sim.cycleId, 1)!;
      expect(
        replay.checkpoint.actions.find(([id]) => id === record.actionId)![1]
          .motivation,
      ).toBe(record.motivation);
    } finally {
      await sim.shutdown();
      store.close();
    }
  });
});

it("collects varied bag materials and autonomously crafts and uses multi-step tools", () => {
  const kinds = [
    "wood",
    "wood",
    "resin",
    "fiber",
    "fiber",
    "fiber",
    "stone",
    "stone",
  ] as const;
  const engine = new WorldEngine(
    flatWorld(
      kinds.map((itemKind, i) => ({
        ...entity(`material-${i}`, "item", 0, 2),
        itemKind,
        properties: { movable: true, inspectable: true },
      })),
    ),
    [{ id: "alpha", name: "Alpha", position: p(0, 0) }],
  );
  const policy = createScriptedPolicy();
  let maxHeld = 0;
  for (let i = 0; i < 80; i++) {
    if (!engine.getAgents()[0]!.activeActionId) {
      const proposal = policy(engine.observe("alpha")!) as PolicyProposal;
      engine.submitAction("alpha", proposal.action, {
        motivation: proposal.motivation,
      });
    }
    engine.step();
    maxHeld = Math.max(maxHeld, engine.getAgents()[0]!.inventory.length);
  }
  expect(maxHeld).toBeGreaterThan(1);
  expect(engine.getState().entities).toContainEqual(
    expect.objectContaining({
      itemKind: "torch",
      ownerId: "alpha",
      activated: true,
    }),
  );
  expect(engine.getState().entities).toContainEqual(
    expect.objectContaining({ itemKind: "axe", ownerId: "alpha" }),
  );
});
