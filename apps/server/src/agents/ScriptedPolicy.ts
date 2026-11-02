import {
  AGENT_RADIUS,
  INTERACTION_RANGE,
  TICK_MS,
  distance,
  type AgentObservation,
  type ArtifactConsideration,
  type Vector3,
  type WorldActionInput,
} from "../../../../packages/shared/src/index.js";
import type { DecisionPolicy, PolicyProposal } from "./AgentScheduler.js";
interface PolicyState {
  turn: number;
  processedAction?: string;
  inspected: Set<string>;
  activated: Set<string>;
  placed: Set<string>;
  deferred: Map<string, number>;
  lastTarget?: string;
  focus?: {
    entity: AgentObservation["visibleEntities"][number];
    searched: boolean;
  };
  recalled?: boolean;
  carried?: { id: string; since: number; origin: Vector3 };
}
/** Collect portable curiosities, study them while carrying, then display them after a meaningful walk. */
export function createScriptedPolicy(): DecisionPolicy {
  const states = new Map<string, PolicyState>();
  return (o): PolicyProposal => {
    const state = states.get(o.agentId) ?? {
      turn: 0,
      inspected: new Set<string>(),
      activated: new Set<string>(),
      placed: new Set<string>(),
      deferred: new Map<string, number>(),
    };
    states.set(o.agentId, state);
    state.turn++;
    const previous = o.lastAction;
    const fresh =
      previous &&
      previous.id !== state.processedAction &&
      ["succeeded", "failed", "cancelled"].includes(previous.status);
    if (fresh) {
      state.processedAction = previous.id;
      const a = previous.input;
      if (previous.status === "succeeded" && "entityId" in a) {
        if (a.type === "inspect") state.inspected.add(a.entityId);
        if (a.type === "interact") state.activated.add(a.entityId);
        if (a.type === "drop") {
          state.placed.add(a.entityId);
          state.carried = undefined;
        }
      }
      if (previous.status === "failed") {
        const target =
          "entityId" in a
            ? a.entityId
            : a.type === "move"
              ? state.lastTarget
              : undefined;
        if (target) state.deferred.set(target, o.tick + 200);
        if (a.type === "inspect" && previous.error === "NOT_INSPECTABLE")
          state.inspected.add(a.entityId);
      }
    }
    if (!o.inventory.length) state.carried = undefined;
    const artifacts = o.visibleEntities
      .filter((e) => e.type === "artifact")
      .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id));
    const failed = fresh && previous.status === "failed";
    const feedback = failed
      ? `De vorige actie mislukte (${previous.error ?? "onbekende oorzaak"}). `
      : "";
    const choose = (
      action: WorldActionInput,
      motivation: string,
      selected?: string,
    ): PolicyProposal => {
      const artifactConsiderations: ArtifactConsideration[] = artifacts
        .slice(0, 8)
        .map((e) => {
          let decision: ArtifactConsideration["decision"] = "defer";
          let reason: string;
          if (e.ownerId === o.agentId) {
            decision = action.type === "drop" ? "place" : "keep";
            reason =
              action.type === "drop"
                ? "Ik leg mijn onderzochte vondst na het meenemen op een vrije plek."
                : "Deze vondst draag ik al; ik onderzoek en vervoer hem voordat ik hem neerleg.";
          } else if (e.ownerId) {
            decision = "leave";
            reason = `Dit artefact is al van ${e.ownerId}; ik neem geen bezit van een ander over.`;
          } else if (state.placed.has(e.id)) {
            decision = "leave";
            reason =
              "Deze vondst heb ik al onderzocht en bewust neergelegd; ik pak hem niet opnieuw op.";
          } else if (o.inventory.length)
            reason =
              "Mijn inventaris heeft één plek en is bezet; eerst rond ik mijn huidige vondst af.";
          else if ((state.deferred.get(e.id) ?? 0) > o.tick)
            reason =
              "De vorige poging bij dit artefact mislukte; ik geef de route of eigenaar even tijd en probeer later opnieuw.";
          else if (e.movable === false) {
            decision = selected === e.id ? "inspect" : "leave";
            reason =
              "Dit artefact is niet verplaatsbaar; ik kan het ter plaatse onderzoeken of activeren, maar niet dragen.";
          } else if (selected === e.id && action.type === "pickup") {
            decision = "pickup";
            reason =
              "Draagbaar, vrij en binnen bereik; mijn inventaris is leeg. Ik wil deze vondst meenemen en onderzoeken.";
          } else if (selected === e.id && action.type === "move") {
            decision = "approach";
            reason = `Dit draagbare artefact ligt op ${e.distance.toFixed(1)} m; eerst loop ik tot binnen ${(INTERACTION_RANGE + e.radius).toFixed(1)} m van het middelpunt.`;
          } else
            reason = selected
              ? `Ik rond eerst mijn gekozen doel ${selected} af om niet voortdurend van vondst te wisselen.`
              : "Ik volg eerst het genoemde verkennings- of geheugendoel en kom later op deze vondst terug.";
          return { entityId: e.id, decision, reason };
        });
      return {
        action,
        motivation: (feedback + motivation).slice(0, 500),
        artifactConsiderations,
      };
    };
    const offset =
      (["alpha", "beta", "gamma"].indexOf(o.agentId) * 2 * Math.PI) / 3;
    const angle = Math.atan2(
      Math.sin(state.turn * 2.39996 + offset),
      Math.cos(state.turn * 2.39996 + offset),
    );
    const explore = (length = 15): WorldActionInput => ({
      type: "move",
      target: {
        x: o.position.x + Math.sin(angle) * length,
        y: 0,
        z: o.position.z + Math.cos(angle) * length,
      },
    });

    if (o.inventory.length) {
      state.focus = undefined;
      const id = o.inventory[0]!;
      state.carried ??= { id, since: o.tick, origin: { ...o.position } };
      const held = o.visibleEntities.find((e) => e.id === id);
      const name = held?.label ?? id;
      if (held?.type === "artifact" && !state.inspected.has(id))
        return choose(
          { type: "inspect", entityId: id },
          `Ik draag ${name} en onderzoek nu wat ik heb gevonden; daarom houd ik mijn inventarisplek bezet.`,
          id,
        );
      if (held?.type === "artifact" && !state.activated.has(id))
        return choose(
          { type: "interact", entityId: id, interaction: "activate" },
          `Ik test de werking van ${name} terwijl ik het vasthoud.`,
          id,
        );
      state.lastTarget = undefined;
      if (
        distance(o.position, state.carried.origin) < 12 ||
        (failed && previous.input.type === "drop")
      )
        return choose(
          explore(),
          `Ik neem ${name} mee naar een andere plek om mijn vondst te vervoeren; ik leg het niet meteen weer neer.`,
          id,
        );
      const elapsedMs = (o.tick - state.carried.since) * TICK_MS;
      if (elapsedMs < 20000)
        return choose(
          { type: "wait", durationMs: Math.max(TICK_MS, 20000 - elapsedMs) },
          `Ik houd ${name} nog even bij me voordat ik het bewust neerleg; andere vondsten wachten omdat ik maar één object kan dragen.`,
          id,
        );
      const radius = held?.radius ?? 3;
      const clearance = radius + AGENT_RADIUS + 0.4;
      const candidates = Array.from({ length: 12 }, (_, i) => {
        const direction = angle + (i * Math.PI) / 6;
        return {
          x: o.position.x + Math.sin(direction) * clearance,
          y: 0,
          z: o.position.z + Math.cos(direction) * clearance,
        };
      });
      const target = candidates.find(
        (p) =>
          o.visibleEntities.every(
            (e) =>
              e.id === id ||
              e.ownerId ||
              distance(e.position, p) >= radius + e.radius + 0.2,
          ) &&
          o.visibleAgents.every(
            (a) => distance(a.position, p) >= radius + AGENT_RADIUS + 0.2,
          ),
      );
      if (!target)
        return choose(
          explore(8),
          `Rond ${name} zie ik geen vrije neerlegplek; ik loop verder en houd het vast.`,
          id,
        );
      return choose(
        { type: "drop", entityId: id, target },
        `Ik heb ${name} onderzocht en minstens 12 m meegenomen. Ik leg het na 20 seconden op een vrije plek en maak ruimte voor een nieuwe vondst.`,
        id,
      );
    }

    const cave = o.memory?.relevant.find(
      (m) => m.content.startsWith("cave ") && m.target,
    );
    if (cave?.target && !state.recalled) {
      if (
        failed &&
        previous.input.type === "move" &&
        distance(previous.input.target, cave.target) < 0.1
      )
        state.recalled = true;
      else if (distance(o.position, cave.target) > 2) {
        state.lastTarget = undefined;
        return choose(
          { type: "move", target: cave.target },
          "Ik controleer eerst de grotlocatie uit mijn geheugen; zichtbare vondsten komen daarna aan bod.",
        );
      } else state.recalled = true;
    }
    if (
      state.focus &&
      !artifacts.some((e) => e.id === state.focus!.entity.id)
    ) {
      const remembered = state.focus.entity;
      if (
        !state.focus.searched &&
        (state.deferred.get(remembered.id) ?? 0) <= o.tick &&
        distance(o.position, remembered.position) <= 25
      ) {
        state.focus.searched = true;
        const proposal = choose(
          {
            type: "look",
            orientation: Math.atan2(
              remembered.position.x - o.position.x,
              remembered.position.z - o.position.z,
            ),
          },
          `Mijn gekozen vondst ${remembered.label ?? remembered.id} is uit beeld na het lopen. Ik kijk naar de laatst waargenomen plek voordat ik een oppakpoging doe.`,
        );
        proposal.artifactConsiderations!.push({
          entityId: remembered.id,
          decision: "defer",
          reason:
            "Nu niet zichtbaar; eerst opnieuw waarnemen op de laatst geziene locatie.",
        });
        proposal.artifactConsiderations =
          proposal.artifactConsiderations!.slice(-8);
        return proposal;
      }
      state.focus = undefined;
      state.lastTarget = undefined;
    }
    const candidates = artifacts.filter(
      (e) =>
        !e.ownerId &&
        !state.placed.has(e.id) &&
        !(e.movable === false && state.activated.has(e.id)) &&
        (state.deferred.get(e.id) ?? 0) <= o.tick,
    );
    const target =
      candidates.find((e) => e.id === state.lastTarget) ??
      candidates.find((e) => e.movable !== false) ??
      candidates.find((e) => !state.activated.has(e.id));
    if (target) {
      state.lastTarget = target.id;
      state.focus = { entity: structuredClone(target), searched: false };
      const name = target.label ?? target.id;
      if (target.distance <= INTERACTION_RANGE + target.radius) {
        if (target.movable !== false)
          return choose(
            { type: "pickup", entityId: target.id },
            `Ik pak ${name} op: het is draagbaar, van niemand en binnen bereik. Ik heb een vrije inventarisplek en wil het meenemen en onderzoeken.`,
            target.id,
          );
        if (!state.inspected.has(target.id))
          return choose(
            { type: "inspect", entityId: target.id },
            `${name} is niet draagbaar. Ik onderzoek het hier in plaats van een onmogelijke oppakpoging te doen.`,
            target.id,
          );
        return choose(
          { type: "interact", entityId: target.id, interaction: "activate" },
          `${name} kan niet worden meegenomen; ik test het ter plaatse.`,
          target.id,
        );
      }
      const standOff = target.radius + 2;
      return choose(
        {
          type: "move",
          target: {
            x:
              target.position.x +
              ((o.position.x - target.position.x) / target.distance) * standOff,
            y: 0,
            z:
              target.position.z +
              ((o.position.z - target.position.z) / target.distance) * standOff,
          },
        },
        `Ik kies ${name} als vondst en loop eerst dichterbij: afstand ${target.distance.toFixed(1)} m, interactiebereik ${(INTERACTION_RANGE + target.radius).toFixed(1)} m.`,
        target.id,
      );
    }
    state.lastTarget = undefined;
    return state.turn % 3 === 1
      ? choose(
          { type: "look", orientation: angle },
          "Ik kijk rond naar een vrije, draagbare vondst; nu zie ik geen geschikte nieuwe kandidaat. Rotsen verzamelen helpt mijn onderzoeksdoel niet.",
        )
      : choose(
          explore(),
          "Ik verken nieuw terrein omdat ik geen geschikte vrije vondst zie. Achtergelaten, bezette of tijdelijk onbereikbare artefacten laat ik voorlopig liggen.",
        );
  };
}
