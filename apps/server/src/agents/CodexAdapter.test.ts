import { describe, expect, it } from "vitest";
import type { AgentObservation } from "../../../../packages/shared/src/index.js";
import { CodexAdapter } from "./CodexAdapter.js";
import type { RpcMessage, RpcTransport } from "./codex/AppServerRpc.js";
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
  mode: "normal" | "hang" | "empty" | "forbidden" | "early" | "json" = "normal";
  seenToolResult: any;
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
        if (this.mode === "forbidden") {
          this.emit("item/started", {
            threadId: params.threadId,
            item: { type: "commandExecution" },
          });
          return;
        }
        if (this.mode !== "empty" && this.mode !== "json")
          this.seenToolResult = await this.handler({
            id: 99,
            method: "item/tool/call",
            params: {
              threadId: params.threadId,
              turnId: id,
              namespace: null,
              tool: "world_move",
              arguments: {
                target: { x: 10, y: 0, z: 10 },
                motivation: "Explore",
              },
            },
          });
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
              this.mode === "json"
                ? JSON.stringify({
                    action: { type: "move", target: { x: 10, y: 0, z: 10 } },
                    motivation: "Explore via MCP",
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
const setup = (timeout = 1000) => {
  const rpc = new FakeRpc();
  const adapter = new CodexAdapter(
    async () => ({ rpc, cwd: "/private/island", close: () => rpc.close() }),
    timeout,
  );
  return { rpc, adapter };
};
describe("Codex decisions", () => {
  it("uses isolated thread settings, MCP tools, public motivation and resumes its own thread", async () => {
    const { rpc, adapter } = setup();
    try {
      const first = await adapter.decide(observation());
      expect(first.action.type).toBe("move");
      expect(first.motivation).toBe("Explore");
      expect(rpc.seenToolResult.success).toBe(true);
      const start = rpc.calls.find((c) => c.method === "thread/start")!.params;
      expect(start).toMatchObject({
        permissions: "island",
        approvalPolicy: "never",
        runtimeWorkspaceRoots: [],
      });
      expect(
        start.dynamicTools.every((t: any) => t.name.startsWith("world_")),
      ).toBe(true);
      await adapter.decide(observation());
      expect(rpc.calls.some((c) => c.method === "thread/resume")).toBe(true);
      expect(rpc.threads).toBe(1);
      expect(adapter.journal.list()).toHaveLength(2);
      expect(JSON.stringify(adapter.journal.list())).not.toContain(
        "PRIVATE_REASONING",
      );
      expect(adapter.journal.list()[0]!.publicMessage).toBe(
        "Exploring a new area.",
      );
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
  it("keeps separate threads and denies unknown thread, namespace and identity overrides", async () => {
    const { rpc, adapter } = setup();
    try {
      await Promise.all([
        adapter.decide(observation("alpha")),
        adapter.decide(observation("beta")),
      ]);
      expect(rpc.threads).toBe(2);
      expect(new Set(adapter.statuses().map((s) => s.threadId)).size).toBe(2);
      expect(
        (
          await rpc.handler({
            method: "item/tool/call",
            params: {
              threadId: "unknown",
              tool: "world_observe",
              arguments: {},
            },
          })
        ).success,
      ).toBe(false);
    } finally {
      await adapter.close();
    }
  });
  it("handles tool requests and completion before turn/start returns", async () => {
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
      expect(
        rpc.calls.find((c) => c.method === "turn/start")!.params.outputSchema
          .properties.action.anyOf,
      ).toBeDefined();
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
