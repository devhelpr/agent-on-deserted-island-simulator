# Agent Island: technisch projectontwerp



Architectuurvoorstel v1.0

> Implementatie-update: generator v4 biedt een voorwerpentas met 24 plekken per agent (36 met een draagmand), vijf vindbare materialen en acht recepten. Agents kunnen materialen verzamelen uit bomen en rotsen, tussenproducten maken en gereedschap, een werkbank en verlichting gebruiken. De tas wordt uitsluitend in het dashboard getoond, met een samenvatting en ‘Toon inhoud’ per agent. Zie de README voor de actuele recepten en spelregels; de tekst hieronder beschrijft het oorspronkelijke ontwerp.

TypeScript

Local-first

Multi-agent



Maikel, ik zou Agent Island ontwikkelen als een autonoom multi-agent simulatieplatform met een 3D-wereld als experimenteeromgeving.

Het gaat dus verder dan een Three.js-game. Je bouwt een systeem waarin je kunt onderzoeken hoe meerdere Codex-agents zelfstandig een onbekende omgeving ontdekken, ervaringen opslaan en hun gedrag over opeenvolgende simulaties aanpassen.

Mijn belangrijkste architectuurkeuze: scheid de snelheid waarmee Codex denkt volledig van de snelheid waarmee de wereld beweegt.

Dat maakt zowel realtime simulaties als versnelde experimenten mogelijk.

## 1. Technische keuzes

Ik zou dicht bij je bestaande stack blijven.

| Onderdeel           | Technologie                 | Verantwoordelijkheid               |
| ------------------- | --------------------------- | ---------------------------------- |
| Frontend            | Vite + TypeScript           | Dashboard en interface             |
| 3D-rendering        | Three.js                    | Eiland en agentanimaties           |
| World server        | Node.js + Hono              | Autoritatieve wereldtoestand       |
| Realtime verbinding | Socket.IO                   | Wereldupdates naar browser         |
| Agent runtime       | Codex app-server            | Agentbeslissingen en sessies       |
| Agent tools         | Eigen MCP-server            | Beperkte interactie met de wereld  |
| Database            | SQLite + Drizzle            | Agentgeheugen en simulatiegegevens |
| Simulatie           | Eigen fixed-timestep engine | Tijd, beweging en interacties      |
| Navigatie           | Navmesh + A\*               | Padberekening en obstakels         |
| Replay              | Eventlog + snapshots        | Simulaties terugkijken             |
| Validatie           | Zod                         | Toolinput en API-contracten        |

Voor de Codex-integratie kies ik bewust app-server. Volgens de officiële OpenAI Docs kun je hiermee threads beheren, turns starten, gebeurtenissen ontvangen en agents via eigen tools toegang geven tot applicatiefuncties.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://developers.openai.com\&sz=32)

OpenAI Developers



Voor de eerste versie zou ik nog geen zware physics-engine gebruiken. Een heightmap, navmesh, eenvoudige botsingsdetectie en enkele interactieregels zijn voldoende.

Later kun je Rapier toevoegen voor bijvoorbeeld vallende stenen en fysieke objectinteracties.

## 2. Systeemarchitectuur


Het belangrijkste principe is dat uitsluitend de World Engine de wereld mag wijzigen.

Een agent kan verzoeken om een steen op te pakken, maar kan niet rechtstreeks de objectpositie aanpassen.

De World Engine controleert:

- Bevindt de agent zich dichtbij genoeg?
- Is het object beschikbaar?
- Kan het worden opgepakt?
- Draagt een andere agent het al?
- Is de actie mogelijk volgens de spelregels?

Vervolgens past de server de wereldtoestand aan en registreert de uitkomst.

Zo voorkom je inconsistenties wanneer meerdere agents tegelijk met hetzelfde object interacteren.

## 3. Projectstructuur

Ik zou een monorepo met npm workspaces gebruiken.

```
agent-island/
├── apps/
│   ├── client/
│   │   ├── src/
│   │   │   ├── world/
│   │   │   │   ├── IslandScene.ts
│   │   │   │   ├── TerrainRenderer.ts
│   │   │   │   ├── AgentRenderer.ts
│   │   │   │   └── CameraController.ts
│   │   │   ├── dashboard/
│   │   │   ├── replay/
│   │   │   └── main.ts
│   │   └── vite.config.ts
│   │
│   └── server/
│       └── src/
│           ├── api/
│           ├── world/
│           │   ├── WorldEngine.ts
│           │   ├── WorldState.ts
│           │   ├── NavigationSystem.ts
│           │   └── InteractionSystem.ts
│           ├── simulation/
│           │   ├── SimulationClock.ts
│           │   ├── CycleManager.ts
│           │   └── TickScheduler.ts
│           ├── agents/
│           │   ├── AgentManager.ts
│           │   ├── CodexAdapter.ts
│           │   └── AgentScheduler.ts
│           ├── memory/
│           ├── replay/
│           ├── persistence/
│           └── index.ts
│
├── packages/
│   ├── shared/
│   │   ├── types/
│   │   ├── schemas/
│   │   └── events/
│   └── world-mcp/
│       ├── tools/
│       └── server.ts
│
├── data/
│   ├── worlds/
│   └── agent-island.sqlite
│
├── package.json
└── tsconfig.json
```

