import { io, type Socket } from 'socket.io-client';
import type { ClientEvents, ServerEvents, WorldStateDto } from '../../../packages/shared/src/index.js';
import { IslandScene } from './world/IslandScene';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<header class="topbar"><a class="brand" href="/" aria-label="Agent Island home"><span class="brandmark">△</span><span>AGENT ISLAND<small>LOCAL SIMULATION LAB</small></span></a><div class="connection"><span class="dot" id="connection-dot"></span><span id="connection" role="status">Verbinden…</span></div><span class="sprint">FASE 01 <span>/</span> WORLD ENGINE</span></header>
<main><section class="workspace"><div class="workspace-heading"><div><p class="eyebrow">EXPERIMENT 001 · SEED <span id="seed">—</span></p><h1>Een wereld om te ontdekken.</h1><p class="intro">Een vast eiland. Een eerste verkenner. Het begin van Agent Island.</p></div><span class="local-badge">LOCAL FIRST ↗</span></div>
<div class="viewport-wrap"><div id="viewport"></div><div class="viewport-top"><span class="view-label"><span class="dot live"></span> LIVE WORLD</span><span class="view-label subtle">FREE CAMERA</span></div><div id="scene-error" role="alert" hidden></div><div class="compass" aria-hidden="true">N<br><span>↑</span></div><div class="viewport-bottom"><span>Sleep om te draaien · Scroll om te zoomen</span><button id="reset-camera" type="button">↺ Overzicht</button></div></div>
<div class="metrics"><div><span>WERELDTIJD</span><strong id="world-time">00:00</strong></div><div><span>SIMULATIETICK</span><strong id="tick">0</strong></div><div><span>EILAND</span><strong id="size">—</strong></div><div><span>OBJECTEN</span><strong id="entity-count">—</strong></div></div>
</section><aside><div class="panel-heading"><p class="eyebrow">IN HET VELD</p><h2>De eerste verkenner<span>01</span></h2></div><button class="agent-card" id="focus-agent" type="button" disabled><div class="agent-title"><span class="avatar">A</span><span><strong>Alpha</strong><small>Scripted testagent</small></span><span class="agent-arrow">↗</span></div><div class="agent-status"><span class="dot live"></span> Vaste route verkennen</div><div class="coordinates"><span>POSITIE · X / Y / Z</span><code id="position">— / — / —</code></div><div class="agent-footer">Bekijk van dichtbij <span>→</span></div></button>
<div class="route-note"><span class="note-icon">⌁</span><div><h3>De server bepaalt de wereld</h3><p>Alpha loopt een vrije testroute. Deze viewer ontvangt de wereldtoestand en interpoleert de beweging.</p></div></div>
<div class="legend"><p class="eyebrow">OP HET EILAND</p><div><i class="legend-tree"></i><span>Bomen</span><b id="trees">—</b></div><div><i class="legend-rock"></i><span>Rotsen</span><b id="rocks">—</b></div><div><i class="legend-artifact"></i><span>Artefacten</span><b id="artifacts">—</b></div><div><i class="legend-cave"></i><span>Grot</span><b id="caves">—</b></div></div>
<div class="next"><p class="eyebrow">VOLGENDE MIJLPAAL</p><h3>Van bewegen naar handelen.</h3><p>Sprint 02 voegt navigatie, een simulatieklok en gedeelde objectinteracties toe.</p><span>02 / 06 <span>→</span></span></div></aside></main><footer><span>AGENT ISLAND <span class="footer-divider">/</span> Deterministische wereld · Generator v1</span><span>1× realtime · 20 ticks/s · 10 updates/s</span></footer>`;
const el = (id: string) => document.getElementById(id)!;
let scene: IslandScene | undefined;
try { scene = new IslandScene(el('viewport')); }
catch { const error = el('scene-error'); error.hidden = false; error.textContent = 'De 3D-viewer kon niet starten. Controleer of WebGL beschikbaar is in je browser.'; }
const socket: Socket<ServerEvents, ClientEvents> = io();
function connection(text: string, live: boolean) {
  el('connection').textContent = text; el('connection-dot').classList.toggle('live', live);
}
function update(state: WorldStateDto) {
  scene?.update(state);
  const seconds = Math.floor(state.simulationTimeMs / 1000);
  el('world-time').textContent = `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
  el('tick').textContent = state.tick.toLocaleString('nl-NL');
  const alpha = state.agents[0];
  if (alpha) el('position').textContent = [alpha.position.x, alpha.position.y, alpha.position.z].map(n => n.toFixed(1)).join(' / ');
}
socket.on('connect', () => connection('Verbonden · lokaal', true));
socket.on('disconnect', () => connection('Verbinding verbroken · opnieuw verbinden…', false));
socket.on('connect_error', () => connection('Server niet bereikbaar · opnieuw verbinden…', false));
socket.on('world:snapshot', ({ definition, state }) => {
  scene?.load(definition); update(state);
  el('seed').textContent = String(definition.seed);
  el('size').textContent = `${definition.terrain.width} × ${definition.terrain.depth} m`;
  el('entity-count').textContent = String(definition.entities.length);
  for (const [id, type] of [['trees', 'tree'], ['rocks', 'rock'], ['artifacts', 'artifact'], ['caves', 'cave']]) {
    el(id!).textContent = String(definition.entities.filter(e => e.type === type).length);
  }
  (el('focus-agent') as HTMLButtonElement).disabled = !scene;
});
socket.on('world:delta', update);
el('reset-camera').addEventListener('click', () => scene?.resetCamera());
el('focus-agent').addEventListener('click', () => scene?.focusAgent());
if (import.meta.hot) import.meta.hot.dispose(() => { socket.disconnect(); scene?.dispose(); });
