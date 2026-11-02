# Agent Island

A local-first simulation platform in TypeScript. Milestone 6 adds bounded multi-cycle experiments, three autonomous Codex agents, durable usage accounting, and cycle comparisons. Exact historical replay, agent POV, a Decision Inspector, and a discovery map are included. Durable memory, crash recovery, and recurring cycles are included. Real Codex agents use an identity-bound MCP runtime. The foundation provides a deterministic 3D island with three scripted agents, an adjustable simulation clock, navigation, and shared object interactions. Hono and the World Engine manage the world; Socket.IO sends state to the Vite/Three.js viewer. Codex is optional; the default run uses scripted agents.

## Running locally

Requirements: Node.js 22.12+ and npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. The backend listens on **http://127.0.0.1:3001**. Stop both processes with Ctrl+C. No API keys or external services are required.

- Drag to rotate the camera; scroll to zoom. Click Alpha, Beta, or Gamma to focus the camera on that agent.
- Pause/resume the clock, select 1×/2×/5×/10×/20×, and switch between Live and Experiment.
- Each cycle lasts 72,000 ticks (one virtual hour). **Reset cycle** (**Cyclus resetten**) restores the initial world and preserves each agent's own memory. The **Memory** (**Geheugen**) tab shows sources, confidence, importance, revisions, and text search results for each agent.
- Stopping a run is permanent; **New run** (**Nieuwe run**) creates an independent experiment. The run selector switches the live connection to the correct Socket.IO room.
- View the selected agent's observation or cancel its action. A scripted agent chooses another action on the next tick.
- The timeline shows recent results, greetings, and errors; inventories and carried objects reflect server state.
- Open **Replay**, choose a cycle, and drag the timeline or play at 1×–20×. Choose **Alpha/Beta/Gamma POV** to see that agent's historical view, discovered object locations, and recorded decisions. Live simulation controls are disabled while viewing history; the run continues independently.
- Portable artifacts now include glowing crystals, golden shells, and ancient relics, with distinct shapes, colors, and ground rings. Three are placed near the starting area. Agents can pick up, carry, drop, inspect, or activate them. Agents greet visible neighbors within 10 m once per encounter; separating beyond 15 m allows another greeting.

## Starting a real Codex agent

Make sure the Codex CLI is available and `codex login` has been completed. Select **3 autonome Codex-agents** under **Nieuwe run met** in the dashboard for three independent agents, or **Codex Alpha + 2 scripted** for a mixed run. Set the number of cycles and the decision budget per agent per cycle before creating the run. Each Codex agent gets its own thread, filtered observations, and world actions through a restricted MCP session. Model status and public decisions are visible in the dashboard.

The live acceptance test ran for 15 minutes of simulation time, with 13 model decisions and 10 successful moves. Details and a repeatable test command are available in the [Codex runtime guide](docs/codex-runtime.md) and the [milestone 3 acceptance report](docs/sprint-3-acceptance.md).

## Multi-agent experiments

New dashboard runs default to **2 cycles** and **120 decision attempts per agent per cycle**. Each cycle retains the same world definition and seed, lasts 72,000 ticks, and starts fresh agent threads with each agent's own consolidated memory. The final cycle is consolidated and retained for replay, then the experiment stops without creating another cycle. Manual reset also closes and counts a cycle; the stored outcome distinguishes it from a full-duration cycle.

Budget checks happen before starting a decision. Failed and cancelled attempts consume budget; fallback waits do not start additional model calls. An already started final decision may finish. Exhausted agents stop deciding while the world and other agents continue, allowing the experiment to reach its cycle boundary unattended. Budgets survive server recovery. Runs created without `experiment` in the API keep their existing unlimited cycle lifecycle.

