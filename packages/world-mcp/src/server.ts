import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import {
  vectorSchema,
  artifactConsiderationSchema,
  type ActionExplanation,
  type AgentObservation,
  type WorldActionInput,
} from "../../shared/src/index.js";

const motivation = z
  .string()
  .min(1)
  .max(500)
  .describe(
    "Brief public reason for the chosen action; do not include private reasoning.",
  );
const entityId = z.string().min(1).max(80);
const reason = {
  motivation,
  artifactConsiderations: z
    .array(artifactConsiderationSchema)
    .max(8)
    .optional()
    .describe(
      "Brief public assessments of visible artifacts: why collect, approach, keep, defer or leave each one. No private reasoning.",
    ),
};
export const worldTools = [
  {
    name: "world_observe",
    description:
      "Read only your own current observation, visible objects, messages and previous action result.",
    schema: z.strictObject({}),
  },
  {
    name: "world_move",
    description:
      "Propose walking to a world position in metres. Server computes height and a collision-free route. Result arrives in your next observation.",
    schema: z.strictObject({ target: vectorSchema, ...reason }),
  },
  {
    name: "world_inspect",
    description:
      "Propose inspecting a visible object within 3 metres of its edge. Details arrive next turn.",
    schema: z.strictObject({ entityId, ...reason }),
  },
  {
    name: "world_interact",
    description:
      "Propose activating a visible artifact within interaction range.",
    schema: z.strictObject({
      entityId,
      interaction: z.literal("activate"),
      ...reason,
    }),
  },
  {
    name: "world_pickup",
    description:
      "Collect a free portable artifact to carry and study it. Check observed pickup eligibility and distance; approach first when OUT_OF_RANGE. Capacity is one object. Explain why you choose this find or leave alternatives.",
    schema: z.strictObject({ entityId, ...reason }),
  },
  {
    name: "world_drop",
    description:
      "Propose dropping your own carried object nearby, without overlapping agents or objects.",
    schema: z.strictObject({ entityId, target: vectorSchema, ...reason }),
  },
  {
    name: "world_communicate",
    description:
      "Propose sending a short message to an agent you can currently see within 25 metres.",
    schema: z.strictObject({
      recipientId: entityId,
      message: z.string().min(1).max(500),
      ...reason,
    }),
  },
  {
    name: "world_look",
    description:
      "Propose turning in radians: 0 faces +z, pi/2 faces +x. FOV is 120 degrees. New view arrives next turn.",
    schema: z.strictObject({
      orientation: z.number().min(-Math.PI).max(Math.PI),
      ...reason,
    }),
  },
  {
    name: "world_wait",
    description:
      "Propose waiting in simulation time, between 50 and 60000 milliseconds.",
    schema: z.strictObject({
      durationMs: z.number().int().min(50).max(60000),
      ...reason,
    }),
  },
] as const;
export interface ToolTrace {
  tool: string;
  arguments: unknown;
  result: unknown;
  success: boolean;
}
export interface WorldToolSession {
  client: Client;
  proposed():
    | ({ action: WorldActionInput; motivation: string } & ActionExplanation)
    | null;
  call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{
    contentItems: { type: "inputText"; text: string }[];
    success: boolean;
  }>;
  close(): Promise<void>;
}
/** Each session is capability-bound to one observation. No agent ID or engine handle is accepted from the model. */
export async function createWorldToolSession(
  observation: AgentObservation,
  trace: (entry: ToolTrace) => void = () => {},
): Promise<WorldToolSession> {
  const frozen = structuredClone(observation);
  let proposal:
    | ({ action: WorldActionInput; motivation: string } & ActionExplanation)
    | null = null;
  let closed = false;
  const server = new McpServer({
    name: "agent-island-world",
    version: "0.3.0",
  });
  const handle = (name: string, args: unknown) => {
    const tool = worldTools.find((t) => t.name === name);
    if (closed) return { success: false, error: "SESSION_CLOSED" };
    if (!tool) return { success: false, error: "TOOL_NOT_ALLOWED" };
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) return { success: false, error: "INVALID_TOOL_INPUT" };
    if (name === "world_observe")
      return { success: true, observation: structuredClone(frozen) };
    if (proposal) return { success: false, error: "ONE_ACTION_PER_TURN" };
    const values = parsed.data as Record<string, unknown>;
    if (
      ["world_inspect", "world_interact", "world_pickup"].includes(name) &&
      !frozen.visibleEntities.some((e) => e.id === values.entityId)
    )
      return { success: false, error: "ENTITY_NOT_OBSERVED" };
    if (
      name === "world_drop" &&
      !frozen.inventory.includes(values.entityId as string)
    )
      return { success: false, error: "NOT_OWNER" };
    if (
      name === "world_communicate" &&
      !frozen.visibleAgents.some((a) => a.id === values.recipientId)
    )
      return { success: false, error: "RECIPIENT_NOT_VISIBLE" };
    const {
      motivation: explanation,
      artifactConsiderations,
      ...input
    } = parsed.data as Record<string, unknown>;
    proposal = {
      action: {
        type: name.slice("world_".length),
        ...input,
      } as WorldActionInput,
      motivation: explanation as string,
      ...(artifactConsiderations
        ? {
            artifactConsiderations:
              artifactConsiderations as ActionExplanation["artifactConsiderations"],
          }
        : {}),
    };
    return {
      success: true,
      status: "proposed",
      message:
        "Action proposed for the central tick queue. End this turn; execution result follows in the next observation.",
    };
  };
  for (const tool of worldTools)
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema as z.ZodType },
      async (args: unknown) => {
        const result = handle(tool.name, args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          isError: !result.success,
        };
      },
    );
  const client = new Client({ name: "agent-island-runtime", version: "0.3.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    proposed: () => (proposal ? structuredClone(proposal) : null),
    async call(name, args) {
      let result: unknown;
      let success = false;
      try {
        const tool = worldTools.find((t) => t.name === name);
        if (closed) result = { success: false, error: "SESSION_CLOSED" };
        else if (!tool) result = { success: false, error: "TOOL_NOT_ALLOWED" };
        else if (!tool.schema.safeParse(args).success)
          result = { success: false, error: "INVALID_TOOL_INPUT" };
        else {
          const response = await client.callTool({ name, arguments: args });
          const text = response.content as { type: string; text?: string }[];
          result = JSON.parse(
            text
              .filter((c) => c.type === "text")
              .map((c) => c.text)
              .join(""),
          );
          success = !response.isError;
        }
      } catch {
        result = { success: false, error: "MCP_TOOL_FAILED" };
      }
      trace({
        tool: name,
        arguments: structuredClone(args),
        result: structuredClone(result),
        success,
      });
      return {
        contentItems: [{ type: "inputText", text: JSON.stringify(result) }],
        success,
      };
    },
    async close() {
      if (closed) return;
      closed = true;
      await Promise.allSettled([client.close(), server.close()]);
    },
  };
}
export function dynamicWorldTools() {
  return worldTools.map((tool) => ({
    type: "function" as const,
    name: tool.name,
    deferLoading: false,
    description: tool.description,
    inputSchema: z.toJSONSchema(tool.schema),
  }));
}
