import { io, type Socket } from "socket.io-client";
import type {
  AgentMemory,
  CycleMetrics,
  WorldEvent,
  DecisionRecord,
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
<header class="topbar"><a class="brand" href="/" aria-label="Agent Island home"><span class="brandmark">△</span><span>AGENT ISLAND<small>LOCAL SIMULATION LAB</small></span></a><div class="connection"><span class="dot" id="connection-dot"></span><span id="connection" role="status">Verbinden…</span></div><span class="sprint">FASE 06 <span>/</span> EXPERIMENTEN</span></header>
<main><section class="workspace"><div class="workspace-heading"><div><p class="eyebrow">EXPERIMENT · SEED <span id="seed">—</span></p><h1>Samen op onbekend terrein.</h1><p class="intro">Drie verkenners. Eén gedeeld eiland. Elke actie telt.</p></div><span class="local-badge">LOCAL FIRST ↗</span></div>
<div class="simulation-controls" aria-label="Simulatiebeheer"><label>Run<select id="run-select"><option value="sim-001">sim-001</option></select></label><button id="pause" type="button" disabled>Pauzeren</button><label>Snelheid<select id="speed"><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option><option value="20">20×</option></select></label><label>Besluitvorming<select id="mode"><option value="live">Live</option><option value="experiment">Experiment</option></select></label><button id="reset-cycle" type="button" disabled>Cyclus resetten</button><button id="stop" type="button" disabled>Stoppen</button><label>Nieuwe run met<select id="controller"><option value="scripted">Scripted agents</option><option value="codex">Codex Alpha + 2 scripted</option><option value="codex-all">3 autonome Codex-agents</option></select></label><label>Cycli<input id="max-cycles" type="number" min="1" max="100" value="2" /></label><label>Besluiten / agent / cyclus<input id="decision-budget" type="number" min="1" max="10000" value="120" /></label><button id="new-run" type="button">Nieuwe run</button><span id="simulation-status" role="status">Verbinden…</span></div><p id="control-error" role="alert" hidden></p><p id="runtime-status" class="runtime-status" role="status"></p>
<div class="viewport-wrap"><div id="viewport"></div><div class="viewport-top"><span class="view-label" id="view-source"><span class="dot live"></span> LIVE WORLD</span><span class="view-label subtle" id="view-camera">FREE CAMERA</span></div><div id="scene-error" role="alert" hidden></div><div class="compass" aria-hidden="true">N<br><span>↑</span></div><div class="viewport-bottom"><span>Sleep om te draaien · Scroll om te zoomen</span><button id="reset-camera" type="button">↺ Overzicht</button></div></div>
<div class="metrics"><div><span>WERELDTIJD</span><strong id="world-time">00:00</strong></div><div><span>SIMULATIETICK</span><strong id="tick">0</strong></div><div><span>EILAND</span><strong id="size">—</strong></div><div><span>OBJECTEN</span><strong id="entity-count">—</strong></div></div>
<nav class="data-tabs" aria-label="Agentgegevens"><button id="live-tab" type="button" aria-pressed="true">Live</button><button id="timeline-tab" type="button" aria-pressed="false">Timeline</button><button id="results-tab" type="button" aria-pressed="false">Experiment</button><button id="replay-tab" type="button" aria-pressed="false">Replay</button><button id="memory-tab" type="button" aria-pressed="false">Geheugen</button></nav>
<section id="timeline-panel" hidden aria-label="Historische tijdlijn"><h2>Timeline</h2><div class="simulation-controls"><label>Cyclus<select id="timeline-cycle"></select></label><button id="timeline-refresh" type="button">Vernieuwen</button><button id="timeline-more" type="button">Meer laden</button></div><ol id="history-events"></ol></section>
<section id="results-panel" hidden aria-label="Experimentresultaten"><h2>Vergelijking tussen cycli</h2><button id="results-refresh" type="button">Vernieuwen</button><p id="experiment-progress" role="status"></p><p>Herbezoeken: eerder waargenomen objecten. Samenwerking: geslaagde expliciete berichten en objecten waarmee meerdere agents succesvol interacteren. Geheugengebruik: geslaagde bewegingen naar aangeleverde geheugendoelen. Dit is een meetbare aanwijzing voor gebruik, geen bewijs van modelredenering.</p><p>Locatiecontrole vergelijkt opnieuw zichtbare objecten met bronwaarnemingen van opgehaalde herinneringen (tolerantie 10 cm). Verplaatste objecten kunnen afwijken. Geen controle betekent onbekend.</p><div class="results-scroll"><table id="experiment-results"></table></div><p id="experiment-errors"></p></section>
<section id="replay-panel" hidden aria-label="Replay"><div class="simulation-controls"><label>Cyclus<select id="replay-cycle"></select></label><button id="replay-refresh" type="button">Vernieuwen</button><button id="replay-play" type="button">Afspelen</button><label>Afspeelsnelheid<select id="replay-speed"><option>1</option><option>2</option><option>5</option><option>10</option><option>20</option></select></label><label>Weergave<select id="replay-pov"><option value="">Vrije camera</option><option value="alpha">Alpha POV</option><option value="beta">Beta POV</option><option value="gamma">Gamma POV</option></select></label></div><label class="replay-seek">Tijdlijn<input id="replay-seek" type="range" min="0" max="0" value="0" step="1" /></label><p id="replay-info" role="status"></p><div class="replay-discovery"><canvas id="discovery-map" width="260" height="260" aria-label="Ontdekte objectlocaties op het eiland"></canvas><p id="discovery-info">Kies een agent POV om ontdekkingen tot dit tijdstip te bekijken.</p></div><h2>Decision Inspector</h2><p>Vastgelegde waarneming, geheugen, publieke motivatie, tools en resultaat.</p><div id="replay-decisions"></div></section>
<section id="memory-panel" hidden aria-label="Agentgeheugen"><div class="memory-heading"><h2 id="memory-agent">Geheugen · Alpha</h2><span id="memory-cycle"></span></div><form id="memory-search"><label>Doorzoek herinneringen<input id="memory-query" type="search" maxlength="500" placeholder="Bijvoorbeeld cave of rock" /></label><button type="submit">Zoeken</button><button id="memory-refresh" type="button">Vernieuwen</button></form><p id="memory-summary"></p><p id="memory-goals"></p><ol id="memory-list"></ol></section>
<div id="live-panel"><div class="timeline"><p class="eyebrow">RECENTE ACTIES</p><div class="simulation-controls"><label>Agentfilter voor recente acties<select id="event-agent"><option value="">Alle agents</option><option value="alpha">Alpha</option><option value="beta">Beta</option><option value="gamma">Gamma</option></select></label></div><ol id="events"><li>Wachten op de eerste actie…</li></ol></div><div class="timeline"><p class="eyebrow">VASTGELEGDE BESLISSINGEN</p><ol id="decision-list"><li>Bekijk alle beslissingen of filter op een agent.</li></ol></div></div>
</section><aside><div class="panel-heading"><p class="eyebrow">IN HET VELD</p><h2>De verkenners<span>03</span></h2></div><div id="agents"></div>
<div class="agent-tools"><button id="cancel-action" type="button" disabled>Actie annuleren</button><button id="observe" type="button" disabled>Waarneming bekijken</button><label>Agentfilter voor beslissingen<select id="decision-agent" disabled><option value="">Alle agents</option><option value="alpha">Alpha</option><option value="beta">Beta</option><option value="gamma">Gamma</option></select></label><button id="decisions" type="button" disabled>Beslissingen bekijken</button><p id="observation" aria-live="polite">Selecteer een verkenner om de camera te richten.</p></div>
<div class="route-note"><span class="note-icon">⌁</span><div><h3>Een gedeelde wereld</h3><p>Agents begroeten elkaar, onderzoeken objecten en verzamelen kristallen, schelpen en relikwieën. Eén object kan maar één eigenaar hebben.</p></div></div>
<div class="legend"><p class="eyebrow">OP HET EILAND</p><div><i class="legend-tree"></i><span>Bomen</span><b id="trees">—</b></div><div><i class="legend-rock"></i><span>Rotsen</span><b id="rocks">—</b></div><div><i class="legend-artifact"></i><span>Artefacten</span><b id="artifacts">—</b></div><div><i class="legend-cave"></i><span>Grot</span><b id="caves">—</b></div></div>
<div class="next"><p class="eyebrow">EXPERIMENTEN</p><h3>Samen leren.</h3><p>Vergelijk cycli, volg het beslisbudget en controleer herinneringen via hun bronnen.</p><span>06 / 06 <span>→</span></span></div></aside></main><footer><span>AGENT ISLAND <span class="footer-divider">/</span> Deterministische wereld · <span id="generator-version">Generator v3</span></span><span id="clock-details">20 ticks/s virtueel · maximaal 10 updates/s</span></footer>`;
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
let replayActive = false;
let liveSnapshot:
  import("../../../packages/shared/src/index.js").WorldSnapshot | undefined;
let replayRequest = 0;
let replayPlaying = false;
let replayTimer: ReturnType<typeof setTimeout> | undefined;
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
  const connected = socket.connected && !!status && !replayActive;
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
    "decision-agent",
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
    `Cyclus ${next.cycleIndex ?? 1} · ${next.cycleStatus === "closing" ? "Wordt afgesloten" : next.cycleStatus === "completed" ? "Afgerond" : "Actief"}`;
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
  el("simulation-status").textContent = next.experiment?.completed
    ? "Experiment voltooid"
    : next.cycleStatus === "closing"
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
  if (next.experiment)
    el("runtime-status").textContent +=
      ` · Cyclus ${next.cycleIndex}/${next.experiment.maxCycles} · budget ${Object.entries(
        next.experiment.decisionsUsed,
      )
        .map(
          ([id, n]) =>
            `${id} ${n}/${next.experiment!.decisionBudgetPerAgentPerCycle}`,
        )
        .join(
          ", ",
        )}${next.experiment.exhaustedAgents.length ? " · Budget bereikt: " + next.experiment.exhaustedAgents.join(", ") : ""}${next.experiment.completed ? " · Experiment voltooid" : ""}`;
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
  renderEvents(next);
  refreshControls();
}
function renderEvents(next: WorldStateDto) {
  const agent = select("event-agent").value;
  const list = el("events");
  const events = next.events
    .filter((event) => !agent || event.actorId === agent)
    .slice(-8)
    .reverse();
  list.replaceChildren();
  for (const event of events) {
    const li = document.createElement("li");
    li.textContent = `${event.tick} · ${event.message}`;
    li.className = event.type.endsWith("failed") ? "event-failed" : "";
    list.append(li);
  }
  if (!events.length) {
    const li = document.createElement("li");
    li.textContent = agent
      ? "Geen recente acties voor deze agent."
      : "Wachten op de eerste actie…";
    list.append(li);
  }
}
select("event-agent").addEventListener("change", () => {
  if (state) renderEvents(state);
});
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
    stopReplay();
    replayRequest++;
    historyGeneration++;
    replayActive = false;
    el("replay-panel").hidden = true;
    el("live-panel").hidden = false;
    el("memory-panel").hidden = true;
    for (const tab of ["timeline", "results"]) {
      el(`${tab}-panel`).hidden = true;
      button(`${tab}-tab`).setAttribute("aria-pressed", "false");
    }
    el("history-events").replaceChildren();
    el("experiment-results").replaceChildren();
    button("live-tab").setAttribute("aria-pressed", "true");
    button("memory-tab").setAttribute("aria-pressed", "false");
    el("view-source").textContent = "LIVE WORLD";
    el("view-camera").textContent = "FREE CAMERA";
    button("replay-tab").setAttribute("aria-pressed", "false");
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
  liveSnapshot = snapshot;
  el("generator-version").textContent =
    `Generator v${snapshot.definition.version}`;
  if (replayActive) return;
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
  if (data.simulationId === simulationId) {
    if (liveSnapshot) liveSnapshot.state = data.state;
    if (!replayActive) update(data.state);
  }
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
for (const tab of ["live", "timeline", "memory", "replay", "results"])
  button(`${tab}-tab`).addEventListener("click", () => {
    for (const name of ["live", "timeline", "memory", "replay", "results"]) {
      el(`${name}-panel`).hidden = name !== tab;
      button(`${name}-tab`).setAttribute("aria-pressed", String(name === tab));
    }
    replayActive = tab === "replay";
    el("view-source").textContent = replayActive
      ? "RECORDED REPLAY"
      : "LIVE WORLD";
    el("view-camera").textContent = "FREE CAMERA";
    stopReplay();
    replayRequest++;
    if (replayActive) void control(loadReplayCycles);
    else if (liveSnapshot) {
      scene?.load(liveSnapshot.definition);
      update(liveSnapshot.state);
    }
    refreshControls();
    if (tab === "memory") void control(loadMemory);
    if (tab === "results") void control(loadResults);
    if (tab === "timeline") void control(loadTimelineCycles);
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
        controller:
          select("controller").value === "scripted" ? "scripted" : "codex",
        codexAgentIds:
          select("controller").value === "codex-all"
            ? ["alpha", "beta", "gamma"]
            : ["alpha"],
        timeScale: Number(select("speed").value),
        schedulerMode: select("mode").value,
        experiment: {
          maxCycles: Number((el("max-cycles") as HTMLInputElement).value),
          decisionBudgetPerAgentPerCycle: Number(
            (el("decision-budget") as HTMLInputElement).value,
          ),
        },
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
async function loadDecisions() {
  const run = simulationId;
  const agent = select("decision-agent").value;
  const agentIds = agent
    ? [agent]
    : (liveSnapshot?.state.agents ?? state?.agents ?? []).map((a) => a.id);
  const records = (
    await Promise.all(
      agentIds.map(
        (id) =>
          request(
            `/simulations/${run}/agents/${encodeURIComponent(id)}/decisions`,
          ) as Promise<(DecisionRecord & { cycleId?: string })[]>,
      ),
    )
  ).flat();
  if (
    run !== simulationId ||
    agent !== select("decision-agent").value ||
    replayActive
  )
    return;
  records.sort((a, b) => {
    const cycle = (record: typeof a) =>
      Number(record.cycleId?.match(/cycle-(\d+)$/)?.[1] ?? 0);
    return (
      cycle(a) - cycle(b) ||
      a.tick - b.tick ||
      a.id.localeCompare(b.id) ||
      a.agentId.localeCompare(b.agentId)
    );
  });
  const list = el("decision-list");
  list.replaceChildren();
  if (!records.length) {
    const li = document.createElement("li");
    li.textContent = agent
      ? "Nog geen beslissingen voor deze agent."
      : "Nog geen beslissingen voor deze run.";
    list.append(li);
  }
  for (const record of records.slice(-8).reverse()) {
    const li = document.createElement("li");
    li.textContent = `${record.agentId} · ${record.cycleId?.split(":").at(-1) ?? ""} · Tick ${record.tick} · ${record.status} · ${record.motivation ?? record.error ?? "Scripted beslissing"}${record.action ? " · " + JSON.stringify(record.action) : ""}${record.outcome ? " · resultaat " + record.outcome.status + (record.outcome.error ? " / " + record.outcome.error : "") : ""}`;
    list.append(li);
  }
}
function showDecisions() {
  button("live-tab").click();
  void control(loadDecisions);
}
button("decisions").addEventListener("click", showDecisions);
select("decision-agent").addEventListener("change", showDecisions);
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    stopReplay();
    socket.disconnect();
    scene?.dispose();
  });

function stopReplay() {
  replayPlaying = false;
  clearTimeout(replayTimer);
  button("replay-play").textContent = "Afspelen";
}
async function loadReplayCycles() {
  const run = simulationId;
  const cycles: {
    id: string;
    cycleIndex: number;
    firstTick: number;
    lastTick: number;
  }[] = await request(`/simulations/${run}/replays`);
  if (!replayActive || run !== simulationId) return;
  const previous = select("replay-cycle").value;
  select("replay-cycle").replaceChildren(
    ...cycles.map((cycle) => {
      const option = document.createElement("option");
      option.value = cycle.id;
      option.textContent = `Cyclus ${cycle.cycleIndex} · ${cycle.lastTick} ticks`;
      option.dataset.first = String(cycle.firstTick);
      option.dataset.last = String(cycle.lastTick);
      return option;
    }),
  );
  if (cycles.some((c) => c.id === previous))
    select("replay-cycle").value = previous;
  await changeReplayCycle();
}
async function changeReplayCycle() {
  stopReplay();
  const option = select("replay-cycle").selectedOptions[0];
  button("replay-play").disabled = !option;
  if (!option) {
    el("replay-info").textContent =
      "Geen opgenomen replay beschikbaar voor deze run.";
    return;
  }
  const seek = el("replay-seek") as HTMLInputElement;
  seek.min = option.dataset.first!;
  seek.max = option.dataset.last!;
  seek.value = seek.min;
  await seekReplay();
}
async function seekReplay() {
  if (!replayActive || !select("replay-cycle").value) return;
  const generation = ++replayRequest;
  const seek = el("replay-seek") as HTMLInputElement;
  const pov = select("replay-pov").value;
  const data = await request(
    `/simulations/${simulationId}/replays/${encodeURIComponent(select("replay-cycle").value)}?tick=${seek.value}${pov ? `&agentId=${pov}` : ""}`,
  );
  if (!replayActive || generation !== replayRequest) return;
  scene?.load(data.definition);
  el("agents").replaceChildren();
  update(data.state);
  el("view-camera").textContent = pov
    ? `${pov.toUpperCase()} POV`
    : "FREE CAMERA";
  if (pov) scene?.focusAgent(pov);
  el("replay-info").textContent =
    `Replay · tick ${data.tick} / ${seek.max} · SHA-256 ${data.hash.slice(0, 16)} · ${pov ? `${pov}: alleen destijds zichtbare objecten en agents` : "Vrije camera"}`;
  const list = el("replay-decisions");
  list.replaceChildren();
  for (const record of data.decisions.slice().reverse()) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = `Tick ${record.tick} · ${record.action?.type ?? record.status} · ${record.motivation ?? record.error ?? "Scripted beslissing"}`;
    const pre = document.createElement("pre");
    pre.textContent = JSON.stringify(record, null, 2);
    details.append(summary, pre);
    list.append(details);
  }
  if (!data.decisions.length)
    list.textContent = pov
      ? "Nog geen beslissingen op dit tijdstip."
      : "Kies een agent POV om beslissingen te inspecteren.";
  const canvas = el("discovery-map") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#173e45";
  ctx.fillRect(0, 0, 260, 260);
  const found = new Map<
    string,
    { position: { x: number; z: number }; type: string }
  >();
  for (const entity of data.discovered) found.set(entity.id, entity);
  for (const entity of found.values()) {
    ctx.fillStyle = entity.type === "artifact" ? "#ffcd60" : "#a9d2bd";
    ctx.beginPath();
    ctx.arc(
      (entity.position.x / data.definition.terrain.width + 0.5) * 260,
      (entity.position.z / data.definition.terrain.depth + 0.5) * 260,
      3,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  el("discovery-info").textContent = pov
    ? `${pov} · ${found.size} ontdekte objecten tot tick ${data.tick}. Geel: artefacten. Boven: −Z; rechts: +X.`
    : "Kies een agent POV om ontdekkingen tot dit tijdstip te bekijken.";
}
async function playReplay() {
  if (!replayPlaying || !replayActive) return;
  const seek = el("replay-seek") as HTMLInputElement;
  seek.value = String(
    Math.min(
      Number(seek.max),
      Number(seek.value) + 4 * Number(select("replay-speed").value),
    ),
  );
  try {
    await seekReplay();
  } catch (e) {
    error(String(e));
    stopReplay();
    return;
  }
  if (Number(seek.value) >= Number(seek.max)) stopReplay();
  else if (replayPlaying)
    replayTimer = setTimeout(() => void playReplay(), 200);
}
button("replay-refresh").addEventListener(
  "click",
  () => void control(loadReplayCycles),
);
select("replay-cycle").addEventListener(
  "change",
  () => void control(changeReplayCycle),
);
select("replay-pov").addEventListener("change", () => void control(seekReplay));
el("replay-seek").addEventListener("input", () => {
  stopReplay();
  void seekReplay().catch((e) => error(String(e)));
});
button("replay-play").addEventListener("click", () => {
  if (replayPlaying) {
    stopReplay();
    return;
  }
  replayPlaying = true;
  button("replay-play").textContent = "Pauzeren";
  void playReplay();
});

async function loadResults() {
  const run = simulationId;
  const data: { simulation: SimulationStatus; cycles: CycleMetrics[] } =
    await request(`/simulations/${run}/results`);
  if (run !== simulationId) return;
  const progress = data.simulation.experiment;
  el("experiment-progress").textContent = progress
    ? `Seed ${liveSnapshot?.definition.seed ?? "—"} · Cyclus ${data.simulation.cycleIndex}/${progress.maxCycles} · ${progress.completed ? "Voltooid" : data.simulation.status} · Maximaal ${progress.decisionBudgetPerAgentPerCycle} beslispogingen per agent per cyclus`
    : "Doorlopende run zonder experimentlimiet.";
  const table = el("experiment-results");
  table.replaceChildren();
  const header = document.createElement("tr");
  for (const title of [
    "Cyclus",
    "Status / tick",
    "Agent",
    "Besluiten",
    "Fouten",
    "Geannuleerd",
    "Tools",
    "Beslistijd (s)",
    "Objecten",
    "Herbezoeken",
    "Vakken (25 m)",
    "Berichten",
    "Gedeelde objecten",
    "Geheugendoelen",
    "Locaties juist / afwijkend",
  ]) {
    const th = document.createElement("th");
    th.textContent = title;
    th.scope = "col";
    header.append(th);
  }
  const head = document.createElement("thead");
  head.append(header);
  table.append(head);
  const body = document.createElement("tbody");
  for (const cycle of data.cycles)
    for (const a of cycle.agents) {
      const row = document.createElement("tr");
      for (const value of [
        cycle.cycleIndex,
        `${cycle.status} / ${cycle.tick}`,
        a.agentId,
        a.decisions,
        a.failures,
        a.cancelled,
        a.toolCalls,
        (a.decisionTimeMs / 1000).toFixed(1),
        a.discoveries,
        a.revisits,
        a.observationCells,
        a.messagesSent,
        a.sharedObjects,
        a.movesToMemoryTargets,
        `${a.verifiedLocations} / ${a.contradictedLocations}`,
      ]) {
        const cell = document.createElement("td");
        cell.textContent = String(value);
        row.append(cell);
      }
      body.append(row);
    }
  table.append(body);
  el("experiment-errors").textContent =
    data.simulation.cycleError ??
    "Gebruiksregistratie telt pogingen, tools en beslistijd; tokenkosten zijn niet beschikbaar. Acties staan in Timeline; beslisfouten en brongegevens in de Decision Inspector.";
}
let historyCursor = 0;
let historyGeneration = 0;
async function loadTimelineCycles() {
  const run = simulationId;
  const cycles: { id: string; cycleIndex: number }[] = await request(
    `/simulations/${run}/replays`,
  );
  if (run !== simulationId) return;
  const previous = select("timeline-cycle").value;
  select("timeline-cycle").replaceChildren(
    ...cycles.map((c) => {
      const option = document.createElement("option");
      option.value = c.id;
      option.textContent = `Cyclus ${c.cycleIndex}`;
      return option;
    }),
  );
  select("timeline-cycle").value = cycles.some((c) => c.id === previous)
    ? previous
    : (cycles.at(-1)?.id ?? "");
  await loadTimeline(true);
}
async function loadTimeline(reset = false) {
  const run = simulationId;
  const cycle = select("timeline-cycle").value;
  if (!cycle) return;
  const generation = ++historyGeneration;
  if (reset) {
    historyCursor = 0;
    el("history-events").replaceChildren();
  }
  const result: { events: WorldEvent[]; nextCursor: number } = await request(
    `/simulations/${run}/timeline?cycleId=${encodeURIComponent(cycle)}&after=${historyCursor}`,
  );
  if (
    run !== simulationId ||
    cycle !== select("timeline-cycle").value ||
    generation !== historyGeneration
  )
    return;
  for (const event of result.events) {
    const item = document.createElement("li");
    item.textContent = `${event.tick} · ${event.actorId} · ${event.message}${event.targetId ? " · " + event.targetId : ""}`;
    el("history-events").append(item);
  }
  historyCursor = result.nextCursor;
  button("timeline-more").disabled = result.events.length < 200;
}
button("results-refresh").addEventListener(
  "click",
  () => void control(loadResults),
);
button("timeline-refresh").addEventListener(
  "click",
  () => void control(loadTimelineCycles),
);
button("timeline-more").addEventListener(
  "click",
  () => void control(() => loadTimeline()),
);
select("timeline-cycle").addEventListener(
  "change",
  () => void control(() => loadTimeline(true)),
);
