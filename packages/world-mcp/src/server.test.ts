import { describe, expect, it } from "vitest";
import {
  createWorldToolSession,
  dynamicWorldTools,
  worldTools,
} from "./server.js";
import type { AgentObservation } from "../../shared/src/index.js";
const observation: AgentObservation = {
  tick: 10,
  agentId: "alpha",
  position: { x: 1, y: 2, z: 3 },
  orientation: 0,
  inventory: [],
  visibleEntities: [],
  visibleAgents: [],
  recentEvents: [],
};
describe("identity-bound World MCP", () => {
  it("advertises only world tools and returns a detached, filtered observation", async () => {
    const session = await createWorldToolSession(observation);
    try {
      expect(
        (await session.client.listTools()).tools.map((t) => t.name),
      ).toEqual(worldTools.map((t) => t.name));
      const result = await session.call("world_observe", {});
      expect(result.success).toBe(true);
      const data = JSON.parse(result.contentItems[0]!.text);
      expect(data.observation.agentId).toBe("alpha");
      expect(data.observation).not.toHaveProperty("entities");
      data.observation.position.x = 999;
      expect(
        JSON.parse(
          (await session.call("world_observe", {})).contentItems[0]!.text,
        ).observation.position.x,
      ).toBe(1);
      expect(
        dynamicWorldTools().every(
          (t) => !("agentId" in (t.inputSchema.properties ?? {})),
        ),
      ).toBe(true);
    } finally {
      await session.close();
    }
  });
  it("dispatches jump and throw proposals and checks carried ownership", async () => {
    for (const name of ["world_jump", "world_throw"]) {
      const session = await createWorldToolSession({
        ...observation,
        inventory: ["stone"],
      });
      try {
        if (name === "world_throw") {
          expect(
            (
              await session.call(name, {
                entityId: "other",
                target: observation.position,
                motivation: "Explore",
              })
            ).success,
          ).toBe(false);
        }
        const args = {
          target: observation.position,
          motivation: "Explore",
          ...(name === "world_throw" ? { entityId: "stone" } : {}),
        };
        expect((await session.call(name, args)).success).toBe(true);
        expect(session.proposed()?.action).toEqual({
          type: name.slice(6),
          target: observation.position,
          ...(name === "world_throw" ? { entityId: "stone" } : {}),
        });
      } finally {
        await session.close();
      }
    }
  });

  it("rejects identity overrides, unexpected fields, unknown tools and invalid coordinates", async () => {
    const session = await createWorldToolSession(observation);
    try {
      for (const [name, args] of [
        ["world_observe", { agentId: "beta" }],
        ["world_move", { target: { x: NaN, y: 0, z: 0 }, motivation: "x" }],
        [
          "world_pickup",
          { entityId: "rock", agentId: "beta", motivation: "x" },
        ],
        ["read_file", { path: "/etc/passwd" }],
      ] as const) {
        expect((await session.call(name, args)).success).toBe(false);
      }
      const direct = await session.client.callTool({
        name: "world_observe",
        arguments: { agentId: "beta" },
      });
      expect(direct.isError).toBe(true);
      expect(
        (
          await session.call("world_inspect", {
            entityId: "hidden-object",
            motivation: "Probe",
          })
        ).success,
      ).toBe(false);
      expect(
        (
          await session.call("world_communicate", {
            recipientId: "beta",
            message: "Hello",
            motivation: "Probe",
          })
        ).success,
      ).toBe(false);
      expect(session.proposed()).toBeNull();
    } finally {
      await session.close();
    }
  });
  it("stages at most one validated action without mutating a world", async () => {
    const trace: unknown[] = [];
    const session = await createWorldToolSession(observation, (event) =>
      trace.push(event),
    );
    try {
      expect(
        (
          await session.call("world_move", {
            target: { x: 10, y: 0, z: 3 },
            motivation: "Explore east",
          })
        ).success,
      ).toBe(true);
      expect(
        (
          await session.call("world_pickup", {
            entityId: "rock",
            motivation: "Collect",
          })
        ).success,
      ).toBe(false);
      expect(session.proposed()).toEqual({
        action: { type: "move", target: { x: 10, y: 0, z: 3 } },
        motivation: "Explore east",
      });
      expect(trace).toHaveLength(2);
    } finally {
      await session.close();
    }
    expect((await session.call("world_observe", {})).success).toBe(false);
  });
});

it("preserves public artifact assessments as metadata rather than world-action input", async () => {
  const session = await createWorldToolSession(observation);
  const considerations = [
    {
      entityId: "artifact",
      decision: "defer",
      reason:
        "My inventory is full; I will finish studying my current find first.",
    },
  ];
  try {
    expect(
      (
        await session.call("world_wait", {
          durationMs: 1000,
          motivation: "Study my find",
          artifactConsiderations: considerations,
        })
      ).success,
    ).toBe(true);
    expect(session.proposed()).toEqual({
      action: { type: "wait", durationMs: 1000 },
      motivation: "Study my find",
      artifactConsiderations: considerations,
    });
  } finally {
    await session.close();
  }
});

it("exposes crafting and gathering through the identity-bound session", async () => {
  const session = await createWorldToolSession(observation);
  try {
    expect(
      (
        await session.call("world_gather", {
          entityId: "hidden-tree",
          motivation: "Collect wood",
        })
      ).success,
    ).toBe(false);
    expect(
      (
        await session.call("world_craft", {
          recipeId: "invented",
          motivation: "Try recipe",
        })
      ).success,
    ).toBe(false);
    expect(
      (
        await session.call("world_craft", {
          recipeId: "rope",
          motivation: "Bind collected fibers",
        })
      ).success,
    ).toBe(true);
    expect(session.proposed()!.action).toEqual({
      type: "craft",
      recipeId: "rope",
    });
    expect(
      (
        await session.call("world_craft", {
          recipeId: "plank",
          motivation: "Second action",
        })
      ).success,
    ).toBe(false);
  } finally {
    await session.close();
  }
});