The **Experiment** tab compares unique observed objects, objects seen in earlier cycles by the same agent, 25 m observation cells sampled at decisions, explicit delivered messages, successfully shared object interactions, decision/tool counts, errors, cancellations, and decision wall time. Successful moves to a supplied earlier memory target are recorded as evidence of memory use, not as proof of model reasoning. Location checks compare a retrieved memory's source observation with a newly visible object (10 cm tolerance); unverified claims remain unknown and moved objects may contradict old locations. Automatic greetings are separate from explicit cooperation. Token costs are not available; usage is measured in attempts, tool calls, and time.

**Timeline** reads the durable, paginated event history per cycle. **Memory** and **Replay** retain their agent isolation and historical views. Communication requires a visible recipient within 25 m and the 120° view cone, with occlusion checks. Delivered message text and recipient are recorded; only sender and recipient get the speech event in their observations. The human timeline can inspect all speech. Shared object ownership continues to be validated atomically by the World Engine.

```sh
npm run verify:experiment
```

This optional black-box test uses the existing Codex login, runs three real agents through the full first cycle and stops after all three demonstrate memory use after the automatic reset, at requested 20× speed, and permits at most **48 model decision attempts** (8 per agent per cycle). It writes `docs/sprint-6-live-result.json` and exits unsuccessfully if the first full cycle, fresh threads, successful decisions, or demonstrated memory-target movement by any agent are missing. Completion of two full cycles and terminal experiment stopping are covered by the deterministic suite. Stop with Ctrl+C. The deterministic test suite also runs two full cycles without model costs. See [milestone 6 acceptance](docs/sprint-6-acceptance.md).

## Checking and building

```sh
npm run typecheck
npm test
npm run build
```

`npm run format` formats TypeScript, CSS, HTML, and configuration files. The client build is in `apps/client/dist`. The server build includes the shared contracts and starts with `npm start -w @agent-island/server`. `npm run preview -w @agent-island/client` serves the client build with the same local backend proxy. This is a local development setup, not a hosting configuration.

## Project structure

- `apps/client`: dashboard, Three.js rendering, interpolation, and camera.
- `apps/server/src/world`: world generator, authoritative engine, navmesh/A*, and perception.
- `apps/server/src/simulation`: fixed virtual clock and separate simulation runs.
- `apps/server/src/agents`: cancellable scheduler, scripted policy, CodexAdapter, and decision journal.
- `apps/server/src/storage`: SQLite + Drizzle schema, automatic migrations, and transactional checkpoints.
- `apps/server/src/memory`: agent-specific consolidation, FTS, source claims, and context selection.
- `packages/world-mcp`: validated world tools through MCP InMemoryTransport.
- `packages/shared`: typed contracts, Zod schemas, and heightmap sampling.
- [TODO.md](TODO.md): six milestones, tasks, and acceptance criteria.
- [Design v1.0](docs/architecture-v1.md), [milestone 1 acceptance](docs/sprint-1-acceptance.md), and [milestone 2 acceptance](docs/sprint-2-acceptance.md).

## Clock and decisions

Each tick represents 50 ms of virtual time. The server processes movement at 3 m/s, actions, and wait durations exclusively in virtual time. Wall time is measured separately. Paused time does not create catch-up work; a speed change takes effect from the moment it is made.

The clock processes at most 100 ticks per pump and retains at most 5 seconds of virtual backlog. Excess backlog is discarded and reported as `droppedSimulationTimeMs`. Virtual ticks themselves are never skipped: the world slows down under overload. The dashboard shows the remaining backlog and unprocessed virtual time.

In **Live** mode, the world keeps running while agents decide. In **Experiment** mode, a tick waits until all decisions required at that point are ready. They are then submitted in agent-ID order. Time spent waiting at a decision barrier is not caught up later. Each agent can have at most one decision in progress. A failed decision, or one exceeding its configured deadline (10 s for scripted policies, 60 s for the Codex adapter), falls back to a short virtual wait action. Stopping or changing the decision mode invalidates any older results that arrive later.

## World, navigation, and interactions

