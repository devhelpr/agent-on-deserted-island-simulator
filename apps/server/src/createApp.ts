import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Server } from "socket.io";
import {
  schedulerSchema,
  simulationSchema,
  speedSchema,
  type ClientEvents,
  type ServerEvents,
} from "../../../packages/shared/src/index.js";
import type { DecisionPolicy } from "./agents/AgentScheduler.js";
import { Simulation } from "./simulation/Simulation.js";

export function createApp(
  options: { now?: () => number; policy?: DecisionPolicy | null } = {},
) {
  const now = options.now ?? (() => performance.now());
  const simulations = new Map<string, Simulation>();
  let nextId = 1;
  const makeSimulation = (
    timeScale = 1,
    mode: "live" | "experiment" = "live",
    controller: "scripted" | "codex" = "scripted",
    codexAgentIds: string[] = ["alpha"],
  ) => {
    const simulation = new Simulation(
      `sim-${String(nextId++).padStart(3, "0")}`,
      now(),
      timeScale,
      mode,
      options.policy,
      { controller, codexAgentIds },
    );
    simulations.set(simulation.id, simulation);
    return simulation;
  };
  const initial = makeSimulation();
  let onChange = (simulation: Simulation) => {};
  const app = new Hono();
  app.use("/api/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("Origin");
      if (origin) {
        try {
          if (
            !["127.0.0.1", "localhost", "[::1]"].includes(
              new URL(origin).hostname,
            )
          )
            return c.json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
        } catch {
          return c.json({ error: "ORIGIN_NOT_ALLOWED" }, 403);
        }
      }
    }
    return next();
  });
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/api/world", (c) => c.json(initial.snapshot()));
  app.get("/api/worlds", (c) =>
    c.json([{ id: "island-48291", seed: 48291, version: 2 }]),
  );
  app.get("/api/simulations", (c) =>
    c.json([...simulations.values()].map((s) => s.status())),
  );
  app.post("/api/simulations", async (c) => {
    const input = simulationSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return c.json({ error: "INVALID_CONFIGURATION" }, 400);
    if (simulations.size >= 8)
      return c.json(
        {
          error: "SIMULATION_LIMIT",
          message:
            "Maximaal 8 runs per serverproces; herstart om deze te wissen.",
        },
        409,
      );
    const simulation = makeSimulation(
      input.data.timeScale,
      input.data.schedulerMode,
      input.data.controller,
      input.data.codexAgentIds,
    );
    return c.json(simulation.status(), 201);
  });
  app.use("/api/simulations/:id/*", async (c, next) => {
    if (!simulations.has(c.req.param("id")!))
      return c.json({ error: "SIMULATION_NOT_FOUND" }, 404);
    return next();
  });
  app.get("/api/simulations/:id", (c) => {
    const simulation = simulations.get(c.req.param("id"));
    return simulation
      ? c.json(simulation.status())
      : c.json({ error: "SIMULATION_NOT_FOUND" }, 404);
  });
  app.get("/api/simulations/:id/world", (c) =>
    c.json(simulations.get(c.req.param("id"))!.snapshot()),
  );
  app.get("/api/simulations/:id/agents", (c) =>
    c.json(simulations.get(c.req.param("id"))!.engine.getState().agents),
  );
  app.get("/api/simulations/:id/agents/:agentId/decisions", (c) => {
    const simulation = simulations.get(c.req.param("id"))!;
    if (!simulation.engine.observe(c.req.param("agentId")))
      return c.json({ error: "AGENT_NOT_FOUND" }, 404);
    const decisions =
      simulation.codex?.journal.list(c.req.param("agentId")) ?? [];
    return c.json(
      decisions.map((record) => ({
        ...record,
        outcome: record.actionId
          ? simulation.engine.getAction(record.actionId)
          : undefined,
      })),
    );
  });
  app.get("/api/simulations/:id/agents/:agentId/observation", (c) => {
    const observation = simulations
      .get(c.req.param("id"))!
      .engine.observe(c.req.param("agentId"));
    return observation
      ? c.json(observation)
      : c.json({ error: "AGENT_NOT_FOUND" }, 404);
  });
  for (const operation of ["pause", "resume", "stop"] as const)
    app.post(`/api/simulations/:id/${operation}`, async (c) => {
      const simulation = simulations.get(c.req.param("id")!)!;
      simulation.advance(now());
      if (simulation.status().status === "stopped" && operation !== "stop")
        return c.json({ error: "SIMULATION_STOPPED" }, 409);
      if (operation === "stop") await simulation.stop();
      else simulation.clock[operation]();
      onChange(simulation);
      return c.json(simulation.status());
    });
  app.patch("/api/simulations/:id/speed", async (c) => {
    const parsed = speedSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "INVALID_SPEED" }, 400);
    const simulation = simulations.get(c.req.param("id"))!;
    simulation.advance(now());
    if (simulation.status().status === "stopped")
      return c.json({ error: "SIMULATION_STOPPED" }, 409);
    simulation.clock.setSpeed(parsed.data.timeScale);
    onChange(simulation);
    return c.json(simulation.status());
  });
  app.patch("/api/simulations/:id/mode", async (c) => {
    const parsed = schedulerSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!parsed.success) return c.json({ error: "INVALID_MODE" }, 400);
    const simulation = simulations.get(c.req.param("id"))!;
    simulation.advance(now());
    if (simulation.status().status === "stopped")
      return c.json({ error: "SIMULATION_STOPPED" }, 409);
    simulation.scheduler?.cancel();
    simulation.clock.setSchedulerMode(parsed.data.schedulerMode);
    onChange(simulation);
    return c.json(simulation.status());
  });
  app.post("/api/simulations/:id/agents/:agentId/actions", async (c) => {
    const input = await c.req.json().catch(() => null);
    const simulation = simulations.get(c.req.param("id"))!;
    if (simulation.status().status !== "running")
      return c.json({ error: "SIMULATION_NOT_RUNNING" }, 409);
    const result = simulation.engine.submitAction(
      c.req.param("agentId"),
      input,
    );
    return c.json(
      result,
      result.accepted
        ? 202
        : result.error === "INVALID_ACTION"
          ? 400
          : result.error === "AGENT_NOT_FOUND"
            ? 404
            : 409,
    );
  });
  app.get("/api/simulations/:id/actions/:actionId", (c) => {
    const action = simulations
      .get(c.req.param("id"))!
      .engine.getAction(c.req.param("actionId"));
    return action ? c.json(action) : c.json({ error: "ACTION_NOT_FOUND" }, 404);
  });
  app.post(
    "/api/simulations/:id/agents/:agentId/actions/:actionId/cancel",
    (c) => {
      const ok = simulations
        .get(c.req.param("id"))!
        .engine.cancelAction(c.req.param("agentId"), c.req.param("actionId"));
      return ok
        ? c.json({ cancelled: true })
        : c.json({ error: "ACTION_NOT_CANCELLABLE" }, 409);
    },
  );
  return {
    app,
    engine: initial.engine,
    simulations,
    advance: (time = now()) => {
      for (const s of simulations.values()) s.advance(time);
    },
    setOnChange: (listener: typeof onChange) => {
      onChange = listener;
    },
    stop: async () => {
      await Promise.all([...simulations.values()].map((s) => s.stop()));
    },
  };
}
export function startServer(
  port = 3001,
  options: Parameters<typeof createApp>[0] = {},
) {
  const runtime = createApp(options);
  const server = serve({
    fetch: runtime.app.fetch,
    port,
    hostname: "127.0.0.1",
  });
  const io = new Server<ClientEvents, ServerEvents>(server);
  const room = (id: string) => `simulation:${id}`;
  runtime.setOnChange((s) =>
    io.to(room(s.id)).emit("simulation:state", s.status()),
  );
  io.on("connection", (socket) => {
    const subscribe = (id: unknown) => {
      if (typeof id !== "string" || !runtime.simulations.has(id))
        return { ok: false, error: "SIMULATION_NOT_FOUND" };
      for (const existing of socket.rooms)
        if (existing.startsWith("simulation:")) void socket.leave(existing);
      void socket.join(room(id));
      socket.emit("world:snapshot", runtime.simulations.get(id)!.snapshot());
      return { ok: true };
    };
    subscribe(socket.handshake.query.simulationId ?? "sim-001");
    socket.on("simulation:subscribe", (id, ack) => {
      const result = subscribe(id);
      if (typeof ack === "function") ack(result);
    });
  });
  const simulation = setInterval(() => runtime.advance(), 10);
  const network = setInterval(() => {
    for (const s of runtime.simulations.values()) {
      io.to(room(s.id)).emit("world:delta", {
        simulationId: s.id,
        state: s.engine.getState(),
      });
      io.to(room(s.id)).emit("simulation:state", s.status());
    }
  }, 100);
  const close = async () => {
    clearInterval(simulation);
    clearInterval(network);
    await runtime.stop();
    await new Promise<void>((resolve) => io.close(() => resolve()));
  };
  return { ...runtime, server, io, close };
}
