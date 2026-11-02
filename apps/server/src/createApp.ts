import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { Server } from "socket.io";
import {
  schedulerSchema,
  simulationSchema,
  speedSchema,
  type ExperimentConfig,
  type ClientEvents,
  type ServerEvents,
} from "../../../packages/shared/src/index.js";
import type { DecisionPolicy } from "./agents/AgentScheduler.js";
import { SimulationStore, type Checkpoint } from "./storage/SimulationStore.js";
import { WorldEngine } from "./world/WorldEngine.js";
import { Simulation } from "./simulation/Simulation.js";

export function createApp(
  options: {
    now?: () => number;
    policy?: DecisionPolicy | null;
    databasePath?: string;
  } = {},
) {
  const now = options.now ?? (() => performance.now());
  const store = new SimulationStore(options.databasePath);
  const simulations = new Map<string, Simulation>();
  let nextId = 1;
  const makeSimulation = (
    timeScale = 1,
    mode: "live" | "experiment" = "live",
    controller: "scripted" | "codex" = "scripted",
    codexAgentIds: string[] = ["alpha"],
    experiment?: ExperimentConfig,
  ) => {
    const simulation = new Simulation(
      `sim-${String(nextId++).padStart(3, "0")}`,
      now(),
      timeScale,
      mode,
      options.policy,
      { controller, codexAgentIds, experiment, store },
    );
    simulations.set(simulation.id, simulation);
    return simulation;
  };
  for (const { run, cycle, definition } of store.recoverableRuns()) {
    const simulation = new Simulation(
      run.id,
      now(),
      run.timeScale,
      run.mode as "live" | "experiment",
      options.policy,
      {
        ...run.configuration,
        store,
        definition,
        restore: {
          checkpoint: JSON.parse(cycle.checkpoint) as Checkpoint,
          cycleIndex: cycle.index,
          cycleStatus: cycle.status,
          status: run.status,
        },
      },
    );
    simulations.set(run.id, simulation);
    nextId = Math.max(nextId, Number(run.id.slice(4)) + 1);
  }
  const initial = simulations.get("sim-001") ?? makeSimulation();
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
    c.json([
      {
        id: "island-48291-v3",
        seed: 48291,
        version: 3,
      },
    ]),
  );
  app.get("/api/simulations", (c) =>
    c.json([...simulations.values()].map((s) => s.status())),
  );
  app.post("/api/simulations", async (c) => {
    const input = simulationSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success) return c.json({ error: "INVALID_CONFIGURATION" }, 400);
    const simulation = makeSimulation(
      input.data.timeScale,
      input.data.schedulerMode,
      input.data.controller,
      input.data.codexAgentIds,
      input.data.experiment,
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
  app.get("/api/simulations/:id/replays", (c) =>
    c.json(
      store.sqlite
        .prepare(
          `SELECT c.id, c."index" AS cycleIndex, c.status,
      MIN(f.tick) AS firstTick, MAX(f.tick) AS lastTick, COUNT(f.sequence) AS frames
      FROM simulation_cycles c JOIN replay_frames f ON f.cycle_id=c.id
      WHERE c.runId=? GROUP BY c.id ORDER BY c."index"`,
        )
        .all(c.req.param("id")),
    ),
  );
  app.get("/api/simulations/:id/replays/:cycleId", (c) => {
    const cycleId = c.req.param("cycleId");
    const cycle = store.sqlite
      .prepare("SELECT id FROM simulation_cycles WHERE id=? AND runId=?")
      .get(cycleId, c.req.param("id"));
    if (!cycle) return c.json({ error: "REPLAY_NOT_FOUND" }, 404);
    const tick = Number(c.req.query("tick") ?? 0);
    if (!Number.isSafeInteger(tick) || tick < 0)
      return c.json({ error: "INVALID_TICK" }, 400);
    const result = store.replay.reconstruct(cycleId, tick);
    if (!result) return c.json({ error: "REPLAY_NOT_RECORDED" }, 404);
    const live = simulations.get(c.req.param("id"))!;
    const engine = new WorldEngine(live.engine.getDefinition());
    engine.restore(result.checkpoint);
    const agentId = c.req.query("agentId");
    const observation = agentId ? engine.observe(agentId) : null;
    if (agentId && !observation)
      return c.json({ error: "AGENT_NOT_FOUND" }, 404);
    const decisions = agentId
      ? store
          .listDecisions(live.id, agentId)
          .filter((d) => d.cycleId === cycleId && d.tick <= tick)
          .map((d) => ({
            ...d,
            outcome:
              d.outcome?.finishedAtTick !== undefined &&
              d.outcome.finishedAtTick > tick
                ? undefined
                : d.outcome,
          }))
      : [];
    const discovered = agentId
      ? store.sqlite
          .prepare(
            "SELECT tick,payload FROM agent_experiences WHERE cycleId=? AND agentId=? AND tick<=? ORDER BY tick,id",
          )
          .all(cycleId, agentId, tick)
          .map((row) => JSON.parse((row as { payload: string }).payload))
          .filter((e) => e.kind === "entity")
          .map((e) => e.entity)
      : [];
    const state = engine.getState();
    if (observation) {
      const entities = new Set(observation.visibleEntities.map((e) => e.id));
      const agents = new Set([
        agentId,
        ...observation.visibleAgents.map((a) => a.id),
      ]);
      state.entities = state.entities.filter((e) => entities.has(e.id));
      state.agents = state.agents.filter((a) => agents.has(a.id));
      state.events = observation.recentEvents;
      state.actions = observation.lastAction ? [observation.lastAction] : [];
    }
    return c.json({
      cycleId,
      tick: result.checkpoint.tick,
      hash: result.hash,
      sequence: result.sequence,
      definition: { ...engine.getDefinition(), entities: state.entities },
      state,
      observation,
      decisions: decisions.slice(-50),
      discovered,
    });
  });
  app.get("/api/simulations/:id/results", (c) =>
    c.json({
      simulation: simulations.get(c.req.param("id"))!.status(),
      cycles: store.metrics(c.req.param("id")),
    }),
  );
  app.get("/api/simulations/:id/timeline", (c) => {
    const cycleId =
      c.req.query("cycleId") ?? simulations.get(c.req.param("id"))!.cycleId;
    const after = Number(c.req.query("after") ?? 0);
    if (!Number.isSafeInteger(after) || after < 0)
      return c.json({ error: "INVALID_CURSOR" }, 400);
    if (
      !store.sqlite
        .prepare("SELECT id FROM simulation_cycles WHERE id=? AND runId=?")
        .get(cycleId, c.req.param("id"))
    )
      return c.json({ error: "CYCLE_NOT_FOUND" }, 404);
    const events = store.timeline(cycleId, after);
    return c.json({
      cycleId,
      events,
      nextCursor: events.at(-1)?.sequence ?? after,
    });
  });
  app.get("/api/simulations/:id/agents", (c) =>
    c.json(simulations.get(c.req.param("id"))!.engine.getState().agents),
  );
  app.get("/api/simulations/:id/agents/:agentId/decisions", (c) => {
    const simulation = simulations.get(c.req.param("id"))!;
    if (!simulation.engine.observe(c.req.param("agentId")))
      return c.json({ error: "AGENT_NOT_FOUND" }, 404);
    const limit =
      c.req.query("limit") === undefined
        ? undefined
        : Number(c.req.query("limit"));
    if (
      limit !== undefined &&
      (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    )
      return c.json({ error: "INVALID_LIMIT" }, 400);
    const all = store.listDecisions(simulation.id, c.req.param("agentId"));
    const decisions = limit === undefined ? all : all.slice(-limit);
    return c.json(
      decisions.map((record) => ({
        ...record,
        outcome:
          record.outcome ??
          (record.cycleId === simulation.cycleId && record.actionId
            ? simulation.engine.getAction(record.actionId)
            : undefined),
      })),
    );
  });
  app.get("/api/simulations/:id/agents/:agentId/memories", (c) => {
    const simulation = simulations.get(c.req.param("id"))!;
    const agentId = c.req.param("agentId");
    if (!simulation.engine.observe(agentId))
      return c.json({ error: "AGENT_NOT_FOUND" }, 404);
    return c.json(
      simulation.memory!.list(agentId, (c.req.query("q") ?? "").slice(0, 500)),
    );
  });
  app.get("/api/simulations/:id/agents/:agentId/memory-context", (c) => {
    const simulation = simulations.get(c.req.param("id"))!;
    const observation = simulation.engine.observe(c.req.param("agentId"));
    return observation
      ? c.json(
          simulation.memory!.context(
            observation.agentId,
            simulation.cycleId,
            observation,
          ),
        )
      : c.json({ error: "AGENT_NOT_FOUND" }, 404);
  });
  app.post("/api/simulations/:id/reset", async (c) => {
    const simulation = simulations.get(c.req.param("id"))!;
    if (simulation.status().status === "stopped")
      return c.json({ error: "SIMULATION_STOPPED" }, 409);
    try {
      await simulation.reset();
    } catch {
      return c.json(
        { error: "RESET_FAILED", detail: simulation.cycleError },
        500,
      );
    }
    onChange(simulation);
    return c.json(simulation.snapshot());
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
      else {
        if (operation === "resume" && simulation.cycleStatus === "closing")
          await simulation.reset();
        simulation.clock[operation]();
        simulation.persist();
      }
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
    simulation.persist();
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
    simulation.persist();
    onChange(simulation);
    return c.json(simulation.status());
  });
  app.post("/api/simulations/:id/agents/:agentId/actions", async (c) => {
    const input = await c.req.json().catch(() => null);
    const simulation = simulations.get(c.req.param("id"))!;
    if (simulation.cycleStatus === "closing")
      return c.json({ accepted: false, error: "CYCLE_CLOSING" }, 409);
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
    get engine() {
      return initial.engine;
    },
    store,
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
    shutdown: async () => {
      // Preserve run lifecycle on clean server shutdown; pending model turns are cancelled.
      for (const s of simulations.values()) {
        await s.shutdown();
      }
      store.close();
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
    await runtime.shutdown();
    await new Promise<void>((resolve) => io.close(() => resolve()));
  };
  return {
    ...runtime,
    get engine() {
      return runtime.engine;
    },
    server,
    io,
    close,
  };
}
