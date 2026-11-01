import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { io, type Socket } from "socket.io-client";
import { describe, expect, it } from "vitest";
import type {
  ClientEvents,
  ServerEvents,
  SimulationStatus,
  WorldSnapshot,
  WorldStateDto,
} from "../../../packages/shared/src/index.js";
import { createApp, startServer } from "./createApp.js";
const json = (method: string, body: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
describe("simulation API", () => {
  it("serves a complete world and rejects raw position writes", async () => {
    const { app } = createApp({ policy: null });
    expect((await app.request("/api/health")).status).toBe(200);
    const snapshot = (await (
      await app.request("/api/world")
    ).json()) as WorldSnapshot;
    expect(snapshot.definition.entities).toHaveLength(213);
    expect(snapshot.state.agents.map((a) => a.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
    ]);
    expect((await app.request("/api/world", json("POST", {}))).status).toBe(
      404,
    );
    expect((await app.request("/api/simulations/unknown/world")).status).toBe(
      404,
    );
    expect(
      (await app.request("/api/simulations/unknown/pause", { method: "POST" }))
        .status,
    ).toBe(404);
  });
  it("controls speed, pause/resume, mode and stop without paused-time debt", async () => {
    let now = 0;
    const runtime = createApp({ now: () => now, policy: null });
    const base = "/api/simulations/sim-001";
    now = 1000;
    const paused = (await (
      await runtime.app.request(`${base}/pause`, { method: "POST" })
    ).json()) as SimulationStatus;
    expect(paused.tick).toBe(20);
    expect(paused.status).toBe("paused");
    now = 10000;
    await runtime.app.request(
      `${base}/speed`,
      json("PATCH", { timeScale: 20 }),
    );
    await runtime.app.request(
      `${base}/mode`,
      json("PATCH", { schedulerMode: "experiment" }),
    );
    const resumed = (await (
      await runtime.app.request(`${base}/resume`, { method: "POST" })
    ).json()) as SimulationStatus;
    expect(resumed.tick).toBe(20);
    now = 10100;
    runtime.advance();
    expect(runtime.engine.getTick()).toBe(60);
    const stopped = (await (
      await runtime.app.request(`${base}/stop`, { method: "POST" })
    ).json()) as SimulationStatus;
    expect(stopped.status).toBe("stopped");
    expect(
      (await runtime.app.request(`${base}/resume`, { method: "POST" })).status,
    ).toBe(409);
    now = 12000;
    runtime.advance();
    expect(runtime.engine.getTick()).toBe(60);
  });
  it("validates configuration/actions and queues/cancels actions through the engine", async () => {
    const runtime = createApp({ now: () => 0, policy: null });
    const { app } = runtime;
    const base = "/api/simulations/sim-001";
    expect(
      (await app.request(`${base}/speed`, json("PATCH", { timeScale: NaN })))
        .status,
    ).toBe(400);
    expect(
      (await app.request(`${base}/speed`, json("PATCH", { timeScale: 3 })))
        .status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `${base}/mode`,
          json("PATCH", { schedulerMode: "other" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await app.request(
          "/api/simulations",
          json("POST", { worldId: "unknown" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (await app.request("/api/simulations", { method: "POST", body: "{" }))
        .status,
    ).toBe(400);
    expect(
      (
        await app.request(
          `${base}/agents/alpha/actions`,
          json("POST", { type: "move", target: { x: 1, y: 0 } }),
        )
      ).status,
    ).toBe(400);
    const action = await (
      await app.request(
        `${base}/agents/alpha/actions`,
        json("POST", { type: "move", target: { x: -18, y: 0, z: 10 } }),
      )
    ).json();
    expect(action.accepted).toBe(true);
    expect(
      (
        await app.request(
          `${base}/agents/alpha/actions`,
          json("POST", { type: "wait", durationMs: 50 }),
        )
      ).status,
    ).toBe(409);
    runtime.advance(50);
    expect(runtime.engine.getAction(action.actionId)!.status).toBe("running");
    expect(
      (
        await app.request(
          `${base}/agents/beta/actions/${action.actionId}/cancel`,
          { method: "POST" },
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await app.request(
          `${base}/agents/alpha/actions/${action.actionId}/cancel`,
          { method: "POST" },
        )
      ).status,
    ).toBe(200);
    expect(
      (await app.request(`${base}/agents/unknown/observation`)).status,
    ).toBe(404);
    const observation = await (
      await app.request(`${base}/agents/alpha/observation`)
    ).json();
    expect(observation).not.toHaveProperty("entities");
    expect(observation.agentId).toBe("alpha");
    const blocked = await app.request(`${base}/pause`, {
      method: "POST",
      headers: { Origin: "https://external.example" },
    });
    expect(blocked.status).toBe(403);
  });
  it("keeps run states isolated and cancels outstanding work on stop", async () => {
    const runtime = createApp({ now: () => 0, policy: null });
    const created = await runtime.app.request(
      "/api/simulations",
      json("POST", { timeScale: 10, schedulerMode: "experiment" }),
    );
    expect(created.status).toBe(201);
    const second = (await created.json()) as SimulationStatus;
    expect(second.id).toBe("sim-002");
    runtime.engine.submitAction("alpha", { type: "wait", durationMs: 60000 });
    runtime.advance(100);
    runtime.simulations.get("sim-001")!.stop();
    expect(runtime.engine.getState().actions[0]!.status).toBe("cancelled");
    expect(runtime.simulations.get("sim-002")!.engine.getTick()).toBe(20);
    expect(runtime.engine.getTick()).toBe(2);
    const list = await (await runtime.app.request("/api/simulations")).json();
    expect(list).toHaveLength(2);
  });
});
describe("room-based world transport", () => {
  it("sends initial state, advancing deltas, a fresh reconnect snapshot and isolated subscriptions", async () => {
    const runtime = startServer(0, { policy: null });
    let socket: Socket<ServerEvents, ClientEvents> | undefined;
    try {
      if (!runtime.server.listening) await once(runtime.server, "listening");
      const port = (runtime.server.address() as AddressInfo).port;
      const created = (await (
        await fetch(
          `http://127.0.0.1:${port}/api/simulations`,
          json("POST", { timeScale: 10 }),
        )
      ).json()) as SimulationStatus;
      socket = io(`http://127.0.0.1:${port}`, {
        autoConnect: false,
        transports: ["websocket"],
        reconnection: false,
      });
      const initialPromise = new Promise<WorldSnapshot>((resolve) =>
        socket!.once("world:snapshot", resolve),
      );
      socket.connect();
      const initial = await initialPromise;
      expect(initial.simulation.id).toBe("sim-001");
      const update = await new Promise<{
        simulationId: string;
        state: WorldStateDto;
      }>((resolve) => socket!.once("world:delta", resolve));
      const delta = update.state;
      expect(update.simulationId).toBe("sim-001");
      expect(delta.tick).toBeGreaterThan(initial.state.tick);
      socket.disconnect();
      const reconnected = new Promise<WorldSnapshot>((resolve) =>
        socket!.once("world:snapshot", resolve),
      );
      socket.connect();
      expect((await reconnected).state.tick).toBeGreaterThanOrEqual(delta.tick);
      const subscribed = new Promise<WorldSnapshot>((resolve) =>
        socket!.once("world:snapshot", resolve),
      );
      const result = await new Promise<{ ok: boolean }>((resolve) =>
        socket!.emit("simulation:subscribe", created.id, resolve),
      );
      expect(result.ok).toBe(true);
      expect((await subscribed).simulation.id).toBe(created.id);
      const states: SimulationStatus[] = [];
      socket.on("simulation:state", (s) => states.push(s));
      const current = await new Promise<SimulationStatus>((resolve) =>
        socket!.once("simulation:state", resolve),
      );
      expect(current.id).toBe(created.id);
      const invalid = await new Promise<{ ok: boolean }>((resolve) =>
        socket!.emit("simulation:subscribe", "unknown", resolve),
      );
      expect(invalid.ok).toBe(false);
      expect(states.every((s) => s.id === created.id)).toBe(true);
    } finally {
      socket?.disconnect();
      await runtime.close();
    }
  }, 10000);
});
