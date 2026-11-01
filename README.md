# Agent Island

Local-first simulatieplatform in TypeScript. Mijlpaal 3 voegt echte Codex-agents en een agentgebonden MCP-runtime toe. De wereldbasis levert een deterministisch 3D-eiland met drie scripted agents, een instelbare simulatieklok, navigatie en gedeelde objectinteracties. Hono en de World Engine beheren de wereld; Socket.IO stuurt de toestand naar de Vite/Three.js-viewer. Codex is optioneel; de standaardrun blijft scripted.

## Lokaal starten

Vereist: Node.js 22.12+ en npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. De backend luistert op **http://127.0.0.1:3001**. Stop beide processen met Ctrl+C. Er zijn geen API-sleutels of externe diensten nodig.

- Sleep om de camera te draaien; scroll om te zoomen. Klik op Alpha, Beta of Gamma om de camera op die agent te richten.
- Pauzeer/hervat de klok, kies 1×/2×/5×/10×/20× en wissel tussen Live en Experiment.
- Stoppen is definitief voor een run; Nieuwe run maakt een onafhankelijk experiment. De runkeuze schakelt de liveverbinding naar de juiste Socket.IO-room.
- Bekijk de waarneming van de geselecteerde agent of annuleer diens actie. Een scripted agent kiest bij de volgende tick opnieuw een actie.
- De tijdlijn toont recente resultaten en fouten; inventarissen en gedragen objecten volgen de servertoestand.

## Echte Codex-agent starten

Zorg dat de Codex CLI beschikbaar is en `codex login` is afgerond. Kies **Codex Alpha + 2 scripted** bij **Nieuwe run met** in het dashboard. Iedere Codex-agent krijgt een eigen thread, gefilterde waarnemingen en wereldacties via een beperkte MCP-sessie. De modelstatus en publieke beslissingen zijn zichtbaar in het dashboard.

De echte acceptatieproef draaide 15 minuten simulatietijd met 13 modelbesluiten en 10 geslaagde verplaatsingen. Details en een herhaalbaar testcommando staan in de [Codex-runtimehandleiding](docs/codex-runtime.md) en het [acceptatieverslag van mijlpaal 3](docs/sprint-3-acceptance.md).

## Controleren en bouwen

```sh
npm run typecheck
npm test
npm run build
```

`npm run format` formatteert TypeScript, CSS, HTML en configuratie. De clientbuild staat in `apps/client/dist`. De serverbuild bevat de gedeelde contracten en start met `npm start -w @agent-island/server`. `npm run preview -w @agent-island/client` toont de clientbuild met dezelfde lokale backendproxy. Dit is een lokale ontwikkelopzet, geen hostingconfiguratie.

## Structuur

- `apps/client`: dashboard, Three.js-rendering, interpolatie en camera.
- `apps/server/src/world`: wereldgenerator, autoritatieve engine, navmesh/A* en perceptie.
- `apps/server/src/simulation`: vaste virtuele klok en afzonderlijke simulatieruns.
- `apps/server/src/agents`: annuleerbare scheduler, scripted policy, CodexAdapter en beslisjournal.
- `packages/world-mcp`: gevalideerde wereldtools via MCP InMemoryTransport.
- `packages/shared`: getypeerde contracten, Zod-schema's en heightmap-sampling.
- [TODO.md](TODO.md): zes mijlpalen, taken en acceptatiecriteria.
- [Ontwerp v1.0](docs/architecture-v1.md), [acceptatie mijlpaal 1](docs/sprint-1-acceptance.md) en [acceptatie mijlpaal 2](docs/sprint-2-acceptance.md).

## Klok en beslissingen

Iedere tick is 50 ms virtuele tijd. De server verwerkt beweging op 3 m/s, acties en wachttijden uitsluitend in deze tijd. Wall time wordt afzonderlijk gemeten. Pauzetijd levert geen inhaalwerk op; een snelheidswijziging geldt vanaf het wijzigingsmoment.

De klok verwerkt maximaal 100 ticks per pump en bewaart maximaal 5 seconden virtuele achterstand. Extra achterstand wordt overgeslagen en als `droppedSimulationTimeMs` zichtbaar gemaakt. Virtuele ticks zelf worden nooit overgeslagen: de wereld vertraagt bij overbelasting. Het dashboard toont resterende achterstand en niet verwerkte virtuele tijd.

In **Live** blijft de wereld draaien terwijl agents beslissen. In **Experiment** wacht een tick totdat alle op dat beslismoment benodigde besluiten klaarstaan. Ze worden vervolgens in agent-ID-volgorde aangeboden. Wachttijd bij een beslisbarrière wordt niet later ingehaald. Er loopt maximaal één besluit per agent. Een mislukt of langer dan de ingestelde deadline hangend besluit (scripted 10 s, Codex-adapter 60 s) valt terug op een korte virtuele wachtactie. Stoppen of wisselen van besluitmodus maakt oude, nog binnenkomende resultaten ongeldig.

## Wereld, navigatie en interacties

Generator v2 behoudt seed `48291`, een 500 × 500 m heightmap met 81 × 81 samples, 120 bomen, 80 rotsen, 12 artefacten en één grot. Versie 2 voegt drie vrije spawnpunten toe. Dezelfde versie en configuratie leveren dezelfde definitie op. Runtime en uitgaande snapshots zijn onafhankelijke kopieën.