De frontend is een zelfstandige Vite-app. De backend start je apart.

Een Vite-proxy routeert `/api` en de Socket.IO-verbinding naar de lokale server. Browserclients communiceren nooit rechtstreeks met Codex.

# 4. De simulatieklok

Dit is technisch een van de interessantste onderdelen.

We willen twee uitvoermodi ondersteunen:

Realtime

# 1×

60 minuten simulatietijd kosten 60 echte minuten.

Accelerated

# 10×

60 minuten simulatietijd kosten idealiter 6 echte minuten.

Simulatiesnelheid

1×2×5×10×20×

Ideale duur van één simulatiecyclus

# 6 minuten

Exclusief eventuele vertraging door modelaanroepen of systeemcapaciteit.

## Virtual time versus wall-clock time

We onderscheiden:

- `wallTime`: echte verstreken tijd.
- `simulationTime`: tijd binnen de wereld.
- `timeScale`: gewenste versnellingsfactor.
- `tick`: de huidige simulatiestap.

Ik zou een vaste simulatiestap van 50 ms gebruiken, oftewel 20 ticks per gesimuleerde seconde.

```
interface SimulationConfig {
  mode: "realtime" | "accelerated";
  timeScale: number;

  tickDurationMs: 50;
  cycleDurationMs: 3_600_000;

  maxAgents: number;
  worldSeed: number;
}
```

De simulatie is volledig gekoppeld aan virtuele tijd.

Een beweging die normaal 10 seconden simulatietijd kost, duurt:

| Snelheid | Ideale echte duur |
| -------- | ----------------- |
| 1×       | 10 seconden       |
| 2×       | 5 seconden        |
| 5×       | 2 seconden        |
| 10×      | 1 seconde         |
| 20×      | 0,5 seconde       |

### Een belangrijke beperking

Codex kan niet gegarandeerd twintig keer sneller nadenken.

Als een agent vijf seconden nodig heeft om een beslissing te nemen, kan je simulatie bij 20× al honderd seconden virtuele tijd zijn opgeschoten.

Daarom stel ik twee modi voor binnen de scheduler:

Live mode

De wereldklok blijft lopen. Agents kunnen tijdens het nadenken stilstaan. Dit simuleert asynchrone besluitvorming.

Experiment mode

De simulatie wordt op logische beslismomenten tijdelijk geblokkeerd totdat de benodigde agentbeslissingen beschikbaar zijn.

Dit levert een beter reproduceerbaar experiment op en voorkomt dat modelvertraging het gedrag beïnvloedt.

Mijn voorkeur:

- Realtime kijken: Live mode.
- Versnelde experimenten: Experiment mode met een zo snel mogelijke virtuele klok.

In Experiment mode worden alle benodigde besluiten voor een tick verzameld en vervolgens in een vaste volgorde verwerkt. Zo bepaalt netwerkvertraging niet welke agent als eerste een object krijgt.

De replay gebruikt altijd de geregistreerde simulatieticks, nooit de echte verwerkingstijden.

# 5. Het wereldmodel

We modelleren het eiland als een verzameling entiteiten, met een vaste initiële toestand.

## World definition

```
interface WorldDefinition {
  id: string;
  version: number;
  seed: number;

  terrain: {
    width: number;
    depth: number;
    heightmap: string;
    navigationMesh: string;
  };

  spawnPoints: Vector3[];
  entities: WorldEntity[];
}

interface Vector3 {
  x: number;
  y: number;
  z: number;
}

interface WorldEntity {
  id: string;

  type:
    | "rock"
    | "tree"
    | "wood"
    | "cave"
    | "water"
    | "artifact";

  position: Vector3;

  properties: {
    movable?: boolean;
    collectable?: boolean;
    inspectable?: boolean;
    weight?: number;
  };

  state: Record<string, unknown>;
}
```

Voor de eerste versie zou ik het eiland opbouwen uit een heightmap en een deterministische objectgenerator.

