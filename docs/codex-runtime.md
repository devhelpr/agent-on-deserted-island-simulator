# Codex op Agent Island

Getest met Codex CLI **0.161.0**, app-server v2 en de bij die CLI gegenereerde experimentele toolcontracten. Het protocol is experimenteel; bij een CLI-upgrade horen de transport- en live acceptatietests opnieuw te draaien. Bron: [OpenAI Docs — app-server](https://learn.chatgpt.com/docs/app-server).

## Starten

De gewone app blijft standaard met scripted agents starten:

```sh
npm ci
npm run dev
```

Zorg dat `codex` op PATH staat en dat `codex login` is afgerond. De geteste login staat in het bestand `auth.json` onder `CODEX_HOME` of standaard `~/.codex`. Alleen een login in de OS-keychain zonder dit bestand wordt niet automatisch overgenomen. Een bestaande `OPENAI_API_KEY` in de serveromgeving is ook bruikbaar. Sleutels worden niet via het dashboard ingevoerd of teruggestuurd.

Kies in het dashboard bij **Nieuwe run met** de optie **Codex Alpha + 2 scripted** en klik op **Nieuwe run**. Dit start echte modelaanroepen met de bestaande login. Alle Codex-agents gebruiken `gpt-6-luna` met `model_reasoning_effort = "high"`, vast ingesteld in de geïsoleerde runtimeconfiguratie (`IsolatedRuntime.ts`). De instelling geldt zodra een nieuwe runtime wordt gestart; herstart de server om ook bestaande runtimes te vervangen. `AGENT_ISLAND_CODEX_BIN` kan de executablelocatie instellen, serverzijdig via de omgeving.

De API kan een andere set eilandagents kiezen:

Kies **Alleen Codex Alpha** voor één echte agent zonder andere bewoners. Deze modus stuurt `agentCount: 1` en `codexAgentIds: ["alpha"]`; de standaard is drie bewoners. Beta en Gamma worden niet aangemaakt en verschijnen niet in de wereld, agentkaarten, filters of replay-POV-keuzes. De populatie blijft behouden bij cyclusreset en serverherstart.

```json
{
  "controller": "codex",
  "codexAgentIds": ["alpha"],
  "schedulerMode": "experiment",
  "timeScale": 20
}
```

Stuur dit naar `POST /api/simulations`. De overige agents blijven scripted. Stoppen beëindigt de modelruntime en verwijdert zijn tijdelijke bestanden. Pauzeren stopt de wereldklok en nieuwe besluiten; een reeds lopende modelturn kan nog afronden, maar zijn voorstel wordt pas na hervatten uitgevoerd. Wisselen van besluitmodus annuleert open besluiten.

## Architectuur

1. De bestaande scheduler vraagt alleen bij een nieuwe actiegrens een besluit aan. Per agent kan één modelverzoek openstaan.
2. CodexAdapter start een privé app-serverproces via JSONL over stdio, voert de initialize/initialized-handshake uit en maakt één thread per Codex-agent.
3. Latere turns hervatten dezelfde thread. Na een procesuitval kan de runtime opnieuw starten en threads binnen dezelfde tijdelijke runtime-home hervatten. Een volledige serverherstart is nog geen duurzaam herstel; dat hoort bij mijlpaal 4.
4. Iedere turn krijgt uitsluitend de gefilterde waarneming, eigen inventaris, eigen vorige actieresultaat en ontvangen berichten.
5. Het model retourneert een strikt gevalideerd JSON-besluit met `action` en een korte publieke `motivation`. De adapter zet dit om in de overeenkomstige wereld-MCP-aanroep.
6. Een interne MCP-client en MCP-server communiceren via de SDK InMemoryTransport. De sessie is aan deze ene agentwaarneming gebonden en accepteert maximaal één actievoorstel.
7. De scheduler dient het voorstel centraal in. Afstand, zicht, eigendom, obstakels en conflicten worden opnieuw door World Engine gecontroleerd. De volgende waarneming bevat `lastAction`, inclusief uitvoering, fout of inspectieresultaat.

Codex krijgt geen dynamische wereldtools aangeboden en retourneert uitsluitend
het gestructureerde JSON-besluit. De host valideert dit en voert zelf de
wereld-MCP-aanroep uit. Modeltoolrequests worden afgewezen. Dit voorkomt een
extra modelronde voor het verwerken van een toolresultaat. De Code Mode-host
blijft expliciet uitgeschakeld. Modeltekst zonder geldig JSON-besluit leidt
niet tot een wereldactie.

De outputschema's gebruiken een unie met `anyOf`, omdat de geteste strikte modelrespons de door Zod-discriminatedUnion gegenereerde `oneOf` afwees. Runtimevalidatie blijft strikt.

## Wereldtools

`packages/world-mcp` is een echte MCP-server met gevalideerde tools. De naam van de actor komt uit de sessie, nooit uit modelargumenten. Er is geen openbare MCP-HTTP-poort.

| Tool                | Functie                                            |
| ------------------- | -------------------------------------------------- |
| `world_observe`     | Alleen de eigen gefilterde turnwaarneming          |
| `world_move`        | Een doelpositie voorstellen                        |
| `world_inspect`     | Inspectie van een geobserveerd object voorstellen  |
| `world_interact`    | Een geobserveerd artefact activeren                |
| `world_pickup`      | Een geobserveerde steen oppakken                   |
| `world_drop`        | Een eigen inventarisobject neerleggen              |
| `world_communicate` | Bericht aan een momenteel zichtbare agent          |
| `world_look`        | Draaien, met nieuwe waarneming in de volgende turn |
| `world_wait`        | Virtueel wachten                                   |

Verborgen object-ID's kunnen niet via inspectieverzoeken worden afgetast: de MCP-grens vereist dat het object in deze waarneming voorkomt. Communicatie vereist een zichtbare ontvanger; World Engine controleert dit opnieuw bij uitvoering. Berichten staan uitsluitend in de inbox van de ontvanger. Bereik is voorlopig hetzelfde als zicht (25 m, 120° en objectocclusie); uitgebreidere communicatie hoort bij mijlpaal 6.

## Isolatie en levenscyclus

Elke Codex-run krijgt een tijdelijke runtime-home en een lege werkmap met directoryrechten 0700. De bestaande login wordt gekopieerd naar een bestand met rechten 0600; configuratie, plugins, skills en MCP-servers van de gebruiker worden niet geïmporteerd. De oorspronkelijke login/configuratie wordt niet gewijzigd. De kopie en threadbestanden worden bij stoppen verwijderd.

Het profiel `island` weigert bestandstoegang vanaf `:root` en commandonetwerktoegang. Shell/unified exec, lokale imageviewer, browser, computer use, plugins, apps, multi-agentdelegatie, geheugenimport, hooks, workspace dependencies en Code Mode-host staan uit. Threadresponses moeten het profiel `island` en `approvalPolicy: never` bevestigen. Niet-wereldtoolrequests worden afgewezen; bij een onverwachte hosttoolactiviteit wordt de runtime afgesloten. Dit wijzigt uitsluitend de eigen eilandruntime en verleent geen nieuwe rechten aan andere Codex-sessies. Zie [OpenAI Docs — configuratie](https://learn.chatgpt.com/docs/config-file/config-reference).

De adapter heeft een deadline van 60 echte seconden per besluit en begrensde RPC-verzoeken. De scheduler heeft een ruimere deadline van 90 seconden en valt bij falen terug op een korte virtuele wachtactie. Annulering bereikt de echte modelturn via `turn/interrupt`; een niet reagerende verbinding wordt gesloten. Late resultaten worden niet alsnog uitgevoerd. De standaard scripted tests maken geen modelaanroepen.

Nieuwe Codex-besluiten starten standaard minimaal 10 echte seconden na elkaar,
gedeeld door alle Codex-agents binnen dezelfde run. Het interval wordt gemeten
tussen starts, niet vanaf het einde van een besluit. Stel dit serverzijdig in
met `AGENT_ISLAND_CODEX_MIN_DECISION_INTERVAL_MS` (milliseconden; standaard
`10000`, `0` schakelt deze begrenzing uit). De waarde moet eindig en niet-negatief
zijn. Herstart de server om de instelling toe te passen. Simulatiesnelheid en
cyclusresets verkorten het interval niet. Tijdens het wachten verbruikt de
scheduler geen beslispogingen; scripted agents kunnen doorgaan. De begrenzing
geldt per run, niet over meerdere runs of andere Codex-sessies heen.

Bij `429 Too Many Requests` heeft de CLI zijn eigen retries al doorlopen. De adapter blokkeert daarna nieuwe Codex-besluiten voor alle agents binnen dezelfde run: eerst 30 seconden plus maximaal 5 seconden willekeurige spreiding, bij opeenvolgende mislukte pogingen oplopend tot maximaal 5 minuten. Dit is echte tijd, onafhankelijk van de simulatiesnelheid. Tijdens deze wachttijd worden geen modelaanroepen gestart of beslispogingen van het experimentbudget verbruikt; scripted agents kunnen doorgaan. Bestaande modelturns mogen afronden. Na de wachttijd probeert de scheduler automatisch opnieuw; een geslaagde poging na de wachttijd herstelt de oorspronkelijke wachttijd. Een cyclusreset heft een actieve wachttijd niet op. Afgeronde mislukte turns worden niet opnieuw onderbroken en hun threads blijven beschikbaar. Het dashboard vertaalt de fout naar een leesbare melding; het beslisrecord behoudt de technische fout achter `CODEX_RATE_LIMITED`. Zie [OpenAI Docs — rate limits](https://developers.openai.com/api/docs/guides/rate-limits). Deze afhandeling vermindert herhaalde aanvragen, maar verhoogt geen accountlimieten en verhelpt geen uitgeput quotum.

## Registratie en verificatie

`GET /api/simulations/:id/agents/:agentId/decisions` retourneert de eigen vastgelegde beslissingen voor de menselijke inspector: waarneming, thread/turn-ID, publiek gemotiveerde actie, MCP-input/resultaat, queue-action-ID en actuele werelduitkomst. Het dashboard toont modelstatus en kan deze records opvragen. Verborgen redeneerinhoud wordt niet opgeslagen; `motivation` is een door het model gegeven publieke verklaring.

De journal bewaart maximaal 256 recente beslissingen in geheugen. Historie verdwijnt bij serverherstart. Langetermijngeheugen, SQLite, cycli en volledige replay blijven werk voor mijlpalen 4 en 5.

```sh
npm run typecheck
npm test
npm run build
npm run verify:codex
```

De eerste drie commando's gebruiken geen echte modellen. `verify:codex` maakt echte modelaanroepen en stopt bij acceptatie, onderbreking, drie initiële modelmislukkingen of maximaal drie echte minuten. Acceptatie vereist minimaal 15 minuten virtuele tijd, vier ingediende modelbesluiten, twee geslaagde verplaatsingen en 15 m afstand tot de start. De proef schrijft alleen de samengevatte uitkomst en publieke beslisvoorbeelden naar `docs/sprint-3-live-result.json`.
