import { io, type Socket } from "socket.io-client";
import type {
  AgentMemory,
  MemoryContext,
  ClientEvents,
  ServerEvents,
  SimulationStatus,
  WorldStateDto,
} from "../../../packages/shared/src/index.js";
import { IslandScene } from "./world/IslandScene";
import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
<header class="topbar"><a class="brand" href="/" aria-label="Agent Island home"><span class="brandmark">△</span><span>AGENT ISLAND<small>LOCAL SIMULATION LAB</small></span></a><div class="connection"><span class="dot" id="connection-dot"></span><span id="connection" role="status">Verbinden…</span></div><span class="sprint">FASE 04 <span>/</span> GEHEUGEN & CYCLI</span></header>
<main><section class="workspace"><div class="workspace-heading"><div><p class="eyebrow">EXPERIMENT · SEED <span id="seed">—</span></p><h1>Samen op onbekend terrein.</h1><p class="intro">Drie verkenners. Eén gedeeld eiland. Elke actie telt.</p></div><span class="local-badge">LOCAL FIRST ↗</span></div>
<div class="simulation-controls" aria-label="Simulatiebeheer"><label>Run<select id="run-select"><option value="sim-001">sim-001</option></select></label><button id="pause" type="button" disabled>Pauzeren</button><label>Snelheid<select id="speed"><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option><option value="20">20×</option></select></label><label>Besluitvorming<select id="mode"><option value="live">Live</option><option value="experiment">Experiment</option></select></label><button id="reset-cycle" type="button" disabled>Cyclus resetten</button><button id="stop" type="button" disabled>Stoppen</button><label>Nieuwe run met<select id="controller"><option value="scripted">Scripted agents</option><option value="codex">Codex Alpha + 2 scripted</option></select></label><button id="new-run" type="button">Nieuwe run</button><span id="simulation-status" role="status">Verbinden…</span></div><p id="control-error" role="alert" hidden></p><p id="runtime-status" class="runtime-status" role="status"></p>
<div class="viewport-wrap"><div id="viewport"></div><div class="viewport-top"><span class="view-label"><span class="dot live"></span> LIVE WORLD</span><span class="view-label subtle">FREE CAMERA</span></div><div id="scene-error" role="alert" hidden></div><div class="compass" aria-hidden="true">N<br><span>↑</span></div><div class="viewport-bottom"><span>Sleep om te draaien · Scroll om te zoomen</span><button id="reset-camera" type="button">↺ Overzicht</button></div></div>
<div class="metrics"><div><span>WERELDTIJD</span><strong id="world-time">00:00</strong></div><div><span>SIMULATIETICK</span><strong id="tick">0</strong></div><div><span>EILAND</span><strong id="size">—</strong></div><div><span>OBJECTEN</span><strong id="entity-count">—</strong></div></div>
<nav class="data-tabs" aria-label="Agentgegevens"><button id="live-tab" type="button" aria-pressed="true">Live & beslissingen</button><button id="memory-tab" type="button" aria-pressed="false">Geheugen</button></nav>
<section id="memory-panel" hidden aria-label="Agentgeheugen"><div class="memory-heading"><h2 id="memory-agent">Geheugen · Alpha</h2><span id="memory-cycle"></span></div><form id="memory-search"><label>Doorzoek herinneringen<input id="memory-query" type="search" maxlength="500" placeholder="Bijvoorbeeld cave of rock" /></label><button type="submit">Zoeken</button><button id="memory-refresh" type="button">Vernieuwen</button></form><p id="memory-summary"></p><p id="memory-goals"></p><ol id="memory-list"></ol></section>
<div id="live-panel"><div class="timeline"><p class="eyebrow">RECENTE ACTIES</p><ol id="events"><li>Wachten op de eerste actie…</li></ol></div><div class="timeline"><p class="eyebrow">VASTGELEGDE BESLISSINGEN</p><ol id="decision-list"><li>Kies een agent en bekijk diens beslissingen.</li></ol></div></div>
</section><aside><div class="panel-heading"><p class="eyebrow">IN HET VELD</p><h2>De verkenners<span>03</span></h2></div><div id="agents"></div>
<div class="agent-tools"><button id="cancel-action" type="button" disabled>Actie annuleren</button><button id="observe" type="button" disabled>Waarneming bekijken</button><button id="decisions" type="button" disabled>Beslissingen bekijken</button><p id="observation" aria-live="polite">Selecteer een verkenner om de camera te richten.</p></div>
<div class="route-note"><span class="note-icon">⌁</span><div><h3>Een gedeelde wereld</h3><p>Agents zoeken een pad, onderzoeken objecten en proberen stenen op te pakken. Eén object kan maar één eigenaar hebben.</p></div></div>
<div class="legend"><p class="eyebrow">OP HET EILAND</p><div><i class="legend-tree"></i><span>Bomen</span><b id="trees">—</b></div><div><i class="legend-rock"></i><span>Rotsen</span><b id="rocks">—</b></div><div><i class="legend-artifact"></i><span>Artefacten</span><b id="artifacts">—</b></div><div><i class="legend-cave"></i><span>Grot</span><b id="caves">—</b></div></div>
<div class="next"><p class="eyebrow">VOLGENDE MIJLPAAL</p><h3>De wereld terugspoelen.</h3><p>Sprint 05 voegt replay, een tijdlijn en historische wereldtoestanden toe.</p><span>05 / 06 <span>→</span></span></div></aside></main><footer><span>AGENT ISLAND <span class="footer-divider">/</span> Deterministische wereld · Generator v2</span><span id="clock-details">20 ticks/s virtueel · maximaal 10 updates/s</span></footer>`;
const el = (id: string) => document.getElementById(id)!;
let scene: IslandScene | undefined;
try {
  scene = new IslandScene(el("viewport"));
} catch {
  const error = el("scene-error");
  error.hidden = false;
  error.textContent =
    "De 3D-viewer kon niet starten. Controleer of WebGL beschikbaar is in je browser.";
}
let simulationId = "sim-001";
let selectedAgent = "alpha";
let status: SimulationStatus | undefined;
let state: WorldStateDto | undefined;
let busy = false;
const socket: Socket<ServerEvents, ClientEvents> = io({
  query: { simulationId },
});
const button = (id: string) => el(id) as HTMLButtonElement;
const select = (id: string) => el(id) as HTMLSelectElement;
function error(message = "") {
  el("control-error").textContent = message;
  el("control-error").hidden = !message;
}
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Verzoek mislukt");
  return data;
}
function refreshControls() {
  const connected = socket.connected && !!status;
  const stopped = status?.status === "stopped";
  for (const id of [
    "pause",
    "reset-cycle",
    "stop",
    "speed",
    "mode",
    "cancel-action",
    "observe",
    "decisions",
  ])
    (el(id) as HTMLButtonElement).disabled = busy || !connected || !!stopped;
  button("new-run").disabled = busy || !socket.connected;
  select("controller").disabled = busy || !socket.connected;
  button("decisions").disabled = busy || !connected;
  select("run-select").disabled = busy || !socket.connected;
  button("pause").textContent =
    status?.status === "paused" ? "Hervatten" : "Pauzeren";
  button("cancel-action").disabled =
    busy ||
    !connected ||
    !!stopped ||
    !state?.agents.find((a) => a.id === selectedAgent)?.activeActionId;
}
function updateStatus(next: SimulationStatus) {
  if (next.id !== simulationId) return;
  const changedCycle = status?.cycleId !== next.cycleId;
  status = next;
  el("memory-cycle").textContent =
    `Cyclus ${next.cycleIndex ?? 1} · ${next.cycleStatus === "closing" ? "Wordt afgesloten" : "Actief"}`;
  if (changedCycle && !el("memory-panel").hidden)
    void loadMemory().catch((e) => error(String(e)));
  const codex = (next.agentSessions ?? []).filter(
    (session) => session.controller === "codex",
  );
  el("runtime-status").textContent = codex.length
    ? codex
        .map(
          (session) =>
            `${session.agentId}: Codex · ${session.status === "thinking" ? "Denkt na" : session.status === "failed" ? "Fout: " + session.lastError : "Klaar"} · ${session.decisions} besluiten${session.threadId ? " · thread " + session.threadId.slice(0, 8) : ""}`,
        )
        .join(" / ")
    : "Scripted agents · geen modelaanroepen";
  select("speed").value = String(next.timeScale);
  select("mode").value = next.schedulerMode;
  el("simulation-status").textContent =
    next.cycleStatus === "closing"
      ? next.cycleError
        ? "Reset mislukt · probeer opnieuw: " + next.cycleError
        : "Cyclus afsluiten…"
      : next.status === "paused"
        ? "Gepauzeerd"
        : next.status === "stopped"
          ? "Gestopt"
          : next.waitingForDecisions
            ? "Wachten op beslissingen…"
            : "Actief";
  el("clock-details").textContent =
    `Cyclus ${next.cycleIndex ?? 1} · ${next.timeScale}× · ${next.schedulerMode === "live" ? "Live" : "Experiment"} · achterstand ${Math.round(next.backlogMs)} ms · overgeslagen ${Math.round(next.droppedSimulationTimeMs)} ms`;
  refreshControls();
}
function update(next: WorldStateDto) {
  state = next;
  scene?.update(next);
  const seconds = Math.floor(next.simulationTimeMs / 1000);
  el("world-time").textContent = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  el("tick").textContent = next.tick.toLocaleString("nl-NL");
  const labels = {
    idle: "Klaar voor een besluit",
    queued: "Actie in wachtrij",
    moving: "Onderweg",
    waiting: "Wachten",
  };
  for (const agent of next.agents) {
    let card = document.getElementById(
      `agent-${agent.id}`,
    ) as HTMLButtonElement | null;
    if (!card) {
      card = document.createElement("button");
      card.type = "button";
      card.id = `agent-${agent.id}`;
      card.className = `agent-card agent-${agent.id}`;
      card.innerHTML = `<div class="agent-title"><span class="avatar"></span><span><strong></strong><small>Scripted testagent</small></span><span class="agent-arrow">↗</span></div><div class="agent-status"></div><div class="coordinates"><span>POSITIE · X / Y / Z</span><code></code></div><div class="agent-footer"></div>`;
      card.querySelector("strong")!.textContent = agent.name;
      card.querySelector(".avatar")!.textContent = agent.name[0]!;
      const id = agent.id;
      card.addEventListener("click", () => {
        selectedAgent = id;
        if (!el("memory-panel").hidden)
          void loadMemory().catch((e) => error(String(e)));
        scene?.focusAgent(id);
        el("observation").textContent =
          `${agent.name} geselecteerd. Bekijk de actuele waarneming of annuleer de lopende actie.`;
        refreshControls();
      });
      el("agents").append(card);
    }
    card.querySelector("small")!.textContent =
      agent.controller === "codex" ? "Codex-agent" : "Scripted testagent";
    card.disabled = !scene;
    card.setAttribute("aria-pressed", String(selectedAgent === agent.id));
    card.querySelector(".agent-status")!.textContent = labels[agent.status];
    card.querySelector("code")!.textContent = [
      agent.position.x,
      agent.position.y,
      agent.position.z,
    ]
      .map((n) => n.toFixed(1))
      .join(" / ");
    card.querySelector(".agent-footer")!.textContent = agent.inventory.length
      ? `Draagt ${agent.inventory.join(", ")}`
      : "Inventaris leeg · Bekijk van dichtbij ↗";
  }
  const list = el("events");
  const events = next.events.slice(-8).reverse();
  list.replaceChildren();
  for (const event of events) {
    const li = document.createElement("li");
    li.textContent = `${event.tick} · ${event.message}`;
    li.className = event.type.endsWith("failed") ? "event-failed" : "";
    list.append(li);
  }
  refreshControls();
}
async function control(operation: () => Promise<void>) {
  busy = true;
  error();
  refreshControls();
  try {
    await operation();
  } catch (e) {
    error(e instanceof Error ? e.message : "Verzoek mislukt");
  } finally {
    busy = false;
    refreshControls();
  }
}
async function loadRuns() {
  const runs = (await request("/simulations")) as SimulationStatus[];
  if (!runs.some((run) => run.id === simulationId) && runs[0]) {
    await subscribe(runs[0].id);
  }
  select("run-select").replaceChildren();
  for (const run of runs) {
    const option = document.createElement("option");
    option.value = run.id;
    option.textContent = run.id;
    select("run-select").append(option);
  }
  select("run-select").value = simulationId;
}
function subscribe(id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    simulationId = id;
    status = undefined;
    state = undefined;
    el("agents").replaceChildren();
    el("memory-list").replaceChildren();
    el("memory-summary").textContent = "";
    el("memory-goals").textContent = "";
    el("decision-list").replaceChildren();
    // Update reconnect subscription as well as the current socket room.
    socket.io.opts.query = { simulationId: id };
    socket
      .timeout(5000)
      .emit(
        "simulation:subscribe",
        id,
        (err: Error | null, result: { ok: boolean; error?: string }) => {
          if (err || !result.ok)
            reject(new Error(result?.error ?? "Verbinding verlopen"));
          else resolve();
        },
      );
  });
}
socket.on("connect", () => {
  el("connection").textContent = "Verbonden · lokaal";
  el("connection-dot").classList.add("live");
  void loadRuns().catch(() => error("Runs konden niet worden opgehaald."));
  refreshControls();
});
socket.on("disconnect", () => {
  el("connection").textContent = "Verbinding verbroken · opnieuw verbinden…";
  el("connection-dot").classList.remove("live");
  refreshControls();
});
socket.on("connect_error", () => {
  el("connection").textContent = "Server niet bereikbaar · opnieuw verbinden…";
  el("connection-dot").classList.remove("live");
  refreshControls();
});
socket.on("world:snapshot", (snapshot) => {
  if (snapshot.simulation.id !== simulationId) return;
  scene?.load(snapshot.definition);
  update(snapshot.state);
  updateStatus(snapshot.simulation);
  el("seed").textContent = String(snapshot.definition.seed);
  el("size").textContent =
    `${snapshot.definition.terrain.width} × ${snapshot.definition.terrain.depth} m`;
  el("entity-count").textContent = String(snapshot.definition.entities.length);
  for (const [id, type] of [
    ["trees", "tree"],
    ["rocks", "rock"],
    ["artifacts", "artifact"],
    ["caves", "cave"],
  ])
    el(id!).textContent = String(
      snapshot.definition.entities.filter((e) => e.type === type).length,
    );
});
socket.on("world:delta", (data) => {
  if (data.simulationId === simulationId) update(data.state);
});
socket.on("simulation:state", updateStatus);
button("reset-camera").addEventListener("click", () => scene?.resetCamera());
button("pause").addEventListener(
  "click",
  () =>
    void control(async () =>
      updateStatus(
        await request(
          `/simulations/${simulationId}/${status?.status === "paused" ? "resume" : "pause"}`,
          "POST",
        ),
      ),
    ),
);
button("reset-cycle").addEventListener(
  "click",
  () =>
    void control(async () => {
      const snapshot = await request(
        `/simulations/${simulationId}/reset`,
        "POST",
      );
      scene?.load(snapshot.definition);
      update(snapshot.state);
      updateStatus(snapshot.simulation);
      if (!el("memory-panel").hidden) await loadMemory();
    }),
);
async function loadMemory() {
  const run = simulationId,
    agent = selectedAgent;
  const query = (el("memory-query") as HTMLInputElement).value;
  const [memories, context] = await Promise.all([
    request(
      `/simulations/${run}/agents/${agent}/memories?q=${encodeURIComponent(query)}`,
    ) as Promise<AgentMemory[]>,
    request(
      `/simulations/${run}/agents/${agent}/memory-context`,
    ) as Promise<MemoryContext>,
  ]);
  if (run !== simulationId || agent !== selectedAgent) return;
  el("memory-agent").textContent = `Geheugen · ${agent}`;
  el("memory-summary").textContent =
    context.summary ||
    "Na de eerste cyclus worden ervaringen samengevoegd tot blijvend geheugen.";
  el("memory-goals").textContent = `Doelen: ${context.goals.join(" · ")}`;
  const list = el("memory-list");
  list.replaceChildren();
  if (!memories.length) {
    const empty = document.createElement("li");
    empty.textContent = "Geen herinneringen gevonden voor deze agent.";
    list.append(empty);
  }
  for (const memory of memories) {
    const item = document.createElement("li");
    const label = document.createElement("small");
    label.textContent = `${memory.type} · ${memory.provenance} · vertrouwen ${Math.round(memory.confidence * 100)}% · belang ${Math.round(memory.importance * 100)}% · revisie ${memory.revision}`;
    const content = document.createElement("p");
    content.textContent = memory.content;
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `${memory.sourceEventIds.length} brongebeurtenissen${memory.conflictsWith?.length ? ` · ${memory.conflictsWith.length} tegenstrijdige claims` : ""}`;
    const sources = document.createElement("p");
    sources.textContent = memory.sourceEventIds.join(" · ");
    details.append(summary, sources);
    item.append(label, content, details);
    list.append(item);
  }
}
for (const tab of ["live", "memory"])
  button(`${tab}-tab`).addEventListener("click", () => {
    for (const name of ["live", "memory"]) {
      el(`${name}-panel`).hidden = name !== tab;
      button(`${name}-tab`).setAttribute("aria-pressed", String(name === tab));
    }
    if (tab === "memory") void control(loadMemory);
  });
el("memory-search").addEventListener("submit", (event) => {
  event.preventDefault();
  void control(loadMemory);
});
button("memory-refresh").addEventListener(
  "click",
  () => void control(loadMemory),
);
button("stop").addEventListener(
  "click",
  () =>
    void control(async () =>
      updateStatus(await request(`/simulations/${simulationId}/stop`, "POST")),
    ),
);
select("speed").addEventListener("change", () => {
  const speed = Number(select("speed").value);
  void control(async () =>
    updateStatus(
      await request(`/simulations/${simulationId}/speed`, "PATCH", {
        timeScale: speed,
      }),
    ),
  );
});
select("mode").addEventListener("change", () => {
  const mode = select("mode").value;
  void control(async () =>
    updateStatus(
      await request(`/simulations/${simulationId}/mode`, "PATCH", {
        schedulerMode: mode,
      }),
    ),
  );
});
select("run-select").addEventListener(
  "change",
  () => void control(() => subscribe(select("run-select").value)),
);
button("new-run").addEventListener(
  "click",
  () =>
    void control(async () => {
      const run = await request("/simulations", "POST", {
        controller: select("controller").value,
        codexAgentIds: ["alpha"],
      });
      await subscribe(run.id);
      await loadRuns();
    }),
);
button("cancel-action").addEventListener(
  "click",
  () =>
    void control(async () => {
      const action = state?.agents.find(
        (a) => a.id === selectedAgent,
      )?.activeActionId;
      if (action)
        await request(
          `/simulations/${simulationId}/agents/${selectedAgent}/actions/${action}/cancel`,
          "POST",
        );
    }),
);
button("observe").addEventListener(
  "click",
  () =>
    void control(async () => {
      const observation = await request(
        `/simulations/${simulationId}/agents/${selectedAgent}/observation`,
      );
      el("observation").textContent =
        `Tick ${observation.tick} · ${observation.visibleEntities.length} objecten, ${observation.visibleAgents.length} agents zichtbaar. Bereik: 25 m / 120°. ${observation.visibleEntities.map((e: { id: string }) => e.id).join(", ") || "Geen objecten in beeld."}`;
    }),
);
button("decisions").addEventListener(
  "click",
  () =>
    void control(async () => {
      const records = await request(
        `/simulations/${simulationId}/agents/${selectedAgent}/decisions`,
      );
      const list = el("decision-list");
      list.replaceChildren();
      if (!records.length) {
        const li = document.createElement("li");
        li.textContent = "Nog geen Codex-beslissingen voor deze agent.";
        list.append(li);
      }
      for (const record of records.slice(-8).reverse()) {
        const li = document.createElement("li");
        li.textContent = `Tick ${record.tick} · ${record.status} · ${record.motivation ?? record.error ?? "Beslissing wordt voorbereid"}${record.action ? " · " + JSON.stringify(record.action) : ""}${record.outcome ? " · resultaat " + record.outcome.status + (record.outcome.error ? " / " + record.outcome.error : "") : ""}`;
        list.append(li);
      }
    }),
);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    socket.disconnect();
    scene?.dispose();
  });
