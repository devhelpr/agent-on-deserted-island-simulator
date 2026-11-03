import {
  ITEMS,
  RECIPES,
  inventoryCapacity,
  type ItemKind,
  actionSchema,
  actionExplanationSchema,
  AGENT_RADIUS,
  distance,
  entityRadius,
  entityHeight,
  interactionDistance,
  INTERACTION_RANGE,
  TICK_MS,
  type ActionRecord,
  type AgentObservation,
  type AgentState,
  type EntityState,
  type Vector3,
  type WorldDefinition,
  type WorldEvent,
  type WorldStateDto,
} from "../../../../packages/shared/src/index.js";
import { NavigationSystem, segmentDistance } from "./NavigationSystem.js";
import { canSee, observe } from "./PerceptionSystem.js";
import {
  SpatialPhysics,
  flightPoint,
  GRAVITY,
  JUMP_HEIGHT,
  JUMP_RANGE,
  THROW_RANGE,
  AGENT_HEIGHT,
  type Flight,
} from "./SpatialPhysics.js";
export { TICK_MS };
interface ActiveMotion {
  path: Vector3[];
  blockedTicks: number;
}
export type ActionSubmission =
  { accepted: true; actionId: string } | { accepted: false; error: string };
export interface AgentSpawn {
  id: string;
  name: string;
  position: Vector3;
  orientation?: number;
}
/** Sole writer of world state. Inputs are validated and conflicts resolved at tick boundaries. */
export class WorldEngine {
  private readonly definition: WorldDefinition;
  private tick = 0;
  private nextAction = 1;
  private nextEvent = 1;
  private readonly agents = new Map<string, AgentState>();
  private readonly entities = new Map<string, EntityState>();
  private readonly actions = new Map<string, ActionRecord>();
  private readonly motions = new Map<string, ActiveMotion>();
  private readonly waits = new Map<string, number>();
  private readonly events: WorldEvent[] = [];
  private readonly lastActions = new Map<string, string>();
  private readonly messages = new Map<
    string,
    { from: string; text: string; tick: number }[]
  >();
  private readonly observedEvents = new Map<string, WorldEvent[]>();
  private readonly encounters = new Set<string>();
  private commit?: () => void;
  private mutating = false;
  private accepting = true;
  readonly navigation: NavigationSystem;
  private readonly physics: SpatialPhysics;
  private readonly flights = new Map<string, Flight>();
  setCommit(commit: () => void) {
    this.commit = commit;
  }
  setAccepting(accepting: boolean) {
    this.accepting = accepting;
  }
  checkpoint() {
    return structuredClone({
      encounters: [...this.encounters],
      tick: this.tick,
      nextAction: this.nextAction,
      nextEvent: this.nextEvent,
      accepting: this.accepting,
      agents: [...this.agents],
      entities: [...this.entities],
      actions: [...this.actions],
      motions: [...this.motions],
      waits: [...this.waits],
      flights: [...this.flights],
      events: this.events,
      lastActions: [...this.lastActions],
      messages: [...this.messages],
      observedEvents: [...this.observedEvents],
    });
  }
  restore(checkpoint: ReturnType<WorldEngine["checkpoint"]>) {
    const c = structuredClone(checkpoint);
    this.encounters.clear();
    for (const key of c.encounters ?? []) this.encounters.add(key);
    this.tick = c.tick;
    this.nextAction = c.nextAction;
    this.nextEvent = c.nextEvent;
    this.accepting = c.accepting;
    const restoreMap = <K, V>(map: Map<K, V>, entries: [K, V][]) => {
      map.clear();
      for (const [key, value] of entries) map.set(key, value);
    };
    restoreMap(this.agents, c.agents);
    restoreMap(this.entities, c.entities);
    restoreMap(this.actions, c.actions);
    restoreMap(this.motions, c.motions);
    restoreMap(this.waits, c.waits);
    restoreMap(this.flights, c.flights ?? []);
    restoreMap(this.lastActions, c.lastActions);
    restoreMap(this.messages, c.messages);
    restoreMap(this.observedEvents, c.observedEvents);
    this.events.splice(0, this.events.length, ...c.events);
    this.navigation.updateObstacles(this.solids());
  }
  private mutate<T>(operation: () => T): T {
    const before = this.checkpoint();
    this.mutating = true;
    try {
      const result = operation();
      this.commit!();
      return result;
    } catch (error) {
      this.restore(before);
      throw error;
    } finally {
      this.mutating = false;
    }
  }
  constructor(definition: WorldDefinition, spawns?: AgentSpawn[]) {
    this.definition = structuredClone(definition);
    this.physics = new SpatialPhysics(this.definition.terrain);
    for (const e of definition.entities)
      this.entities.set(e.id, {
        ...structuredClone(e),
        ownerId: null,
        activated: false,
      });
    this.navigation = new NavigationSystem(
      this.definition.terrain,
      this.entityList(),
    );
    const initial: AgentSpawn[] =
      spawns ??
      definition.spawnPoints.slice(0, 3).map((position, i) => ({
        id: ["alpha", "beta", "gamma"][i]!,
        name: ["Alpha", "Beta", "Gamma"][i]!,
        position,
      }));
    if (!initial.length) throw new Error("World needs a spawn point");
    for (const spawn of initial) {
      if (
        this.agents.has(spawn.id) ||
        !this.navigation.isWalkable(spawn.position) ||
        [...this.agents.values()].some(
          (a) => distance(a.position, spawn.position) < 2 * AGENT_RADIUS,
        )
      )
        throw new Error("Invalid agent spawn");
      this.agents.set(spawn.id, {
        id: spawn.id,
        name: spawn.name,
        position: this.navigation.point(spawn.position.x, spawn.position.z),
        orientation: spawn.orientation ?? 0,
        status: "idle",
        controller: "scripted",
        inventory: [],
        activeActionId: null,
      });
      this.observedEvents.set(spawn.id, []);
    }
  }
  private entityList() {
    return [...this.entities.values()];
  }
  private orderedAgents() {
    return [...this.agents.values()].sort((a, b) =>
      a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
    );
  }
  setController(agentId: string, controller: "scripted" | "codex") {
    const agent = this.agents.get(agentId);
    if (agent) agent.controller = controller;
  }
  getTick(): number {
    return this.tick;
  }
  getDefinitionVersion() {
    return this.definition.version;
  }
  getDefinition(): WorldDefinition {
    return structuredClone(this.definition);
  }
  getAgents(): AgentState[] {
    return structuredClone(this.orderedAgents());
  }
  getIdleAgents(): AgentState[] {
    return structuredClone(
      this.orderedAgents().filter(
        (a) =>
          a.status === "idle" &&
          ![...this.flights.values()].some(
            (f) => !f.entityId && f.agentId === a.id,
          ),
      ),
    );
  }
  getAction(id: string): ActionRecord | undefined {
    const a = this.actions.get(id);
    return a ? structuredClone(a) : undefined;
  }
  submitAction(
    agentId: string,
    input: unknown,
    explanation: unknown = {},
  ): ActionSubmission {
    if (!this.accepting) return { accepted: false, error: "CYCLE_CLOSING" };
    if (this.commit && !this.mutating)
      return this.mutate(() => this.submitAction(agentId, input, explanation));
    const details = actionExplanationSchema.safeParse(explanation);
    if (!details.success)
      return { accepted: false, error: "INVALID_EXPLANATION" };
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) return { accepted: false, error: "INVALID_ACTION" };
    const agent = this.agents.get(agentId);
    if (!agent) return { accepted: false, error: "AGENT_NOT_FOUND" };
    if (
      agent.activeActionId ||
      [...this.flights.values()].some(
        (f) => !f.entityId && f.agentId === agentId,
      )
    )
      return { accepted: false, error: "AGENT_BUSY" };
    const action: ActionRecord = {
      id: `act-${this.nextAction++}`,
      agentId,
      input: parsed.data,
      status: "queued",
      submittedAtTick: this.tick,
      ...structuredClone(details.data),
    };
    this.actions.set(action.id, action);
    this.lastActions.set(agentId, action.id);
    agent.activeActionId = action.id;
    agent.status = "queued";
    this.trimActions();
    return { accepted: true, actionId: action.id };
  }
  cancelAction(agentId: string, actionId: string): boolean {
    if (this.commit && !this.mutating)
      return this.mutate(() => this.cancelAction(agentId, actionId));
    const action = this.actions.get(actionId);
    if (
      !action ||
      action.agentId !== agentId ||
      !["queued", "running"].includes(action.status)
    )
      return false;
    this.finish(action, "cancelled", "CANCELLED");
    return true;
  }
  cancelAll(): void {
    if (this.commit && !this.mutating)
      return this.mutate(() => this.cancelAll());
    for (const a of this.actions.values())
      if (a.status === "queued" || a.status === "running")
        this.finish(a, "cancelled", "SIMULATION_STOPPED");
  }
  private trimActions() {
    if (this.actions.size <= 512) return;
    for (const [id, a] of this.actions) {
      if (
        a.status !== "running" &&
        a.status !== "queued" &&
        !this.flights.has(id)
      )
        this.actions.delete(id);
      if (this.actions.size <= 512) break;
    }
  }
  private event(
    action: Pick<ActionRecord, "agentId"> &
      Partial<
        Pick<ActionRecord, "id" | "motivation" | "artifactConsiderations">
      >,
    type: string,
    message: string,
    targetId?: string,
  ) {
    const agent = this.agents.get(action.agentId)!;
    const event: WorldEvent = {
      sequence: this.nextEvent++,
      tick: this.tick,
      type,
      actorId: agent.id,
      actionId: action.id,
      targetId,
      position: { ...agent.position },
      message,
      motivation: action.motivation,
      artifactConsiderations: structuredClone(action.artifactConsiderations),
    };
    this.events.push(event);
    if (this.events.length > 200) this.events.shift();
    for (const observer of this.agents.values())
      if (
        observer.id === agent.id ||
        (type === "agent:message"
          ? observer.id === targetId
          : canSee(observer, event.position, this.entityList()) &&
            (!targetId ||
              canSee(
                observer,
                this.entities.get(targetId)?.position ?? event.position,
                this.entityList(),
                targetId,
              )))
      ) {
        const list = this.observedEvents.get(observer.id)!;
        list.push(event);
        if (list.length > 100) list.shift();
      }
  }
  private finish(
    action: ActionRecord,
    status: "succeeded" | "failed" | "cancelled",
    error?: string,
    result?: unknown,
  ) {
    action.status = status;
    action.finishedAtTick = this.tick;
    action.error = error;
    action.result = result;
    const agent = this.agents.get(action.agentId)!;
    if (agent.activeActionId === action.id) {
      agent.activeActionId = null;
      agent.status = "idle";
    }
    this.motions.delete(action.id);
    this.waits.delete(action.id);
    const targetId =
      "entityId" in action.input ? action.input.entityId : undefined;
    this.event(
      action,
      `action:${status}`,
      `${agent.name}: ${action.input.type} ${error ?? status}`,
      targetId,
    );
  }
  private fail(action: ActionRecord, error: string) {
    this.finish(action, "failed", error);
  }
  observe(agentId: string): AgentObservation | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const observation = observe(
      agent,
      this.orderedAgents(),
      this.entityList(),
      this.tick,
      this.observedEvents.get(agentId)!,
    );
    const held = agent.inventory.map((id) => this.entities.get(id)!);
    observation.inventoryCapacity = inventoryCapacity(held);
    observation.recipes = RECIPES.map((recipe) => {
      const missing: Partial<Record<ItemKind, number>> = {};
      for (const [kind, count] of Object.entries(recipe.ingredients)) {
        const shortage =
          count! - held.filter((e) => e.itemKind === kind).length;
        if (shortage > 0) missing[kind as ItemKind] = shortage;
      }
      const stationAvailable =
        !recipe.station || this.hasStation(agent, recipe.station);
      return {
        ...recipe,
        missing,
        stationAvailable,
        craftable:
          !Object.keys(missing).length &&
          stationAvailable &&
          this.craftFits(agent, recipe.id),
      };
    });
    const last = this.lastActions.get(agentId);
    if (last) observation.lastAction = this.getAction(last);
    observation.messages = structuredClone(
      (this.messages.get(agentId) ?? []).slice(-20),
    );
    return observation;
  }
  private held(agent: AgentState) {
    return agent.inventory.map((id) => this.entities.get(id)!);
  }
  private hasStation(agent: AgentState, kind: ItemKind) {
    return this.entityList().some(
      (e) =>
        e.itemKind === kind &&
        !e.ownerId &&
        interactionDistance(agent.position, e) <=
          INTERACTION_RANGE + entityRadius(e) &&
        canSee(agent, e.position, this.entityList(), e.id),
    );
  }
  private craftMaterials(agent: AgentState, recipeId: ItemKind) {
    const recipe = RECIPES.find((r) => r.id === recipeId)!;
    const held = this.held(agent);
    const consumed: EntityState[] = [];
    for (const [kind, count] of Object.entries(recipe.ingredients)) {
      const matches = held.filter((e) => e.itemKind === kind).slice(0, count);
      if (matches.length !== count) return null;
      consumed.push(...matches);
    }
    return consumed;
  }
  private craftFits(agent: AgentState, recipeId: ItemKind) {
    const recipe = RECIPES.find((r) => r.id === recipeId)!;
    const consumed = this.craftMaterials(agent, recipeId);
    if (!consumed) return false;
    const remaining = this.held(agent).filter((e) => !consumed.includes(e));
    return (
      remaining.length + recipe.quantity <=
      inventoryCapacity([...remaining, { itemKind: recipe.id }])
    );
  }
  private giveItems(
    agent: AgentState,
    kind: ItemKind,
    quantity: number,
    action: ActionRecord,
  ) {
    const ids: string[] = [];
    for (let i = 0; i < quantity; i++) {
      const id = `item-${action.id}-${i}`;
      this.entities.set(id, {
        id,
        type: "item",
        itemKind: kind,
        label: ITEMS[kind].label,
        position: { ...agent.position },
        rotation: 0,
        scale: 1,
        properties: { movable: true, inspectable: true },
        ownerId: agent.id,
        activated: false,
      });
      agent.inventory.push(id);
      ids.push(id);
    }
    return ids;
  }
  private start(action: ActionRecord) {
    action.status = "running";
    action.startedAtTick = this.tick;
    const agent = this.agents.get(action.agentId)!;
    const input = action.input;
    if (input.type === "jump") {
      if (!this.grounded(agent.position))
        return this.fail(action, "NOT_GROUNDED");
      return this.launch(action, agent);
    }
    if (input.type === "move") {
      if (!this.grounded(agent.position))
        return this.fail(action, "NOT_GROUNDED");
      const elevated =
        agent.position.y >
        this.navigation.point(agent.position.x, agent.position.z).y + 0.1;
      const path = elevated
        ? this.surfacePath(agent.position, input.target)
        : this.navigation.findPath(agent.position, input.target);
      if (!path) return this.fail(action, "UNREACHABLE");
      this.motions.set(action.id, { path, blockedTicks: 0 });
      agent.status = "moving";
      return;
    }
    if (input.type === "look") {
      agent.orientation = input.orientation;
      this.finish(action, "succeeded");
      return;
    }
    if (input.type === "wait") {
      this.waits.set(action.id, Math.ceil(input.durationMs / TICK_MS));
      agent.status = "waiting";
      return;
    }
    if (input.type === "communicate") {
      const recipient = this.agents.get(input.recipientId);
      if (
        !recipient ||
        recipient.id === agent.id ||
        distance(agent.position, recipient.position) > 25 ||
        !canSee(agent, recipient.position, this.entityList())
      )
        return this.fail(action, "RECIPIENT_NOT_VISIBLE");
      const messages = this.messages.get(recipient.id) ?? [];
      messages.push({ from: agent.id, text: input.message, tick: this.tick });
      if (messages.length > 50) messages.shift();
      this.messages.set(recipient.id, messages);
      this.finish(action, "succeeded", undefined, { delivered: true });
      this.event(action, "agent:message", input.message, recipient.id);
      return;
    }
    if (input.type === "craft") {
      const recipe = RECIPES.find((r) => r.id === input.recipeId)!;
      const consumed = this.craftMaterials(agent, recipe.id);
      if (!consumed) return this.fail(action, "MISSING_MATERIALS");
      if (recipe.station && !this.hasStation(agent, recipe.station))
        return this.fail(action, "WORKBENCH_REQUIRED");
      if (!this.craftFits(agent, recipe.id))
        return this.fail(action, "INVENTORY_FULL");
      for (const item of consumed) this.entities.delete(item.id);
      agent.inventory = agent.inventory.filter(
        (id) => !consumed.some((e) => e.id === id),
      );
      const created = this.giveItems(agent, recipe.id, recipe.quantity, action);
      this.finish(action, "succeeded", undefined, {
        created,
        consumed: consumed.map((e) => e.id),
        recipeId: recipe.id,
      });
      return;
    }
    const entity = this.entities.get(input.entityId);
    if (!entity) return this.fail(action, "ENTITY_NOT_FOUND");
    if (input.type === "drop" || input.type === "throw") {
      if (entity.ownerId !== agent.id || !agent.inventory.includes(entity.id))
        return this.fail(action, "NOT_OWNER");
      const remaining = this.held(agent).filter((e) => e.id !== entity.id);
      if (remaining.length > inventoryCapacity(remaining))
        return this.fail(action, "INVENTORY_FULL");
      if (input.type === "throw") return this.launch(action, agent, entity);
      const target = this.navigation.point(input.target.x, input.target.z);
      if (
        distance(agent.position, target) >
        INTERACTION_RANGE + entityRadius(entity)
      )
        return this.fail(action, "OUT_OF_RANGE");
      if (
        !this.navigation.isWalkable(target, entityRadius(entity)) ||
        this.orderedAgents().some(
          (a) =>
            distance(a.position, target) < AGENT_RADIUS + entityRadius(entity),
        )
      )
        return this.fail(action, "DROP_BLOCKED");
      entity.ownerId = null;
      entity.position = target;
      agent.inventory = agent.inventory.filter((id) => id !== entity.id);
      this.navigation.updateObstacles(this.solids());
      this.finish(action, "succeeded");
      return;
    }
    if ([...this.flights.values()].some((f) => f.entityId === entity.id))
      return this.fail(action, "OBJECT_UNAVAILABLE");
    if (entity.ownerId && entity.ownerId !== agent.id)
      return this.fail(action, "OBJECT_UNAVAILABLE");
    if (
      interactionDistance(agent.position, entity) >
      INTERACTION_RANGE + entityRadius(entity)
    )
      return this.fail(action, "OUT_OF_RANGE");
    if (
      entity.ownerId !== agent.id &&
      !canSee(agent, entity.position, this.entityList(), entity.id)
    )
      return this.fail(action, "NOT_VISIBLE");
    if (input.type === "gather") {
      if (entity.ownerId || !["tree", "rock"].includes(entity.type))
        return this.fail(action, "NOT_RESOURCE_SOURCE");
      const remaining = 6 - (entity.harvested ?? 0);
      if (remaining <= 0) return this.fail(action, "RESOURCE_DEPLETED");
      const held = this.held(agent);
      const tool = entity.type === "tree" ? "axe" : "pickaxe";
      const quantity = Math.min(
        remaining,
        held.some((e) => e.itemKind === tool) ? 2 : 1,
      );
      if (held.length + quantity > inventoryCapacity(held))
        return this.fail(action, "INVENTORY_FULL");
      entity.harvested = (entity.harvested ?? 0) + quantity;
      const created = this.giveItems(
        agent,
        entity.type === "tree" ? "wood" : "stone",
        quantity,
        action,
      );
      this.finish(action, "succeeded", undefined, {
        created,
        remainingResources: 6 - entity.harvested,
      });
      return;
    }
    if (input.type === "inspect") {
      if (!entity.properties.inspectable)
        return this.fail(action, "NOT_INSPECTABLE");
      this.finish(action, "succeeded", undefined, {
        type: entity.type,
        kind: entity.kind,
        label: entity.label,
        properties: { ...entity.properties },
        itemKind: entity.itemKind,
        description: entity.itemKind
          ? ITEMS[entity.itemKind].description
          : undefined,
        remainingResources: ["tree", "rock"].includes(entity.type)
          ? 6 - (entity.harvested ?? 0)
          : undefined,
        activated: entity.activated,
      });
      return;
    }
    if (input.type === "interact") {
      if (entity.itemKind === "campfire" && entity.ownerId)
        return this.fail(action, "PLACE_FIRST");
      if (
        entity.type !== "artifact" &&
        entity.itemKind !== "torch" &&
        entity.itemKind !== "campfire"
      )
        return this.fail(action, "UNSUPPORTED_INTERACTION");
      entity.activated = true;
      this.finish(action, "succeeded", undefined, { activated: true });
      return;
    }
    if (!entity.properties.movable) return this.fail(action, "NOT_MOVABLE");
    if (entity.ownerId) return this.fail(action, "OBJECT_UNAVAILABLE");
    if (
      agent.inventory.length + 1 >
      inventoryCapacity([...this.held(agent), entity])
    )
      return this.fail(action, "INVENTORY_FULL");
    entity.ownerId = agent.id;
    entity.position = { ...agent.position };
    agent.inventory.push(entity.id);
    this.navigation.updateObstacles(this.solids());
    this.finish(action, "succeeded");
  }
  step(): void {
    if (this.commit && !this.mutating) return this.mutate(() => this.step());
    this.tick++;
    // Agent ID, then action ID: request arrival order never decides ownership.
    const queued = [...this.actions.values()]
      .filter((a) => a.status === "queued")
      .sort((a, b) =>
        a.agentId < b.agentId
          ? -1
          : a.agentId > b.agentId
            ? 1
            : a.id.localeCompare(b.id),
      );
    const needsSettling =
      this.flights.size > 0 ||
      queued.some((a) =>
        ["jump", "throw", "pickup", "drop", "craft"].includes(a.input.type),
      );
    for (const action of queued) this.start(action);
    for (const agent of this.orderedAgents()) {
      if (!agent.activeActionId) continue;
      const action = this.actions.get(agent.activeActionId)!;
      const wait = this.waits.get(action.id);
      if (wait !== undefined) {
        if (wait <= 1) this.finish(action, "succeeded");
        else this.waits.set(action.id, wait - 1);
        continue;
      }
      const motion = this.motions.get(action.id);
      if (!motion) continue;
      let budget = (3 * TICK_MS) / 1000;
      let blocked = false;
      while (budget > 1e-9 && motion.path.length) {
        const target = motion.path[0]!;
        const d = distance(agent.position, target);
        const step = Math.min(d, budget);
        if (d < 1e-8) {
          motion.path.shift();
          continue;
        }
        const next = this.physics.surface(
          this.navigation.point(
            agent.position.x + ((target.x - agent.position.x) * step) / d,
            agent.position.z + ((target.z - agent.position.z) * step) / d,
          ),
          this.solids(),
          agent.position.y + 0.4,
        );
        if (
          !this.physics.clear(
            next,
            AGENT_RADIUS,
            AGENT_HEIGHT,
            this.solids(),
          ) ||
          Math.abs(next.y - agent.position.y) > 0.4 ||
          this.orderedAgents().some(
            (a) =>
              a.id !== agent.id &&
              segmentDistance(a.position, agent.position, next) <
                2 * AGENT_RADIUS - 1e-7,
          )
        ) {
          blocked = true;
          break;
        }
        agent.orientation = Math.atan2(
          next.x - agent.position.x,
          next.z - agent.position.z,
        );
        agent.position = next;
        budget -= step;
        for (const id of agent.inventory)
          this.entities.get(id)!.position = { ...next };
        if (d <= step + 1e-8) motion.path.shift();
      }
      motion.blockedTicks = blocked ? motion.blockedTicks + 1 : 0;
      if (!motion.path.length) this.finish(action, "succeeded");
      else if (motion.blockedTicks >= 100) this.fail(action, "PATH_BLOCKED");
    }
    this.advanceFlights();
    if (needsSettling) this.settle();
    this.greetEncounters();
  }
  private solids(excludeId?: string) {
    const flying = new Set([...this.flights.values()].map((f) => f.entityId));
    return this.entityList().filter(
      (e) => e.id !== excludeId && !flying.has(e.id),
    );
  }
  private grounded(position: Vector3) {
    return (
      Math.abs(
        position.y -
          this.physics.surface(position, this.solids(), position.y).y,
      ) < 1e-6
    );
  }
  private surfacePath(from: Vector3, target: Vector3): Vector3[] | null {
    const path: Vector3[] = [];
    const samples = Math.max(1, Math.ceil(distance(from, target) / 0.15));
    if (!this.physics.inBounds(target, AGENT_RADIUS)) return null;
    let previous = from;
    for (let i = 1; i <= samples; i++) {
      const next = this.physics.surface(
        {
          x: from.x + ((target.x - from.x) * i) / samples,
          y: 0,
          z: from.z + ((target.z - from.z) * i) / samples,
        },
        this.solids(),
        previous.y + 0.4,
      );
      if (
        Math.abs(next.y - previous.y) > 0.4 ||
        !this.physics.clear(next, AGENT_RADIUS, AGENT_HEIGHT, this.solids())
      )
        return null;
      path.push(next);
      previous = next;
    }
    return path;
  }
  private agentCollision(
    p: Vector3,
    radius: number,
    height: number,
    ignoreId?: string,
  ) {
    return this.orderedAgents().some(
      (a) =>
        a.id !== ignoreId &&
        distance(a.position, p) < AGENT_RADIUS + radius - 1e-7 &&
        p.y < a.position.y + AGENT_HEIGHT - 1e-7 &&
        p.y + height > a.position.y + 1e-7,
    );
  }
  private launch(
    action: ActionRecord,
    agent: AgentState,
    entity?: EntityState,
  ) {
    const input = action.input;
    if (input.type !== "jump" && input.type !== "throw") return;
    const solids = this.solids(entity?.id);
    const from = { ...agent.position, y: agent.position.y + (entity ? 2 : 0) };
    const to = this.physics.surface(input.target, solids);
    const radius = entity ? entityRadius(entity) : AGENT_RADIUS;
    const height = entity ? entityHeight(entity) : AGENT_HEIGHT;
    const rise = entity ? 6 : JUMP_HEIGHT;
    const velocity = Math.sqrt(2 * GRAVITY * rise);
    const discriminant = velocity ** 2 - 2 * GRAVITY * (to.y - from.y);
    const fail = () =>
      this.fail(action, entity ? "THROW_UNREACHABLE" : "JUMP_UNREACHABLE");
    if (
      distance(from, to) > (entity ? THROW_RANGE : JUMP_RANGE) ||
      discriminant < 0 ||
      !this.physics.inBounds(to, radius)
    )
      return fail();
    const duration = (velocity + Math.sqrt(discriminant)) / GRAVITY;
    const flight: Flight = {
      agentId: agent.id,
      entityId: entity?.id,
      from,
      to,
      velocity,
      duration,
      elapsed: 0,
    };
    if (this.agentCollision(to, radius, height, entity ? undefined : agent.id))
      return fail();
    const samples = Math.ceil(duration / 0.025);
    for (let i = 0; i <= samples; i++) {
      const p = flightPoint(flight, (duration * i) / samples);
      if (
        !this.physics.clear(p, radius, height, solids) ||
        this.agentCollision(p, radius, height, agent.id)
      )
        return fail();
    }
    if (entity) {
      entity.ownerId = null;
      entity.position = from;
      agent.inventory = agent.inventory.filter((id) => id !== entity.id);
    }
    if (distance(from, to) > 0.001)
      agent.orientation = Math.atan2(to.x - from.x, to.z - from.z);
    agent.status = "moving";
    this.flights.set(action.id, flight);
    if (entity) this.navigation.updateObstacles(this.solids());
  }
  private advanceFlights() {
    for (const [id, flight] of this.flights) {
      const agent = this.agents.get(flight.agentId)!;
      const entity = flight.entityId
        ? this.entities.get(flight.entityId)!
        : undefined;
      const radius = entity ? entityRadius(entity) : AGENT_RADIUS;
      const height = entity ? entityHeight(entity) : AGENT_HEIGHT;
      const action = this.actions.get(id)!;
      const elapsed = Math.min(
        flight.duration,
        flight.elapsed + TICK_MS / 1000,
      );
      // Substeps prevent tunnelling through thin objects between simulation ticks.
      const samples = Math.ceil((elapsed - flight.elapsed) / 0.01);
      let blocked = false;
      for (let i = 1; i <= samples; i++) {
        const p = flightPoint(
          flight,
          flight.elapsed + ((elapsed - flight.elapsed) * i) / samples,
        );
        if (
          !this.physics.clear(p, radius, height, this.solids(entity?.id)) ||
          this.agentCollision(
            p,
            radius,
            height,
            entity && elapsed >= flight.duration ? undefined : flight.agentId,
          )
        ) {
          blocked = true;
          break;
        }
        if (entity) entity.position = p;
        else agent.position = p;
      }
      flight.elapsed = elapsed;
      if (blocked || elapsed >= flight.duration) {
        this.flights.delete(id);
        if (!blocked) {
          if (entity) entity.position = { ...flight.to };
          else agent.position = { ...flight.to };
        }
        this.navigation.updateObstacles(this.solids());
        if (action.status === "running")
          this.finish(
            action,
            blocked ? "failed" : "succeeded",
            blocked ? "FLIGHT_BLOCKED" : undefined,
            { position: { ...(entity?.position ?? agent.position) } },
          );
      }
      for (const itemId of agent.inventory)
        this.entities.get(itemId)!.position = { ...agent.position };
    }
  }
  private settle() {
    // Removing a supporting object also lowers everything resting on it.
    let changed = false;
    for (const entity of this.solids()
      .filter((e) => !e.ownerId)
      .sort((a, b) => a.position.y - b.position.y)) {
      if (
        entity.position.y <=
        this.navigation.point(entity.position.x, entity.position.z).y + 1e-7
      )
        continue;
      const y = this.physics.surface(
        entity.position,
        this.solids(entity.id),
        entity.position.y,
      ).y;
      if (y < entity.position.y - 1e-7) {
        entity.position.y = y;
        changed = true;
      }
    }
    if (changed) this.navigation.updateObstacles(this.solids());
    for (const agent of this.agents.values()) {
      if (
        [...this.flights.values()].some(
          (f) => !f.entityId && f.agentId === agent.id,
        )
      )
        continue;
      const surface = this.physics.surface(
        agent.position,
        this.solids(),
        agent.position.y,
      );
      if (surface.y < agent.position.y) agent.position.y = surface.y;
      for (const id of agent.inventory)
        this.entities.get(id)!.position = { ...agent.position };
    }
  }
  private greetEncounters() {
    for (const agent of this.orderedAgents()) {
      for (const other of this.orderedAgents()) {
        if (agent.id === other.id) continue;
        const key = `${agent.id}:${other.id}`;
        const d = distance(agent.position, other.position);
        if (d > 15) this.encounters.delete(key);
        if (
          d > 10 ||
          this.encounters.has(key) ||
          !canSee(agent, other.position, this.entityList())
        )
          continue;
        this.encounters.add(key);
        const text = `Hello ${other.name}! I'm ${agent.name}. Good to meet you!`;
        const inbox = this.messages.get(other.id) ?? [];
        inbox.push({ from: agent.id, text, tick: this.tick });
        this.messages.set(other.id, inbox.slice(-50));
        this.event({ agentId: agent.id }, "agent:greeting", text, other.id);
      }
    }
  }
  getState(): WorldStateDto {
    return structuredClone({
      worldId: this.definition.id,
      tick: this.tick,
      simulationTimeMs: this.tick * TICK_MS,
      agents: this.orderedAgents(),
      entities: this.entityList(),
      actions: [...this.actions.values()].slice(-60),
      events: this.events.slice(-40),
    });
  }
}
