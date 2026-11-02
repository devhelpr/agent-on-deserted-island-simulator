# Agent Island — backlog

Bron: [technisch projectontwerp v1.0](docs/architecture-v1.md). De zes technische mijlpalen zijn hieronder vertaald naar zes sprints. Sprintlengte en kalenderplanning zijn nog niet vastgesteld.

## Fase 1 / Sprint 1 — World Engine + eiland

Doel: een browser toont het eiland; de server beheert alle posities; één scripted testagent beweegt.

- [x] S1.1 npm-workspaces opzetten voor client, server en gedeelde contracten; strikte TypeScript-configuratie.
- [x] S1.2 Vite-client en Hono-server starten met één lokaal dev-commando.
- [x] S1.3 REST-healthcheck en wereldsnapshot aanbieden; Vite-proxy voor `/api` en `/socket.io`.
- [x] S1.4 Gedeelde DTO's en getypeerde Socket.IO-events vastleggen.
- [x] S1.5 Versie 1 van een deterministische wereldgenerator: seed 48291, 500 × 500 m, heightmap, 120 bomen, 80 rotsen, 12 artefacten, 1 grot.
- [x] S1.6 Initiële werelddefinitie en mutabele agenttoestand scheiden; alleen World Engine wijzigt posities.
- [x] S1.7 Eén scripted Alpha met een vrije route en terreinvolgende beweging implementeren.
- [x] S1.8 Three.js-viewer bouwen met terrein, objecten, agent, vrije camera en agentfocus.
- [x] S1.9 Snapshot bij verbinden/herverbinden; live toestand op 10 Hz; positie-interpolatie in de viewer.
- [x] S1.10 Determinisme, onafhankelijke snapshots, beweging en REST/Socket.IO-integratie testen.
- [x] S1.11 Typecheck, 8 tests, productiebuild en browseracceptatie afronden; zie [acceptatieverslag](docs/sprint-1-acceptance.md).

Scope: de minimale realtime-runner gebruikt stappen van 50 ms. Alpha volgt een vrije centrale route; botsingen, navmesh, acties, snelheidsregeling en cyclusbeheer horen bij sprint 2 en later. Er draaien nog geen Codex-agents. De volledige wereldsnapshot is voor de menselijke viewer; toekomstige agenttools krijgen beperkte perceptie.

## Fase 2 / Sprint 2 — Simulation Clock + acties

- [x] S2.1 SimulationClock met wall time, virtuele tijd, accumulator, pauzeren/hervatten en 1×–20×; gedrag bij achterstand expliciet maken.
- [x] S2.2 Live- en experimentmodus: beslisbarrières en vaste verwerkingsvolgorde.
- [x] S2.3 Navmesh + A*, botsingen en onbereikbare doelen afhandelen.
- [x] S2.4 Centrale actiewachtrij; action-ID, statusmodel, annulering en tie-breaking op agent-ID.
- [x] S2.5 Perceptie: 25 m, 120°, occlusie, interactieafstand en zichtbare gebeurtenissen.
- [x] S2.6 Atomisch inspecteren, interacteren, oppakken en neerleggen; bezit en bereik valideren met Zod.
- [x] S2.7 Drie scripted agents en conflicttests voor hetzelfde object.
- [x] S2.8 Simulatiebeheer-API, rooms, bounded netwerkupdates en bediening in dashboard.

Acceptatie gehaald: drie scripted agents bewegen en reageren tegelijk zonder tegenstrijdige wereldtoestand. Zie [acceptatieverslag mijlpaal 2](docs/sprint-2-acceptance.md).

## Fase 3 / Sprint 3 — Codex-integratie

- [x] S3.1 Codex app-serveradapter met thread/turn-lifecycle, hervatten, time-outs en foutregistratie.
- [x] S3.2 World MCP-package met observe/move/inspect/interact/pickup/drop/communicate en gevalideerde input.
- [x] S3.3 Agentidentiteit serverzijdig binden; geen volledige objectlijst, andere geheugens of directe wereldmutaties.
- [x] S3.4 Shell- en bestandstoegang uitschakelen of isoleren; toolrechten beperken.
- [x] S3.5 Event-driven scheduler, maximaal één actieve turn per agent en centrale actieafhandeling.
- [x] S3.6 Beslissingen, waarnemingen, opgegeven motivatie, toolresultaten en fouten registreren.
- [x] S3.7 Scripted policy behouden voor kosteloze integratietests; vastgelopen turns testen.

