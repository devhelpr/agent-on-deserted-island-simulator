import {
  actionSchema,
  AGENT_RADIUS,
  distance,
  entityRadius,
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
  private commit?: () => void;
  private mutating = false;
  private accepting = true;
  readonly navigation: NavigationSystem;
  setCommit(commit: () => void) {
    this.commit = commit;
  }
  setAccepting(accepting: boolean) {
    this.accepting = accepting;
  }
  checkpoint() {
    return structuredClone({
      tick: this.tick,
      nextAction: this.nextAction,
      nextEvent: this.nextEvent,
      accepting: this.accepting,
      agents: [...this.agents],
      entities: [...this.entities],
      actions: [...this.actions],
      motions: [...this.motions],
      waits: [...this.waits],
      events: this.events,
      lastActions: [...this.lastActions],
      messages: [...this.messages],
      observedEvents: [...this.observedEvents],
    });
  }
  restore(checkpoint: ReturnType<WorldEngine["checkpoint"]>) {
    const c = structuredClone(checkpoint);
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
    restoreMap(this.lastActions, c.lastActions);
    restoreMap(this.messages, c.messages);
    restoreMap(this.observedEvents, c.observedEvents);
    this.events.splice(0, this.events.length, ...c.events);
    this.navigation.updateObstacles(this.entityList());
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
  getDefinition(): WorldDefinition {
    return structuredClone(this.definition);
  }
  getAgents(): AgentState[] {
    return structuredClone(this.orderedAgents());
  }
  getIdleAgents(): AgentState[] {
    return structuredClone(
      this.orderedAgents().filter((a) => a.status === "idle"),
    );
  }
  getAction(id: string): ActionRecord | undefined {
    const a = this.actions.get(id);
    return a ? structuredClone(a) : undefined;
  }
  submitAction(agentId: string, input: unknown): ActionSubmission {
    if (!this.accepting) return { accepted: false, error: "CYCLE_CLOSING" };
    if (this.commit && !this.mutating)
      return this.mutate(() => this.submitAction(agentId, input));
    const parsed = actionSchema.safeParse(input);
    if (!parsed.success) return { accepted: false, error: "INVALID_ACTION" };
    const agent = this.agents.get(agentId);
    if (!agent) return { accepted: false, error: "AGENT_NOT_FOUND" };
    if (agent.activeActionId) return { accepted: false, error: "AGENT_BUSY" };
    const action: ActionRecord = {
      id: `act-${this.nextAction++}`,
      agentId,
      input: parsed.data,
      status: "queued",
      submittedAtTick: this.tick,
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
      if (a.status !== "running" && a.status !== "queued")
        this.actions.delete(id);
      if (this.actions.size <= 512) break;
    }
  }
  private event(
    action: ActionRecord,
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
    };
    this.events.push(event);
    if (this.events.length > 200) this.events.shift();
    for (const observer of this.agents.values())
      if (
        observer.id === agent.id ||
        (canSee(observer, event.position, this.entityList()) &&
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
    const last = this.lastActions.get(agentId);
    if (last) observation.lastAction = this.getAction(last);
    observation.messages = structuredClone(
      (this.messages.get(agentId) ?? []).slice(-20),
    );
    return observation;
  }
  private start(action: ActionRecord) {
    action.status = "running";
    action.startedAtTick = this.tick;
    const agent = this.agents.get(action.agentId)!;
    const input = action.input;
    if (input.type === "move") {
      const path = this.navigation.findPath(agent.position, input.target);
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
        !canSee(agent, recipient.position, this.entityList())
      )
        return this.fail(action, "RECIPIENT_NOT_VISIBLE");
      const messages = this.messages.get(recipient.id) ?? [];
      messages.push({ from: agent.id, text: input.message, tick: this.tick });
      if (messages.length > 50) messages.shift();
      this.messages.set(recipient.id, messages);
      this.finish(action, "succeeded", undefined, { delivered: true });
      return;
    }
    const entity = this.entities.get(input.entityId);
    if (!entity) return this.fail(action, "ENTITY_NOT_FOUND");
    if (input.type === "drop") {
      if (entity.ownerId !== agent.id || !agent.inventory.includes(entity.id))
        return this.fail(action, "NOT_OWNER");
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
      this.navigation.updateObstacles(this.entityList());
      this.finish(action, "succeeded");
      return;
    }
    if (entity.ownerId && entity.ownerId !== agent.id)
      return this.fail(action, "OBJECT_UNAVAILABLE");
    if (
      distance(agent.position, entity.position) >
      INTERACTION_RANGE + entityRadius(entity)
    )
      return this.fail(action, "OUT_OF_RANGE");
    if (
      entity.ownerId !== agent.id &&
      !canSee(agent, entity.position, this.entityList(), entity.id)
    )
      return this.fail(action, "NOT_VISIBLE");
    if (input.type === "inspect") {
      if (!entity.properties.inspectable)
        return this.fail(action, "NOT_INSPECTABLE");
      this.finish(action, "succeeded", undefined, {
        type: entity.type,
        properties: { ...entity.properties },
        activated: entity.activated,
      });
      return;
    }
    if (input.type === "interact") {
      if (entity.type !== "artifact")
        return this.fail(action, "UNSUPPORTED_INTERACTION");
      entity.activated = true;
      this.finish(action, "succeeded", undefined, { activated: true });
      return;
    }
    if (!entity.properties.movable) return this.fail(action, "NOT_MOVABLE");
    if (entity.ownerId) return this.fail(action, "OBJECT_UNAVAILABLE");
    if (agent.inventory.length) return this.fail(action, "INVENTORY_FULL");
    entity.ownerId = agent.id;
    entity.position = { ...agent.position };
    agent.inventory.push(entity.id);
    this.navigation.updateObstacles(this.entityList());
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
        const next = this.navigation.point(
          agent.position.x + ((target.x - agent.position.x) * step) / d,
          agent.position.z + ((target.z - agent.position.z) * step) / d,
        );
        if (
          !this.navigation.canTraverse(agent.position, next) ||
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