Generator v3 retains seed `48291`, a 500 × 500 m heightmap with 81 × 81 samples, 120 trees, 80 rocks, 12 artifacts, and one cave. Version 3 adds named portable artifact kinds and nearby pickups, keeping the three spawn corridors clear. Existing stored worlds retain their original definition; create a new run for the new artifacts. The same version and configuration produce the same definition. Runtime state and outgoing snapshots are independent copies.

Navigation uses a triangular navmesh derived from the terrain. A* searches across triangle centers; edges and simplified path segments are checked for water, excessively steep slopes, and objects with clearance for the agent. Each movement step also checks current objects and other agents. Picking up or dropping an object invalidates the obstacle index. A route that remains blocked for 5 virtual seconds ends with `PATH_BLOCKED`; the scripted policy then chooses again. This is simple kinematic collision detection, without rigid-body physics or cooperative path planning.

Every action receives an ID and follows the status sequence `queued → running → succeeded/failed/cancelled`. Each agent can have one pending action. At the start of a tick, conflicts are resolved in agent-ID order, regardless of request arrival order. Distance, availability, visibility, and ownership are checked again at execution time.

Supported actions: `move`, `look`, `wait`, `inspect`, `interact` (activate an artifact), `pickup` (a portable artifact or movable rock), and `drop`. An agent carries at most one object. Dropped objects cannot overlap another object or agent. Target elevation is always calculated from the terrain by the server.

Perception uses a horizontal range of 25 m, a 120° field of view, and 2D occlusion by trees, rocks, and the cave. Interaction range is 3 m from an object's boundary. Agents always know their own inventory. Each event's audience is determined when it occurs; later observations do not grant access to global history. The human viewer sees the entire world, while agent observations remain limited. Terrain hills do not yet block visibility in this version.

## API

The default run is `sim-001`. The server stores at most 8 runs in `apps/server/data/agent-island.sqlite` when using `npm run dev` or `npm start -w @agent-island/server`. Set `AGENT_ISLAND_DB` to an absolute path to use another database. Migrations are applied automatically; `npm run db:generate -w @agent-island/server` generates future schema migrations. The `createApp()` test factory uses an independent in-memory SQLite database by default.

After a restart, existing runs are restored in a paused state, including positions, object ownership, routes, wait durations, actions, decisions, and memory. Click **Resume** (**Hervatten**) to continue. A run that was already stopped remains stopped. Interrupted model decisions are cancelled; Codex starts with a new thread and the agent's own memory. A crash during cycle closing leaves that cycle blocked for actions; resuming or resetting retries the transactional closing procedure.

Perception-based consolidation is deterministic and makes no additional model call: visible objects produce semantic location claims, an agent's own action results produce episodic memories, successful moves produce procedural route hypotheses, and received messages produce reported claims. Duplicate claims share sources and revisions; new direct location observations supersede older claims, while other contradictions remain marked. Context contains a bounded summary, relevant memories belonging to the agent, recent experiences, and goals. Model-generated summaries are future work. See the [milestone 4 acceptance report](docs/sprint-4-acceptance.md).

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Server status |
| GET | `/api/world` | Default run snapshot; compatibility alias |
| GET | `/api/worlds` | Available world |
| GET / POST | `/api/simulations` | List runs / create a new run |
| GET | `/api/simulations/:id` | Clock and status |
| GET | `/api/simulations/:id/world` | World definition, runtime state, and status |
| GET | `/api/simulations/:id/agents` | Agents |
| GET | `/api/simulations/:id/replays` | Recorded cycles and available tick ranges |
| GET | `/api/simulations/:id/replays/:cycleId?tick=1200&agentId=alpha` | Verified historical state, optional agent POV, decisions, and discovered objects |
| GET | `/api/simulations/:id/results` | Experiment progress and per-agent metrics for every cycle |
| GET | `/api/simulations/:id/timeline?cycleId=...&after=0` | Up to 200 durable events after a sequence cursor, scoped to the run |
| POST | `/api/simulations/:id/pause`, `/resume`, `/stop` | Control a run |
| PATCH | `/api/simulations/:id/speed` | `{ "timeScale": 1/2/5/10/20 }` |
| PATCH | `/api/simulations/:id/mode` | `{ "schedulerMode": "live"/"experiment" }` |
| POST | `/api/simulations/:id/reset` | Close the cycle, consolidate memory, and restore the initial world |
| GET | `/api/simulations/:id/agents/:agentId/memories?q=cave` | The agent's active memories, optionally searched with FTS |
| GET | `/api/simulations/:id/agents/:agentId/memory-context` | Summary, relevant memories, recent experiences, and goals |
| GET | `/api/simulations/:id/agents/:agentId/decisions` | Durable decisions across all cycles, including outcomes |
| GET | `/api/simulations/:id/agents/:agentId/observation` | Limited current observation |
| POST | `/api/simulations/:id/agents/:agentId/actions` | Submit a Zod-validated action |
| GET | `/api/simulations/:id/actions/:actionId` | Action result |
| POST | `/api/simulations/:id/agents/:agentId/actions/:actionId/cancel` | Cancel a pending action |