Bijvoorbeeld:

```
const world = generateWorld({
  seed: 48291,
  size: 500,
  trees: 120,
  rocks: 80,
  artifacts: 12,
  caves: 1
});
```

Dezelfde seed, generatorversie en configuratie moeten exact dezelfde beginwereld opleveren.

Wel zou ik voor iedere cyclus de wereldseed standaard gelijk houden. Anders wordt het moeilijk om vast te stellen of agents beter navigeren door hun geheugen of simpelweg een gemakkelijker eiland aantreffen.

Later kun je experimenten met veranderende eilanden toevoegen.

## World state

De initiële werelddefinitie is onveranderlijk. Daarbovenop ligt een tijdelijke toestand:

```
interface WorldState {
  cycleId: string;
  tick: number;
  simulationTimeMs: number;

  entities: Map<string, EntityState>;
  agents: Map<string, AgentState>;

  pendingActions: WorldAction[];
}
```

Bij een reset wordt deze tijdelijke toestand vervangen door een nieuwe instantie van de oorspronkelijke wereld.

De agentgeheugens blijven onaangetast.

# 6. Agent runtime: hoe Codex daadwerkelijk handelt

Ik zou geen enkele Codex-thread gebruiken die meerdere agents speelt.

Iedere agent krijgt zijn eigen persistente thread, onafhankelijk geheugen en eigen toolrechten.

```
interface AgentDefinition {
  id: string;
  name: string;

  codexThreadId: string;

  personalityPrompt: string;
  memoryNamespace: string;

  status:
    | "idle"
    | "thinking"
    | "executing"
    | "waiting"
    | "failed";
}
```

De `CodexAdapter` is verantwoordelijk voor:

1. Een thread aanmaken of hervatten.
2. Een waarneming aanbieden.
3. Een agentturn starten.
4. Toolaanroepen verwerken.
5. Beslissingen en fouten registreren.
6. De agent weer inplannen.

De wereld zelf weet niets van Codex. Daardoor kun je later ook andere modellen of eenvoudige scripted agents gebruiken.

## Perceptiesysteem

Een agent mag uitsluitend zijn eigen omgeving waarnemen.

Bijvoorbeeld:

```
interface AgentObservation {
  tick: number;
  agentId: string;

  position: Vector3;
  orientation: number;

  visibleEntities: {
    id: string;
    type: string;
    distance: number;
    direction: number;
    description: string;
  }[];

  visibleAgents: {
    id: string;
    distance: number;
  }[];

  recentEvents: ObservedEvent[];
}
```

De server bepaalt welke objecten binnen het zichtveld liggen.

Voor V1:

- Zichtafstand: 25 meter.
- Zichthoek: 120 graden.
- Obstakels blokkeren het zicht.
- Agents kunnen objecten achter zich niet zomaar waarnemen.
- Een object kan pas worden geïnspecteerd als het binnen interactieafstand ligt.

Agentgeheugen en actuele waarneming blijven gescheiden.

Als een agent zich een grot herinnert maar deze niet kan zien, hoort de grot niet in `visibleEntities` te staan.

## De World MCP-tools

Ik zou beginnen met zeven tools.

| Tool                | Input                       | Resultaat                                       |
| ------------------- | --------------------------- | ----------------------------------------------- |
| `world_observe`     | Richting of interessegebied | Actuele waarneming                              |
| `world_move`        | Doelpositie                 | Beweging gestart of geweigerd                   |
| `world_inspect`     | Entity ID                   | Objecteigenschappen binnen waarneembare grenzen |
| `world_interact`    | Entity ID + actie           | Resultaat van interactie                        |
| `world_pickup`      | Entity ID                   | Object toegevoegd aan inventaris                |
| `world_drop`        | Entity ID                   | Object neergelegd                               |
| `world_communicate` | Ontvanger + bericht         | Bericht afgeleverd of geweigerd                 |

De agent krijgt geen tools waarmee hij rechtstreeks de database, world seed of volledige objectlijst kan lezen.

Ook zou ik shelltoegang en bestandstoegang voor deze agentthreads uitschakelen of strikt isoleren. Codex is van oorsprong een coding agent, maar in dit experiment moet hij zich als eilandbewoner gedragen.

### Een toolaanroep

```
const action = {
  type: "move",
  agentId: "alpha",
  target: {
    x: 120,
    y: 0,
    z: 85
  }
};

const result = await world.submitAction(action);
```

De world server kan antwoorden:

```
{
  "accepted": true,
  "actionId": "act_0192",
  "status": "moving",
  "estimatedDurationMs": 14200
}
```

