# Agent Island

Local-first simulatieplatform in TypeScript. De eerste sprint levert een deterministisch 3D-eiland en één scripted verkenner op. Hono beheert de wereld, Socket.IO levert de toestand aan de Vite/Three.js-viewer. Codex-integratie volgt in sprint 3.

## Lokaal starten

Vereist: Node.js 22.12+ en npm.

```sh
npm ci
npm run dev
```

Open **http://127.0.0.1:5173**. De backend luistert op **http://127.0.0.1:3001**. Stop beide processen met Ctrl+C. Er zijn geen API-sleutels of externe diensten nodig.

- Sleep om de camera te draaien; scroll om te zoomen.
- Klik op Alpha om de agent van dichtbij te bekijken, of op Overzicht om de camera terug te zetten.
- De server stuurt bij (her)verbinden de werelddefinitie; daarna volgt agenttoestand op 10 Hz. De viewer interpoleert posities.
- Alpha beweegt met 3 m/s op een vrije vierkante route midden op het eiland.

## Controleren en bouwen

```sh
npm run typecheck
npm test
npm run build
```

De clientbuild staat in `apps/client/dist`. De serverbuild bevat de gedeelde contracten en start met `npm start -w @agent-island/server`. `npm run preview -w @agent-island/client` toont de clientbuild; deze preview gebruikt dezelfde lokale backendproxy als development. Dit is een lokale ontwikkelopzet, geen hostingconfiguratie.

## Structuur

- `apps/client`: dashboard, Three.js-rendering en camera.
- `apps/server`: Hono-API, Socket.IO-transport, World Engine en wereldgenerator.
- `packages/shared`: getypeerde contracten en heightmap-sampling.
- [TODO.md](TODO.md): zes sprints, taken en acceptatiecriteria.
- [docs/architecture-v1.md](docs/architecture-v1.md): aangeleverde ontwerptekst, zonder de meegekopieerde Mermaid-CSS.

## Wereld en autoriteit

Generator v1 gebruikt seed `48291`, een 500 × 500 m heightmap met 81 × 81 samples, 120 bomen, 80 rotsen, 12 artefacten en één grot. Dezelfde configuratie levert dezelfde definitie op. Een runtime krijgt een onafhankelijke kopie; snapshots kunnen de serverwereld niet muteren. Er bestaat geen browser-API om posities te schrijven.

`GET /api/health` geeft de serverstatus. `GET /api/world` geeft `{ definition, state }`. Socket.IO verstuurt `world:snapshot` bij elke verbinding en `world:delta` met de actuele dynamische toestand. Statische objecten worden alleen met de snapshot verstuurd. De backend bindt aan loopback.

Sprint 1 bevat een minimale realtime-runner met vaste 50 ms-stappen. Sprint 2 voegt de volledige klok, navigatie, botsingen, acties, perceptie en snelheid toe. Opslag, automatische resets, echte Codex-agents en replay zijn nog niet geïmplementeerd. De vrije centrale testroute houdt afstand tot gegenereerde objecten.

Technische referenties: [Hono Node-adapter](https://hono.dev/docs/getting-started/nodejs), [Socket.IO serverinitialisatie](https://socket.io/docs/v4/server-initialization), [Vite](https://vite.dev/guide/).