A new run optionally accepts `worldId: "island-48291-v3"` (the legacy `"island-48291"` value remains accepted as an alias), `timeScale`, `schedulerMode`, `controller: "scripted"/"codex"`, and `codexAgentIds` (default: `["alpha"]`). Pass `codexAgentIds: ["alpha", "beta", "gamma"]` for three Codex agents and `experiment: { "maxCycles": 2, "decisionBudgetPerAgentPerCycle": 120 }` to bound the experiment (1–100 cycles, 1–10,000 attempts per agent per cycle). An accepted action returns HTTP 202 with `{ accepted: true, actionId }`; invalid input returns 400, unknown resources return 404, and conflicts return 409. The action ID provides access to the eventual outcome. This is a local research API for the human operator; model agents only receive the internal identity-bound MCP session. Model decisions can be read through `GET /api/simulations/:id/agents/:agentId/decisions`.

Socket.IO sends `world:snapshot` on connection, reconnection, and subscription. `simulation:subscribe(id, ack)` switches rooms. `world:delta` contains `{ simulationId, state }`, and `simulation:state` contains clock status. Both are sent at most 10 times per real second, regardless of acceleration. Control changes also trigger an immediate status event. The viewer interpolates between positions. In this version, a delta contains the complete current entity list and bounded recent actions/events; further delta compression is future work.

The engine retains at most 512 action records (pending actions are preserved), 200 recent global events, and 100 observed events per agent. Network state contains at most 60 recent actions and 40 recent events. These limits apply only to the real-time view; SQLite stores the full event history, decisions, and initial/final checkpoints. Historical replay is available through the Replay tab and API.

Technical references: [Hono Node adapter](https://hono.dev/docs/getting-started/nodejs), [Socket.IO rooms](https://socket.io/docs/v4/rooms/), [Zod](https://zod.dev/basics), [Vite](https://vite.dev/guide/).

Replay records every committed world change in a separate append-only SQLite log, with a strictly increasing per-cycle sequence. Records contain full checkpoints initially and every 1,200 ticks, and replacement patches for changed checkpoint fields between them. Existing initial/final cycle snapshots are retained. Each record includes generator, navigation, physics, and format versions and a SHA-256 hash. Reconstruction uses recorded values without model calls or movement integration. Canonical hashing sorts object keys, preserves array order, omits undefined fields, and preserves exact JSON numeric precision. Seeking a tick returns its latest committed state, including actions submitted at that tick. Historical POV uses restored perception and event audiences, while the discovery map accumulates that agent's observed object positions. Older runs have replay only from the first capture after upgrading; unavailable earlier history is not fabricated. See the [milestone 5 acceptance report](docs/sprint-5-acceptance.md).
