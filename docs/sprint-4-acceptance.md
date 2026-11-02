# Mijlpaal 4 — Geheugen + reset

Geïmplementeerd op 2 november 2026. De acceptatie is een deterministische integratietest met een scripted agent; er is voor deze mijlpaal geen nieuwe betaalde Codex-duurtest uitgevoerd.

## Gedrag

- SQLite met WAL, foreign keys en een versiebeheerbare Drizzle-migratie bewaart werelddefinities, runs, cycli, agents, sessies, herinneringen, revisies, events, checkpoints, beslissingen en toolcalls. FTS5-index en triggers staan in dezelfde migratie.
- Actieacceptatie, annulering en iedere wereldtick committen hun volledige hersteltoestand en events transactioneel. Bij een databasefout herstelt de engine de toestand van vóór de mutatie. Open bewegingen bewaren hun resterende route en blokkadeteller.
- Consolidatie gebruikt uitsluitend identiteitgebonden ervaringen uit de beperkte perceptie. Directe observaties, routehypotheses en ontvangen berichten blijven `observed`, `inferred` en `reported`. Bron-IDs verwijzen naar de bijbehorende agentervaringen in `agent_experiences`; actie-ervaringen bevatten de oorspronkelijke wereldgebeurtenis.
- Herinneringen hebben confidence, importance, bronclaims en revisies. Exacte duplicaten voegen bronnen samen; tegenstrijdige claims worden gekoppeld. Een nieuwe rechtstreeks waargenomen locatie vervangt de oudere rechtstreeks waargenomen locatieclaim. Consolidatie commit eenmaal per `cycleId + agentId`.
- Contextselectie levert een compacte samenvatting, maximaal tien relevante herinneringen met begrensde bronlijsten, vier recente ervaringen en een verkennings- of grot-herbezoekdoel.
- Tick 72.000 sluit de cyclus af. De engine weigert nieuwe acties met `CYCLE_CLOSING`, annuleert lopende acties en beslissingen, bewaart de eindsnapshot en consolideert geheugen. Nieuwe cyclus en afsluiting committen samen; daarna begint de ongewijzigde beginwereld op tick nul. Codex begint een nieuwe thread met het eigen geheugen.
- Handmatige reset gebruikt hetzelfde pad. Een mislukte consolidatie laat de cyclus afgesloten voor acties en pauzeert de klok. Opnieuw resetten of hervatten herhaalt de afsluiting zonder dubbele cycli of herinneringen.
- Serverherstel laadt de laatste gecommitteerde toestand gepauzeerd; downtime veroorzaakt geen virtuele inhaalslag. Gestopte runs blijven gestopt. Onvoltooide modelbeslissingen worden geannuleerd.
- De Memory-tab zoekt met FTS en toont type, provenance, confidence, importance, revisie, bronnen en conflicten. Geheugen- en beslissingsendpoints zijn gescheiden per run en agent. Alleen de menselijke operator heeft toegang tot deze endpoints; modelcontext wordt serverzijdig samengesteld.

## Verificatie

`npm run typecheck`, `npm test` (61 tests) en `npm run build` controleren alle werkruimtes. De Socket.IO-integratietest vereist toestemming om een localhost-poort te openen. De nieuwe tests dekken:

1. Consolidatie, FTS, bronisolatie, duplicaten, tegenspraak en revisies.
2. Geforceerde databasefouten tijdens actieacceptatie en eventopslag: geheugenwereld en SQLite blijven gelijk.
3. Exacte afsluiting op tick 72.000 met geannuleerde acties en een eindsnapshot op die grens.
4. Mislukte consolidatie en transactionele herhaling.
5. Een gesimuleerde crash op een bestanddatabase en voortzetting van dezelfde route zonder hergebruik van action-ID's.
6. Annulering van hangende scripted beslissingen; late resultaten blijven bij de oorspronkelijke cyclus en bereiken de nieuwe wereld niet.
7. Een agent bereikt via openbare acties de omgeving van een grot, ziet deze met normale perceptie en slaat de locatie met een bereikbare waarnemingspositie op. Na reset kiest de verse scripted policy vanuit eigen geheugen een move naar die positie; de move slaagt.
8. Geheugen-/beslissingsendpoints en nieuwe Codex-threads met het geheugenoverzicht via een fake app-servertransport.

Browseracceptatie in Chrome: live wereld geladen, pauzeren, handmatige reset naar cyclus twee, Memory-tab openen, zoeken op `rock` en wisselen van Alpha naar Beta. De getoonde herinneringen en bronnen veranderden mee met de geselecteerde agent. Zie [browserbeeld](sprint-4-preview.png).

## Grenzen

Consolidatie gebruikt transparante vaste regels; er is nog geen modelgestuurde selectie of samenvatting. Procedurele herinneringen bewaren eerder bereikte punten, geen gegarandeerde route over toekomstige wereldmutaties. De grotacceptatie bewijst integratie met het eigen geheugen via een scripted policy; autonoom herinneren door een echt model over meerdere volledige cycli blijft de duurtest van mijlpaal 6. Periodieke replay-snapshots, reconstructie uit events en historische seek behoren tot mijlpaal 5. SQLite bewaart momenteel per tick een herstelcheckpoint; retentie en opslagoptimalisatie zijn nog niet toegevoegd.