Die duur is in simulatietijd.

Codex hoeft niet op iedere bewegingsstap te reageren.

Wanneer de agent arriveert of iets belangrijks waarneemt, ontvangt hij een nieuwe gebeurtenis en kan hij opnieuw beslissen.

# 7. Agent Scheduler

Dit onderdeel coördineert de autonomie.

Een mogelijke implementatie:

```
class AgentScheduler {
  async onAgentReady(agent: AgentState) {
    const observation =
      await this.world.observe(agent.id);

    const memories =
      await this.memory.retrieveRelevant(
        agent.id,
        observation
      );

    const decision =
      await this.codex.requestDecision({
        agent,
        observation,
        memories
      });

    await this.actionQueue.enqueue({
      agentId: agent.id,
      decision
    });
  }
}
```

Dit is bewust pseudocode op applicatieniveau. `requestDecision()` is een eigen wrapper rond de app-serverprotocolaanroepen, geen bestaande Codex-methode.

## Wanneer krijgt Codex een nieuwe beurt?

Niet op ieder tick, maar op gebeurtenissen:

- De agent bereikt zijn bestemming.
- Hij ontdekt een nieuw object.
- Een interactie is afgerond.
- Een andere agent spreekt hem aan.
- Zijn gekozen actie is onmogelijk.
- Hij heeft langere tijd niets gedaan.
- Een nieuwe cyclus begint.

Dat noem ik een event-driven decision loop.

Er kunnen meerdere agents tegelijk nadenken, maar de World Engine verwerkt hun acties centraal en deterministisch.

Voor iedere actie gebruiken we een statusmodel:


De scheduler bewaart daarnaast per agent maximaal één actieve Codex-turn. Zo voorkom je overlappende beslissingen binnen dezelfde thread.

Belangrijk voor experimenten: ik zou agentacties laten verlopen via een centrale wachtrij met vaste tie-breaking op agent-ID. Als twee agents op exact dezelfde tick dezelfde steen willen oppakken, is de uitkomst daarmee voorspelbaar.

# 8. Geheugenarchitectuur

Ik zou het geheugen niet uitsluitend in Codex-conversatiegeschiedenis bewaren.

Gebruik een eigen persistente geheugenlaag in SQLite.

De Codex-thread bevat nuttige context, maar de database is de bron van waarheid voor blijvende kennis.

## Drie soorten geheugen

```
type MemoryType =
  | "episodic"
  | "semantic"
  | "procedural";

interface AgentMemory {
  id: string;
  agentId: string;
  cycleId: string;

  type: MemoryType;
  content: string;

  confidence: number;

  sourceEventIds: string[];
  createdAtTick: number;

  importance: number;
  supersededBy?: string;
}
```

Een agent kan bijvoorbeeld onthouden:

```
{
  "agentId": "alpha",
  "type": "semantic",
  "content": "Achter de noordelijke rots ligt een grot.",
  "confidence": 0.92,
  "importance": 0.85
}
```

Maar ook:

```
{
  "agentId": "alpha",
  "type": "procedural",
  "content": "De grot is bereikbaar door eerst langs de oostkant van de rotsformatie te lopen.",
  "confidence": 0.76,
  "importance": 0.9
}
```

## Memory consolidation

Aan het einde van een cyclus:

1. De agent krijgt een overzicht van zijn eigen gebeurtenissen.
2. Codex formuleert belangrijke herinneringen.
3. De Memory Manager koppelt claims aan brongebeurtenissen.
4. Duplicaten worden samengevoegd.
5. Tegenstrijdige herinneringen worden gemarkeerd.
6. De nieuwe geheugenversie wordt opgeslagen.

Ik zou hierbij onderscheid maken tussen:

- `observed`: rechtstreeks waargenomen.
- `inferred`: door de agent afgeleid.
- `reported`: door een andere agent verteld.

Dit maakt het mogelijk dat een agent onjuiste aannames ontwikkelt of informatie van een andere agent gelooft.

Dat is juist interessant om terug te zien.

Het geheugen mag dus feilbaar zijn. Alleen de onderliggende geregistreerde gebeurtenissen zijn feitelijke simulatiehistorie.

### Context samenstellen bij een nieuwe cyclus

Ik zou niet alle herinneringen terugsturen.

Gebruik:

- Een compacte langetermijnsamenvatting.
- De meest relevante herinneringen bij de huidige waarneming.
- Enkele recente ervaringen.
- Een beperkt aantal openstaande eigen doelen.