Acceptatie gehaald: één echte Codex-agent verkende 15 minuten simulatietijd, met 13 modelbeslissingen en 10 geslaagde verplaatsingen. Zie [acceptatieverslag mijlpaal 3](docs/sprint-3-acceptance.md).

## Fase 4 / Sprint 4 — Geheugen + reset

- [x] S4.1 SQLite + Drizzle-migraties voor werelden, runs, cycli, agents, sessies, herinneringen, revisies, events, snapshots, beslissingen en toolcalls.
- [x] S4.2 Per-agent episodisch, semantisch en procedureel geheugen met FTS, confidence, importance en bron-events.
- [x] S4.3 Observed/inferred/reported onderscheiden; duplicaten en tegenspraak beheren.
- [x] S4.4 Context samenstellen uit samenvatting, relevante herinneringen, recente ervaringen en doelen.
- [x] S4.5 Herhaalbare consolidatie met unieke sleutel cycleId + agentId.
- [x] S4.6 Cyclus op 72.000 ticks afsluiten: nieuwe acties weigeren, lopende acties/turns annuleren, eindsnapshot opslaan.
- [x] S4.7 Beginwereld herstellen, geheugen behouden en nieuwe threads starten met geheugenoverzicht.
- [x] S4.8 Crashherstel en transactionele koppeling tussen geaccepteerde acties, mutaties en events testen.
- [x] S4.9 Memory-tab en geheugen-/beslissingsendpoints bouwen; isolatie tussen agents testen.

Acceptatie gehaald met een deterministische, perceptiegebaseerde integratietest: een agent vindt een grot en navigeert er na reset met opgeslagen geheugen opnieuw naartoe. Zie [acceptatieverslag mijlpaal 4](docs/sprint-4-acceptance.md).

## Fase 5 / Sprint 5 — Replay Engine

- [x] S5.1 Append-only eventlog met unieke, oplopende sequence per cyclus.
- [x] S5.2 Begin-/eindsnapshot en periodieke snapshots elke 1.200 ticks; generator-, navigatie- en physicsversies bewaren.
- [x] S5.3 Wereld reconstrueren vanuit snapshot + events, zonder nieuwe modelaanroepen.
- [x] S5.4 Canonieke state-hash, stabiele volgorde en positieprecisie vastleggen; hashes op controlepunten testen.
- [x] S5.5 Replay-API, afspeelsnelheid, seek-tijdlijn en vrije camera.
- [x] S5.6 Agent POV, Decision Inspector en Discovery Map.
- [x] S5.7 Replaygelijkheid onafhankelijk van afspeelsnelheid testen.

Acceptatie gehaald: volledige 72.000-tickcyclus terugspoelen met exact gelijke hashes op 61 minuutcontrolepunten, onafhankelijk van seekvolgorde. Zie [acceptatieverslag mijlpaal 5](docs/sprint-5-acceptance.md).

## Fase 6 / Sprint 6 — Multi-agent experimenten

- [x] S6.1 Drie autonome Codex-agents met eigen threads en geheugens laten samenwerken.
- [x] S6.2 Communicatiebereik, berichten en gedeelde objectinteracties vastleggen.
- [x] S6.3 Experimentconfiguratie voor meerdere cycli met vaste seed en begrensde beslisbudgetten.
- [x] S6.4 Gebruiksregistratie, voortgang, fouten en experimentresultaten zichtbaar maken.
- [x] S6.5 Live/Timeline/Memory/Replay en vergelijking tussen cycli afronden.
- [x] S6.6 Metrics voor ontdekkingen, herbezoeken, samenwerking en betrouwbaarheid van geheugen.
- [x] S6.7 Onbewaakte duurtest: volledige eerste cyclus, reset en aantoonbaar geheugengebruik in cyclus twee.

Acceptatie gehaald: een deterministische duurtest rondt twee volledige cycli af. Drie echte Codex-agents doorliepen een volledige eerste cyclus en reset; alle drie gebruikten in cyclus twee aantoonbaar opgeslagen geheugendoelen. Zie het [acceptatieverslag mijlpaal 6](docs/sprint-6-acceptance.md) en de [live resultaten](docs/sprint-6-live-result.json).

## Buiten V1

- Volledige rigid-body physics, survival, uitgebreid crafting, dag/nacht, weer, multimodale screenshots, procedurele missies en extra NPC-systemen.