De navigatie gebruikt een uit het terrein afgeleid driehoekig navmesh. A* zoekt over de driehoekcentra; randen en vereenvoudigde padsegmenten worden gecontroleerd op water, te steile hellingen en objecten met agentvrijruimte. Ook iedere bewegingsstap controleert actuele objecten en andere agents. Na oppakken of neerleggen wordt de obstakelindex ongeldig gemaakt. Een route die 5 virtuele seconden geblokkeerd blijft eindigt met `PATH_BLOCKED`; de scripted policy kiest daarna opnieuw. Dit is eenvoudige kinematische botsingsdetectie, zonder rigid-body physics of coöperatieve padplanning.

Alle acties krijgen een ID en de status `queued → running → succeeded/failed/cancelled`. Per agent kan één actie openstaan. Aan het begin van een tick beslist agent-ID-volgorde bij conflicten, ongeacht de aankomstvolgorde van verzoeken. Afstand, beschikbaarheid, zicht en eigendom worden bij uitvoering opnieuw gecontroleerd.

Ondersteund: `move`, `look`, `wait`, `inspect`, `interact` (artefact activeren), `pickup` (verplaatsbare steen) en `drop`. Een agent draagt maximaal één object. Neerleggen mag geen ander object of agent overlappen. Doelhoogte wordt altijd door de server uit het terrein bepaald.

Perceptie gebruikt 25 m horizontaal bereik, een zichtveld van 120° en 2D-occlusie door bomen, rotsen en de grot. Interactieafstand is 3 m vanaf de objectgrens. De eigen inventaris blijft bekend. Gebeurtenissen krijgen hun publiek op het moment waarop ze plaatsvinden; latere waarnemingen geven geen toegang tot de globale historie. De menselijke viewer ziet de hele wereld, agentwaarnemingen blijven beperkt. Terreinheuvels blokkeren het zicht in deze versie nog niet.

## API

De standaardrun is `sim-001`. Alle data staat tijdelijk in het servergeheugen, maximaal 8 runs per proces. Een serverherstart begint opnieuw. Opslag, automatische cyclusresets, blijvend agentgeheugen en replay volgen in latere mijlpalen.

| Methode | Endpoint | Functie |
| --- | --- | --- |
| GET | `/api/health` | Serverstatus |
| GET | `/api/world` | Snapshot standaardrun; compatibel alias |
| GET | `/api/worlds` | Beschikbare wereld |
| GET / POST | `/api/simulations` | Runs opvragen / nieuwe run |
| GET | `/api/simulations/:id` | Klok en status |
| GET | `/api/simulations/:id/world` | Werelddefinitie, runtime en status |
| GET | `/api/simulations/:id/agents` | Agents |
| POST | `/api/simulations/:id/pause`, `/resume`, `/stop` | Run bedienen |
| PATCH | `/api/simulations/:id/speed` | `{ "timeScale": 1/2/5/10/20 }` |
| PATCH | `/api/simulations/:id/mode` | `{ "schedulerMode": "live"/"experiment" }` |
| GET | `/api/simulations/:id/agents/:agentId/observation` | Beperkte actuele waarneming |
| POST | `/api/simulations/:id/agents/:agentId/actions` | Zod-gevalideerde actie indienen |
| GET | `/api/simulations/:id/actions/:actionId` | Actieresultaat |
| POST | `/api/simulations/:id/agents/:agentId/actions/:actionId/cancel` | Open actie annuleren |

Een nieuwe run accepteert optioneel `worldId: "island-48291"`, `timeScale`, `schedulerMode`, `controller: "scripted"/"codex"` en `codexAgentIds` (standaard `["alpha"]`). Een geaccepteerde actie retourneert HTTP 202 met `{ accepted: true, actionId }`; ongeldige input geeft 400, onbekende resources 404 en conflicten 409. De action-ID geeft toegang tot de uiteindelijke uitkomst. Dit is een lokale onderzoeks-API voor de menselijke operator; modelagents krijgen alleen de interne identiteitgebonden MCP-sessie. Modelbeslissingen zijn leesbaar via `GET /api/simulations/:id/agents/:agentId/decisions`.

Socket.IO verstuurt `world:snapshot` bij (her)verbinden en abonneren. `simulation:subscribe(id, ack)` wisselt de room. `world:delta` bevat `{ simulationId, state }` en `simulation:state` bevat klokstatus. Beide worden maximaal 10 keer per echte seconde verstuurd, onafhankelijk van versnelling. Bedieningswijzigingen leveren ook direct een statusevent op. De viewer interpoleert tussen posities. In deze versie bevat een delta de complete actuele entiteitenlijst en begrensde recente acties/events; opslag en verdere deltacompressie volgen later.

De engine bewaart maximaal 512 actierecords (open acties blijven behouden), 200 recente globale events en 100 waargenomen events per agent. De netwerktoestand bevat maximaal 60 recente acties en 40 recente events. Dit is geen duurzame replaylog.

Technische referenties: [Hono Node-adapter](https://hono.dev/docs/getting-started/nodejs), [Socket.IO rooms](https://socket.io/docs/v4/rooms/), [Zod](https://zod.dev/basics), [Vite](https://vite.dev/guide/).