Voor V1 is SQLite FTS voldoende om herinneringen tekstueel te doorzoeken. Vector embeddings zijn een mogelijke latere uitbreiding.

# 9. Dataopslag

SQLite is voor dit project een prima keuze.

Ik zou de volgende tabellen maken:

| Tabel               | Belangrijkste velden                             |
| ------------------- | ------------------------------------------------ |
| `world_definitions` | id, version, seed, configuration                 |
| `simulation_runs`   | id, mode, time_scale, started_at, status         |
| `simulation_cycles` | id, run_id, index, started_at, ended_at, outcome |
| `agents`            | id, name, configuration                          |
| `agent_sessions`    | agent_id, thread_id, run_id                      |
| `agent_memories`    | id, agent_id, type, content, confidence          |
| `memory_revisions`  | memory_id, revision, source_event_ids            |
| `world_events`      | cycle_id, tick, sequence, event_type, payload    |
| `world_snapshots`   | cycle_id, tick, serialized_state                 |
| `agent_decisions`   | agent_id, cycle_id, tick, observation, decision  |
| `tool_calls`        | decision_id, tool_name, arguments, result        |

Voor de eventlog zou ik een append-only structuur gebruiken.

```
interface WorldEvent {
  id: string;

  cycleId: string;
  tick: number;
  sequence: number;

  type: WorldEventType;

  actorId?: string;
  targetId?: string;

  payload: unknown;
}
```

Iedere event krijgt binnen een cyclus een unieke, oplopende sequence.

Zo kunnen twee acties die plaatsvinden op dezelfde tick toch altijd in dezelfde volgorde worden teruggespeeld.

Voor betrouwbaarheid worden geaccepteerde acties en hun uiteindelijke wereldmutaties in transacties vastgelegd. Een crash mag niet leiden tot een wereldwijziging zonder bijbehorend event.

# 10. REST API en WebSocket-events

Ik zou de REST API gebruiken voor opdrachten en historische gegevens. Socket.IO gebruik je voor live statusupdates.

## REST-endpoints

### Simulatiebeheer

| Methode | Endpoint                      | Functie                    |
| ------- | ----------------------------- | -------------------------- |
| `POST`  | `/api/simulations`            | Nieuwe simulatie starten   |
| `GET`   | `/api/simulations`            | Simulaties opvragen        |
| `GET`   | `/api/simulations/:id`        | Status en configuratie     |
| `POST`  | `/api/simulations/:id/pause`  | Pauzeren                   |
| `POST`  | `/api/simulations/:id/resume` | Hervatten                  |
| `POST`  | `/api/simulations/:id/stop`   | Stoppen                    |
| `PATCH` | `/api/simulations/:id/speed`  | Simulatiesnelheid wijzigen |
| `POST`  | `/api/simulations/:id/reset`  | Cyclus handmatig resetten  |

### Wereld en agents

| Methode | Endpoint                      | Functie                 |
| ------- | ----------------------------- | ----------------------- |
| `GET`   | `/api/worlds`                 | Beschikbare eilanden    |
| `GET`   | `/api/simulations/:id/world`  | Actuele wereldstatus    |
| `GET`   | `/api/simulations/:id/agents` | Agentstatussen          |
| `GET`   | `/api/agents/:id/memories`    | Agentherinneringen      |
| `GET`   | `/api/agents/:id/decisions`   | Beslissingsgeschiedenis |

### Replay

| Methode | Endpoint                         | Functie                       |
| ------- | -------------------------------- | ----------------------------- |
| `GET`   | `/api/cycles/:id`                | Cyclusinformatie              |
| `GET`   | `/api/cycles/:id/events`         | Gebeurtenissen                |
| `GET`   | `/api/cycles/:id/snapshots`      | Beschikbare snapshots         |
| `GET`   | `/api/cycles/:id/state?tick=500` | Wereld op een specifieke tick |
| `GET`   | `/api/cycles/:id/decisions`      | Agentbeslissingen             |

## Nieuwe simulatie starten

```
POST /api/simulations
Content-Type: application/json
```

```
{
  "worldId": "island-01",
  "mode": "accelerated",
  "timeScale": 10,
  "cycleDurationMs": 3600000,
  "maxCycles": 12,
  "agentIds": [
    "alpha",
    "beta",
    "gamma"
  ]
}
```

Bij succesvolle verwerking:

```
{
  "simulationId": "sim_001",
  "status": "running",
  "currentCycle": 1
}
```

### Socket.IO

Ik zou met rooms werken:

```
socket.join(`simulation:${simulationId}`);
```

De server verstuurt onder andere:

