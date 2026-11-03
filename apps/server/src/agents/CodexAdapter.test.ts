import { describe, expect, it, vi } from "vitest";
import type { AgentObservation } from "../../../../packages/shared/src/index.js";
import { CodexAdapter } from "./CodexAdapter.js";
import type { RpcMessage, RpcTransport } from "./codex/AppServerRpc.js";
import { WorldEngine } from "../world/WorldEngine.js";
import { Simulation } from "../simulation/Simulation.js";
import { SimulationStore } from "../storage/SimulationStore.js";
import { flatWorld, entity } from "../world/testFixtures.js";
import { ISLAND_CONFIG } from "./codex/IsolatedRuntime.js";
const observation = (id = "alpha"): AgentObservation => ({
  tick: 0,
  agentId: id,
  position: { x: 0, y: 2, z: 0 },
  orientation: 0,
  inventory: [],
  visibleEntities: [],
  visibleAgents: [],
  recentEvents: [],
});
class FakeRpc implements RpcTransport {
  calls: { method: string; params: any }[] = [];
  listeners = new Set<(message: RpcMessage) => void>();
  handler: (message: RpcMessage) => Promise<any> = async () => null;
  alive = true;
  threads = 0;
  turns = 0;
  mode:
    "normal" | "hang" | "empty" | "forbidden" | "early" | "json" | "rateLimit" =
    "normal";
  async request<T = any>(method: string, params: any): Promise<T> {
    this.calls.push({ method, params });
    if (method === "thread/start")
      return {
        thread: { id: `thread-${++this.threads}` },
        approvalPolicy: "never",
        activePermissionProfile: { id: "island" },
      } as T;
    if (method === "thread/resume")
      return {
        thread: { id: params.threadId },
        approvalPolicy: "never",
        activePermissionProfile: { id: "island" },
      } as T;
    if (method === "turn/interrupt") {
      this.emit("turn/completed", {
        threadId: params.threadId,
        turn: { id: params.turnId, status: "interrupted" },
      });
      return {} as T;
    }
    if (method === "turn/start") {
      const id = `turn-${++this.turns}`;
      this.emit("turn/started", { threadId: params.threadId, turn: { id } });
      const execute = async () => {
        if (this.mode === "hang") return;
        if (this.mode === "rateLimit") {
          this.emit("turn/completed", {
            threadId: params.threadId,
            turn: {
              id,
              status: "failed",
              error: {
                message:
                  "exceeded retry limit, last status: 429 Too Many Requests",
              },
            },
          });
          return;
        }
        if (this.mode === "forbidden") {
          this.emit("item/started", {
            threadId: params.threadId,
            item: { type: "commandExecution" },
          });
          return;
        }
        this.emit("item/completed", {
          threadId: params.threadId,
          item: {
            type: "reasoning",
            summary: ["PRIVATE_REASONING_MUST_NOT_BE_RECORDED"],
          },
        });
        this.emit("item/completed", {
          threadId: params.threadId,
          item: {
            type: "agentMessage",
            text:
              this.mode !== "empty"
                ? JSON.stringify({
                    action: { type: "move", target: { x: 10, y: 0, z: 10 } },
                    motivation: "Explore via MCP",
                    artifactConsiderations: [
                      {
                        entityId: "artifact-near",
                        decision: "approach",
                        reason:
                          "It is portable but too far away; I will approach first.",
                      },
                    ],
                  })
                : "Exploring a new area.",
          },
        });
        this.emit("turn/completed", {
          threadId: params.threadId,
          turn: { id, status: "completed" },
        });
      };
      if (this.mode === "early") await execute();
      else queueMicrotask(() => void execute());
      return { turn: { id } } as T;
    }
    return {} as T;
  }
  notify(method: string, params?: unknown) {
    this.calls.push({ method, params });
  }
  emit(method: string, params: any) {
    for (const listener of this.listeners) listener({ method, params });
  }
  onNotification(listener: (message: RpcMessage) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  onRequest(handler: (message: RpcMessage) => Promise<unknown>) {
    this.handler = handler;
  }
  isAlive() {
    return this.alive;
  }
  async close() {
    this.alive = false;
    this.emit("transport/closed", {});
  }
}
const setup = (timeout = 1000, minDecisionIntervalMs = 0) => {
  const rpc = new FakeRpc();
  const adapter = new CodexAdapter(
    async () => ({ rpc, cwd: "/private/island", close: () => rpc.close() }),
    timeout,
    minDecisionIntervalMs,
  );
  return { rpc, adapter };
};
describe("Codex decisions", () => {
  it("supplies expanded sight and visible objects in the decision context", async () => {
    const { rpc, adapter } = setup();
    const engine = new WorldEngine(
      flatWorld([entity("peripheral", "artifact", 40, 5)]),
      [{ id: "alpha", name: "Alpha", position: { x: 0, y: 2, z: 0 } }],
    );
    try {
      await adapter.decide(engine.observe("alpha")!);
      const prompt = rpc.calls.find((call) => call.method === "turn/start")!
        .params.input[0].text;
      const context = JSON.parse(prompt.split("\n")[1]);
      expect(context.perception).toMatchObject({
        range: 50,
        fieldOfView: Math.PI,
      });
      expect(context.visibleEntities).toMatchObject([
        { id: "peripheral", position: { x: 40, z: 5 } },
      ]);
    } finally {
      await adapter.close();
    }
  });
  it("spaces decision starts across agents in wall time and preserves pacing on reset", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1000000);
    const { rpc, adapter } = setup(1000, 10000);
    try {
      const first = adapter.decide(observation());
      await expect(adapter.decide(observation("beta"))).rejects.toThrow(
        "CODEX_THROTTLED",
      );
      await first;
      expect(adapter.canDecide()).toBe(false);
      expect(rpc.turns).toBe(1);
      expect(adapter.journal.list()).toHaveLength(1);
      await adapter.resetCycle();
      vi.setSystemTime(1009999);
      expect(adapter.canDecide()).toBe(false);
      vi.setSystemTime(1010000);
      expect(adapter.canDecide()).toBe(true);
      await adapter.decide(observation("beta"));
      expect(rpc.turns).toBe(2);
    } finally {
      await adapter.close();
      vi.useRealTimers();
    }
  });
  it("does not spend experiment attempts while paced at accelerated speed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1000000);
    const { rpc, adapter } = setup(1000, 10000);
    const sim = new Simulation("paced", 0, 20, "live", undefined, {
      adapter,
      controller: "codex",
      agentCount: 1,
      definition: flatWorld(),
      experiment: { maxCycles: 1, decisionBudgetPerAgentPerCycle: 5 },
    });
    const settle = async () => {
      for (let i = 0; i < 100 && sim.scheduler!.pendingAgents().length; i++)
        await new Promise((done) => setTimeout(done, 1));
    };
    try {
      sim.advance(50);
      await settle();
      for (let now = 100; now <= 5000; now += 50) sim.advance(now);
      expect(rpc.turns).toBe(1);
      expect(sim.status().experiment!.decisionsUsed).toEqual({ alpha: 1 });
      vi.setSystemTime(1010000);
      sim.advance(5050);
      await settle();
      expect(rpc.turns).toBe(2);
      expect(sim.status().experiment!.decisionsUsed).toEqual({ alpha: 2 });
    } finally {
      await sim.shutdown();
      vi.useRealTimers();
    }
  });
  it("runs only Alpha in solo mode, including after a cycle reset", async () => {
    const { rpc, adapter } = setup();
    const store = new SimulationStore();
    const sim = new Simulation("solo", 0, 1, "experiment", undefined, {
      adapter,
      store,
      controller: "codex",
      agentCount: 1,
      definition: flatWorld(),
      experiment: { maxCycles: 2, decisionBudgetPerAgentPerCycle: 1 },
    });
    const decide = async (now: number) => {
      sim.advance(now);
      for (let i = 0; i < 100 && sim.scheduler!.pendingAgents().length; i++)
        await new Promise((done) => setTimeout(done, 1));
      sim.advance(now + 50);
    };
    try {
      await decide(50);
      expect(sim.snapshot().state.agents.map((agent) => agent.id)).toEqual([
        "alpha",
      ]);
      expect(sim.engine.observe("alpha")!.visibleAgents).toEqual([]);
      expect(sim.engine.observe("beta")).toBeNull();
      expect(rpc.turns).toBe(1);
      expect(sim.status().experiment!.decisionsUsed).toEqual({ alpha: 1 });
      expect(store.listDecisions(sim.id, "alpha")[0]!.status).toBe("submitted");
      await sim.reset();
      await decide(150);
      expect(sim.engine.getAgents().map((agent) => agent.id)).toEqual([
        "alpha",
      ]);
      expect(rpc.turns).toBe(2);
      expect(rpc.threads).toBe(2);
      expect(store.listDecisions(sim.id, "beta")).toEqual([]);
      expect(store.listDecisions(sim.id, "gamma")).toEqual([]);
    } finally {
      await sim.shutdown();
      store.close();
    }
  });
  it("backs off all agents in wall time, grows the delay and recovers using the same thread", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1000000);
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    const { rpc, adapter } = setup();
    rpc.mode = "rateLimit";
    try {
      const failures = await Promise.allSettled([
        adapter.decide(observation("alpha")),
        adapter.decide(observation("beta")),
      ]);
      expect(failures.every((r) => r.status === "rejected")).toBe(true);
      expect(adapter.journal.list()[0]!.error).toContain("CODEX_RATE_LIMITED:");
      expect(adapter.canDecide()).toBe(false);
      await expect(adapter.decide(observation("gamma"))).rejects.toThrow(
        "CODEX_RATE_LIMITED",
      );
      expect(rpc.turns).toBe(2);
      expect(adapter.journal.list()).toHaveLength(2);
      expect(rpc.calls.some((c) => c.method === "turn/interrupt")).toBe(false);
      expect(rpc.alive).toBe(true);

      vi.setSystemTime(1029999);
      expect(adapter.canDecide()).toBe(false);
      vi.setSystemTime(1030000);
      expect(adapter.canDecide()).toBe(true);
      await expect(adapter.decide(observation())).rejects.toThrow(
        "CODEX_RATE_LIMITED",
      );
      vi.setSystemTime(1089999);
      expect(adapter.canDecide()).toBe(false);
      vi.setSystemTime(1090000);
      rpc.mode = "normal";
      await adapter.decide(observation());
      expect(rpc.threads).toBe(2);
      expect(adapter.canDecide()).toBe(true);

      rpc.mode = "rateLimit";
      await expect(adapter.decide(observation())).rejects.toThrow(
        "CODEX_RATE_LIMITED",
      );
      vi.setSystemTime(1120000);
      expect(adapter.canDecide()).toBe(true);
    } finally {
      await adapter.close();
      random.mockRestore();
      vi.useRealTimers();
    }
  });
  it("does not spend experiment attempts during backoff even at accelerated simulation speed", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { rpc, adapter } = setup();
    rpc.mode = "rateLimit";
    const store = new SimulationStore();
    const sim = new Simulation("limited", 0, 20, "experiment", undefined, {
      adapter,
      store,
      controller: "codex",
      codexAgentIds: ["alpha", "beta", "gamma"],
      definition: flatWorld(),
      experiment: { maxCycles: 1, decisionBudgetPerAgentPerCycle: 5 },
    });
    const settle = async () => {
      for (let i = 0; i < 100 && sim.scheduler!.pendingAgents().length; i++)
        await new Promise((done) => setTimeout(done, 1));
    };
    try {
      sim.advance(50);
      await settle();
      expect(rpc.turns).toBe(3);
      for (let now = 100; now <= 5000; now += 50) sim.advance(now);
      expect(rpc.turns).toBe(3);
      for (const id of ["alpha", "beta", "gamma"])
        expect(store.listDecisions(sim.id, id)).toHaveLength(1);
      vi.setSystemTime(Date.now() + 35000);
      rpc.mode = "normal";
      sim.advance(5050);
      await settle();
      expect(rpc.turns).toBe(6);
    } finally {
      await sim.shutdown();
      store.close();
      vi.useRealTimers();
    }
  });
  it("uses isolated thread settings, JSON decisions, public motivation and resumes its own thread", async () => {
    const { rpc, adapter } = setup();
    try {
      const first = await adapter.decide(observation());
      expect(first.action.type).toBe("move");
      expect(first.motivation).toBe("Explore via MCP");
      const start = rpc.calls.find((c) => c.method === "thread/start")!.params;
      expect(start).toMatchObject({
        permissions: "island",
        approvalPolicy: "never",
        runtimeWorkspaceRoots: [],
      });
      expect(start.dynamicTools).toEqual([]);
      await adapter.decide(observation());
      expect(rpc.calls.some((c) => c.method === "thread/resume")).toBe(true);
      expect(rpc.threads).toBe(1);
      expect(adapter.journal.list()).toHaveLength(2);
      expect(JSON.stringify(adapter.journal.list())).not.toContain(
        "PRIVATE_REASONING",
      );
      expect(
        JSON.parse(adapter.journal.list()[0]!.publicMessage!).action.type,
      ).toBe("move");
    } finally {
      await adapter.close();
    }
  });
  it("starts a fresh thread after a cycle reset and supplies only the agent's retained memory", async () => {
    const { rpc, adapter } = setup();
    try {
      await adapter.decide(observation());
      const firstThread = adapter.statuses()[0]!.threadId;
      await adapter.resetCycle();
      expect(adapter.statuses()).toEqual([]);
      expect(adapter.journal.list()).toEqual([]);
      const next = observation();
      next.memory = {
        summary: "I saw a cave to the north.",
        relevant: [],
        recent: [],
        goals: ["Revisit the cave."],
      };
      await adapter.decide(next);
      expect(adapter.statuses()[0]!.threadId).not.toBe(firstThread);
      expect(rpc.calls.filter((c) => c.method === "thread/start")).toHaveLength(
        2,
      );
      expect(
        rpc.calls.filter((c) => c.method === "turn/start").at(-1)!.params
          .input[0].text,
      ).toContain("I saw a cave");
    } finally {
      await adapter.close();
    }
  });
  it("keeps separate threads and rejects model tool calls", async () => {
    const { rpc, adapter } = setup();
    try {
      await Promise.all([
        adapter.decide(observation("alpha")),
        adapter.decide(observation("beta")),
      ]);
      expect(rpc.threads).toBe(2);
      expect(new Set(adapter.statuses().map((s) => s.threadId)).size).toBe(2);
      await expect(
        rpc.handler({
          method: "item/tool/call",
          params: {
            threadId: adapter.statuses()[0]!.threadId,
            tool: "world_move",
            arguments: { target: { x: 10, y: 0, z: 10 } },
          },
        }),
      ).rejects.toThrow("REQUEST_NOT_ALLOWED");
    } finally {
      await adapter.close();
    }
  });
  it("handles JSON completion before turn/start returns", async () => {
    const { rpc, adapter } = setup();
    rpc.mode = "early";
    try {
      expect((await adapter.decide(observation())).action.type).toBe("move");
    } finally {
      await adapter.close();
    }
  });
  it("interrupts cancelled/hung turns and prevents overlapping model calls", async () => {
    const { rpc, adapter } = setup(100);
    rpc.mode = "hang";
    try {
      const controller = new AbortController();
      const first = adapter.decide(observation(), controller.signal);
      while (!rpc.calls.some((c) => c.method === "turn/start"))
        await new Promise((r) => setTimeout(r, 1));
      await expect(adapter.decide(observation())).rejects.toThrow(
        "AGENT_TURN_ALREADY_ACTIVE",
      );
      controller.abort();
      await expect(first).rejects.toThrow();
      expect(rpc.calls.some((c) => c.method === "turn/interrupt")).toBe(true);
      await expect(adapter.decide(observation())).rejects.toThrow(
        "CODEX_TURN_TIMEOUT",
      );
      expect(adapter.journal.list().at(-1)!.status).toBe("failed");
    } finally {
      await adapter.close();
    }
  });
  it("rejects empty decisions and forbidden built-in tools", async () => {
    for (const mode of ["empty", "forbidden"] as const) {
      const { rpc, adapter } = setup();
      rpc.mode = mode;
      try {
        await expect(adapter.decide(observation())).rejects.toThrow(
          mode === "empty"
            ? "INVALID_STRUCTURED_DECISION"
            : "FORBIDDEN_TOOL_ATTEMPT",
        );
      } finally {
        await adapter.close();
      }
    }
  });
  it("dispatches validated structured decisions through MCP without enabling host tools", async () => {
    const { rpc, adapter } = setup();
    rpc.mode = "json";
    try {
      const result = await adapter.decide(observation());
      expect(result.action.type).toBe("move");
      expect(result.record.tools).toHaveLength(1);
      expect(result.record.tools[0]!.tool).toBe("world_move");
      expect(result.record.tools[0]!.success).toBe(true);
      expect(result.record.artifactConsiderations).toEqual([
        {
          entityId: "artifact-near",
          decision: "approach",
          reason: "It is portable but too far away; I will approach first.",
        },
      ]);
      expect(result.artifactConsiderations).toEqual(
        result.record.artifactConsiderations,
      );
      const outputSchema = rpc.calls.find((c) => c.method === "turn/start")!
        .params.outputSchema;
      expect(outputSchema.properties.action.anyOf).toBeDefined();
      expect(outputSchema.required).toEqual(
        expect.arrayContaining(Object.keys(outputSchema.properties)),
      );
    } finally {
      await adapter.close();
    }
  });
  it("finishes the last budgeted turn for all three agents and renews isolated threads after reset", async () => {
    const { rpc, adapter } = setup();
    const store = new SimulationStore();
    const sim = new Simulation("three", 0, 1, "experiment", undefined, {
      adapter,
      store,
      controller: "codex",
      codexAgentIds: ["alpha", "beta", "gamma"],
      definition: flatWorld([entity("cave", "cave", -20, 5)]),
      experiment: { maxCycles: 2, decisionBudgetPerAgentPerCycle: 1 },
    });
    const settle = async () => {
      for (let i = 0; i < 100 && sim.scheduler!.pendingAgents().length; i++)
        await new Promise((done) => setTimeout(done, 1));
    };
    try {
      sim.advance(50);
      sim.advance(100); // Preparing again must retain budgeted in-flight decisions.
      await settle();
      sim.advance(150);
      expect(rpc.threads).toBe(3);
      expect(new Set(adapter.statuses().map((s) => s.threadId)).size).toBe(3);
      for (const id of ["alpha", "beta", "gamma"]) {
        const records = store.listDecisions(sim.id, id);
        expect(records).toHaveLength(1);
        expect(records[0]!.status).toBe("submitted");
      }
      await sim.reset();
      sim.advance(200);
      await settle();
      sim.advance(250);
      expect(rpc.threads).toBe(6);
      for (const id of ["alpha", "beta", "gamma"]) {
        const records = store.listDecisions(sim.id, id);
        expect(records).toHaveLength(2);
        expect(records[1]!.threadId).not.toBe(records[0]!.threadId);
        expect(
          records[1]!.observation.memory!.relevant.every(
            (m) => m.agentId === id,
          ),
        ).toBe(true);
        expect(records[1]!.status).toBe("submitted");
      }
    } finally {
      await sim.shutdown();
      store.close();
    }
  });
  it("locks out host capabilities in the isolated config", () => {
    expect(ISLAND_CONFIG).toContain("mcp_servers = {}");
    expect(ISLAND_CONFIG).toContain("shell_tool = false");
    expect(ISLAND_CONFIG).toContain("plugins = false");
    expect(ISLAND_CONFIG).toContain('":root" = "deny"');
    expect(ISLAND_CONFIG).toContain("enabled = false");
  });
});