```
type ServerEvents = {
  "simulation:state": SimulationStatus;
  "world:snapshot": WorldStateDto;
  "world:delta": WorldDelta;
  "agent:state": AgentStateDto;
  "agent:decision": AgentDecisionDto;
  "cycle:completed": CycleSummary;
  "cycle:started": CycleInfo;
};
```

Niet alle objecten hoeven twintig keer per seconde te worden verstuurd.

Een efficiëntere aanpak:

- World Engine: 20 ticks per seconde.
- Netwerk: standaard 5 tot 10 updates per seconde.
- Browser: interpolatie tussen ontvangen posities.
- Onmiddellijke events voor belangrijke ontdekkingen.

Voor versnelde simulaties zou ik de netwerkfrequentie begrenzen. Bij 20× hoeven geen 400 wereldticks per echte seconde naar de browser.

# 11. Replay Engine

Ik zou een event-sourced replaymechanisme combineren met periodieke snapshots.

Replay-opbouw


Een replay reconstrueert opgeslagen wereldtoestanden. Codex hoeft niet opnieuw te beslissen.

Een mogelijke snapshotconfiguratie:

```
const replayConfig = {
  snapshotIntervalTicks: 1200,
  recordDecisions: true,
  recordObservations: true,
  recordToolCalls: true,
  recordWorldEvents: true
};
```

Bij 20 ticks per simulat seconde is 1.200 ticks precies één simulatieminut.

Een cyclus van 60 minuten bevat:

- 72.000 ticks.
- 60 periodieke snapshots.
- Een variabel aantal acties en events.
- Een begin- en eindsnapshot.

## Wat moet je kunnen terugkijken?

Ik zou vier weergavemodi maken.

Free Camera

Vrij rondvliegen boven het eiland. Alle agents volgen, ongeacht hun eigen zichtveld.

Agent POV

Bekijk uitsluitend wat één agent destijds kon waarnemen.

Decision Inspector

Bekijk de waarneming, relevante herinneringen, vastgelegde motivatie, gekozen actie en het resultaat.

Discovery Map

Toon welke delen van het eiland door een agent zijn ontdekt en hoe deze kennis per cyclus groeide.

De Decision Inspector lijkt me bijzonder waardevol.

Bijvoorbeeld:

Agent Alpha

Cycle 04 · Tick 12.840

VOORBEELD VAN EEN VASTGELEGDE BESLISSING

Waarneming

Grote rotsformatie op 8 meter afstand. Smalle opening zichtbaar aan de rechterkant.

Opgehaalde herinnering

Tijdens cyclus 2 zag ik hier mogelijk een doorgang.

Vastgelegde motivatie

Ik wil onderzoeken of deze opening naar dezelfde grot leidt die ik eerder heb gevonden.

world_move(120, 0, 85)

Voltooid

Let wel: een vastgelegde motivatie is een verklaring die de agent zelf geeft, geen rechtstreekse inzage in zijn verborgen interne redenering.

## Replaybetrouwbaarheid

Dit zou ik expliciet testen.

```
expect(
  replayWorld.stateHash
).toBe(
  originalWorld.stateHash
);
```

Voor een succesvolle replay moet de gereconstrueerde wereld dezelfde canonieke state-hash hebben als de oorspronkelijke wereld op dezelfde tick.

Daarbij moet je rekening houden met floating-point-afwijkingen. Ik zou posities intern waar mogelijk in vaste eenheden opslaan, bijvoorbeeld millimeters als integers, en een stabiele verwerkingsvolgorde gebruiken.

Ook moeten de wereldgeneratorversie, navigatiegegevens en physicsversie bij iedere cyclus worden opgeslagen.

# 12. De resetprocedure

De uurlijkse reset moet een expliciet, transactioneel proces zijn.


Ik zou het zo uitvoeren:

1. De klok bereikt tick 72.000.
2. De cyclus gaat naar `closing`.
3. Nieuwe toolacties worden geweigerd met `CYCLE_CLOSING`.
4. Lopende bewegingen worden op de grens afgebroken en hun eindstatus wordt geregistreerd.
5. De resterende Codex-turns worden gecontroleerd beëindigd of geannuleerd.
6. De agentgeheugens worden geconsolideerd.
7. De cyclus krijgt status `completed`.
8. De World Engine laadt de oorspronkelijke wereld opnieuw.
9. Agents worden op hun spawnposities geplaatst.
10. De volgende cyclus begint.

Een geheugenconsolidatie die mislukt moet herhaalbaar zijn zonder dubbele herinneringen te creëren.

Daarom krijgt iedere consolidatie een unieke sleutel op basis van `cycleId + agentId`.

Belangrijk: ik zou voor V1 een nieuwe Codex-thread per agent per cyclus aanmaken, maar het externe langetermijngeheugen behouden.

Dat voorkomt dat de volledige oude conversatie automatisch wordt meegenomen en dat verschillende cycli steeds grotere contextvensters krijgen.

De nieuwe thread krijgt een geheugenoverzicht uit SQLite.

# 13. Het dashboard

Ik zie de interface als een combinatie van een 3D-simulatie en een onderzoeksdashboard.

## Agent Island

Local Simulation Lab

&#x20;Running

Cyclus

# 04 / 12

Wereldtijd

# 42:18

Snelheid

# 10×

Island viewport

Free camera

[3D Isometric Game Models Midjourney Prompt | PromptBase](https://images.openai.com/static-rsc-4/asdnwPG1H2HYPkto2MQEWTONGPOHgReBJZ19gKT2PYSDmyYzwU1Ap-PIdKccDg65iMT8XQ0EQ3f-84KjWCpkfanzaC6aOor_rdOA8dOSa-6INsvZK8sO3vY0OXtaDbbvCVH2PbY7nCdR1MRlPGqSyIc3W5G7ttZmp0WHqAY6zPE?purpose=inline)

[promptbase.com](https://promptbase.com/prompt/3d-isometric-game-models?utm_source=chatgpt.com)

Alpha

Beta

Gamma

Agents

3 actief

Alpha

Exploring

38 herinneringen

Beta

Inspecting

25 herinneringen

Gamma

Thinking

31 herinneringen

&#x20;Live events

&#x20;Memories

&#x20;Replays

&#x20;Settings

Conceptuele interface-indeling voor de Vite-app.

Ik zou vier hoofdtabbladen maken:

1. Live: huidige 3D-wereld en agentstatussen.
2. Timeline: realtime gebeurtenissen en beslissingen.
3. Memory: individuele herinneringen en kennisontwikkeling.
4. Replay: eerdere cycli terugkijken en vergelijken.

Een extra experimentoverzicht kan later grafieken tonen zoals:

- Hoeveel unieke locaties heeft iedere agent ontdekt?
- Welke objecten zijn onderzocht?
- Hoeveel van de bekende locaties werden in latere cycli opnieuw bezocht?
- Hoe vaak werken agents samen?
- Welke herinneringen blijken betrouwbaar?
- Hoe verandert het gedrag tussen cyclus 1 en cyclus 20?

# 14. Implementatieplan

Ik zou dit in zes technische mijlpalen opdelen. Iedere mijlpaal levert iets op dat je zelfstandig kunt testen.

## 01

World Engine + eiland

- Monorepo opzetten.
- Vite, Hono en Socket.IO configureren.
- Heightmap en objecten genereren.
- Autoritatieve wereldtoestand implementeren.
- 3D-viewer aansluiten.

Acceptatiecriterium

Een browser toont het eiland. De server beheert alle objectposities en een scripted testagent kan zich verplaatsen.

## 02

Simulation Clock + acties

- Fixed-timestep loop.
- Realtime en accelerated mode.
- Navmesh en padberekening.
- Actiewachtrij.
- Detectie van objecten en obstakels.
- Atomische interacties.

Acceptatiecriterium

Drie scripted agents kunnen tegelijk bewegen en op dezelfde objecten reageren zonder tegenstrijdige wereldtoestanden.

## 03

Codex-integratie

- Lokale Codex app-server koppelen.
- Eigen MCP-tools aansluiten.
- Afzonderlijke agentthreads.
- Event-driven Agent Scheduler.
- Toolrechten beperken.
- Time-outs en foutafhandeling.

Acceptatiecriterium

Eén echte Codex-agent verkent zonder handmatige prompts minimaal vijftien minuten simulatietijd.

## 04

Geheugen + reset

- SQLite-schema.
- Episodisch en semantisch geheugen.
- Geheugenconsolidatie.
- Automatische cyclusreset.
- Nieuwe threads met bestaand geheugen.
- Herstartbestendig simulatiebeheer.

Acceptatiecriterium

Een agent ontdekt een grot, de wereld reset en de agent kan op basis van zijn opgeslagen herinnering opnieuw naar die grot navigeren.

## 05

Replay Engine

- Eventlog en snapshots.
- Wereldreconstructie.
- Replay-tijdlijn.
- Vrije camera.
- Agent POV.
- Decision Inspector.

Acceptatiecriterium

Een volledige cyclus kan worden teruggespoeld en de wereldtoestand is op controlepunten exact gelijk aan het origineel.

## 06

Multi-agent experimenten

- Drie autonome Codex-agents.
- Communicatie tussen agents.
- Gedeelde objectinteracties.
- Vergelijking tussen cycli.
- Experimenteel dashboard.
- Beslisbudgetten en gebruiksregistratie.

Acceptatiecriterium

Een experiment met meerdere cycli draait zonder toezicht en produceert een navolgbare geschiedenis van acties, ontdekkingen en herinneringen.

## 15. Teststrategie

Omdat dit een AI-experiment is, zou ik de software strikt scheiden van het onvoorspelbare gedrag van Codex.

Drie testniveaus:

| Testniveau                       | Wat testen we?                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Unit tests                       | Wereldregels, zichtberekening, navigatie, tijd en geheugen                                      |
| Deterministische integratietests | Meerdere scripted agents, conflicterende acties, resets en replays                              |
| AI blackbox-tests                | Of Codex de tools correct gebruikt, leert van terugkoppeling en binnen zijn bevoegdheden blijft |

Vooral de blackbox-tests zijn relevant bij het gebruik van Codex.

Je wilt bijvoorbeeld niet testen of de agent exact dezelfde tekst produceert, maar of hij zich binnen de spelregels gedraagt.

Concrete scenario's:

- Een agent kan geen object oppakken dat 100 meter verderop ligt.
- Twee agents kunnen niet gelijktijdig eigenaar van dezelfde steen worden.
- Een agent kan geen object achter een ondoorzichtige rots inspecteren.
- Een reset verwijdert tijdelijke wereldmutaties maar behoudt herinneringen.
- Een agent kan geen geheugen van een andere agent lezen.
- Een replay blijft gelijk, ongeacht de afspeelsnelheid.
- Een vastgelopen Codex-turn blokkeert niet permanent de hele simulatie.

Ook zou ik een test bouwen waarbij Codex helemaal wordt vervangen door een scripted policy. Daarmee kun je vrijwel de hele infrastructuur testen zonder modelkosten.

# 16. Wat ik bewust buiten V1 houd

Er zijn verleidelijke uitbreidingen die ik voorlopig zou uitstellen:

- Volledige rigid-body physics.
- Survivalmechanieken zoals honger en dorst.
- Een onbeperkt crafting- en bouwsysteem (de implementatie bevat inmiddels acht vaste recepten).
- Een volledige dag/nachtcyclus.
- Dynamisch veranderend weer.
- Multimodale waarneming met screenshots.
- Procedureel gegenereerde missies.
- NPC's die geen Codex-agents zijn.

Dit zijn allemaal interessante opties, maar ze maken het lastiger om de fundamentele vraag te onderzoeken: kan een agent door ervaring zijn gedrag in een terugkerende wereld verbeteren?

Ik zou eerst bewijzen dat de basis werkt.

## Mijn concrete aanbeveling

Voor de eerste echt bruikbare versie zou ik deze configuratie kiezen:

| Instelling        | Startwaarde                                                      |
| ----------------- | ---------------------------------------------------------------- |
| Eiland            | 500 × 500 meter                                                  |
| Agents            | 3 afzonderlijke Codex-instanties                                 |
| Wereld            | Vaste seed                                                       |
| Cyclusduur        | 60 minuten simulatietijd                                         |
| Standaardsnelheid | 1×                                                               |
| Experimentmodus   | Tot 20×, afhankelijk van modelvertraging                         |
| Wereldticks       | 20 per simulat seconde                                           |
| Navigatie         | Navmesh                                                          |
| Geheugen          | SQLite, per agent gescheiden                                     |
| Resets            | Automatisch                                                      |
| Replay            | Eventlog + snapshots per minuut                                  |
| Interacties       | Bewegen, kijken, inspecteren, oppakken, neerleggen, communiceren |
| Dashboard         | Live 3D, gebeurtenissen, geheugen, replay                        |

En één extra advies vanuit mijn ervaring met dit soort architecturen: bouw de World Engine eerst volledig onafhankelijk van Codex.

Daarna sluit je de agents erop aan via een dunne adapter. Dat maakt het systeem beter testbaar, eenvoudiger te debuggen en geschikt voor latere vergelijkingen met andere agentmodellen.

De eerste echte mijlpaal is wat mij betreft deze:

> Start drie autonome agents op hetzelfde eiland, laat ze een volledige cyclus verkennen, reset alles en stel vast of ze tijdens de tweede cyclus aantoonbaar gebruikmaken van hun eerdere ervaringen.

Als dat werkt, heb je de basis van een behoorlijk bijzonder AI-experimenteerplatform.
