import { makeContextRef } from "./context-ref.js";
import { queryContext, type QueryContextInput, type QueryContextResult, SessionContextIndex } from "./query-context.js";
import { createMeshTask, type MeshTask } from "./task.js";
import { validateMeshMessage, type MeshMessage, type MeshResult } from "./protocol.js";
import type { PiExtensionAPI, PiExtensionContext, ReadonlyPiSessionManager } from "./pi-types.js";

export interface SpawnTaskInput {
  taskId: string;
  receiver: string;
  objective: string;
  summary: string;
}

export interface SpawnTaskResult {
  task: MeshTask;
  message: MeshMessage;
}

export interface ChildRunner {
  runChild(task: MeshTask, message: MeshMessage, tools: { queryContext(input: QueryContextInput): QueryContextResult }): Promise<MeshResult>;
  childSession(): ReadonlyPiSessionManager;
}

export interface ContextMeshExtensionOptions {
  childRunner?: ChildRunner;
}

export function activate(pi: PiExtensionAPI, context: PiExtensionContext, options: ContextMeshExtensionOptions = {}): SessionContextIndex {
  const index = new SessionContextIndex(context.sessionManager);

  pi.registerTool({
    name: "query_context",
    description: "Retrieve a targeted slice from an addressable Pi session context without copying the full context.",
    inputSchema: {
      type: "object",
      required: ["contextRef", "query"],
      properties: {
        contextRef: { type: "string" },
        query: { type: "string" },
        limit: { type: "number" },
      },
    },
    execute(input: QueryContextInput): QueryContextResult {
      return queryContext(index, input);
    },
  });

  pi.registerTool({
    name: "spawn_context_mesh_task",
    description: "Create a compact Context-Mesh task message containing only a summary and contextRef.",
    inputSchema: {
      type: "object",
      required: ["taskId", "receiver", "objective", "summary"],
      properties: {
        taskId: { type: "string" },
        receiver: { type: "string" },
        objective: { type: "string" },
        summary: { type: "string" },
      },
    },
    async execute(input: SpawnTaskInput): Promise<SpawnTaskResult | MeshResult> {
      const parentSessionId = context.sessionManager.getSessionId();
      const parentLeafId = context.sessionManager.getLeafId?.() ?? "latest";
      const contextRef = makeContextRef({ sessionId: parentSessionId, leafId: parentLeafId });
      const task = createMeshTask({
        taskId: input.taskId,
        objective: input.objective,
        contextRef,
        status: "PENDING",
      });
      const message = validateMeshMessage({
        sender: parentSessionId,
        receiver: input.receiver,
        summary: input.summary,
        contextRef,
      });

      await pi.appendEntry?.({
        type: "custom",
        customType: "context-mesh.task",
        content: { task, message },
      });

      if (!options.childRunner) {
        return { task, message };
      }

      const result = await options.childRunner.runChild(task, message, {
        queryContext: (queryInput) => queryContext(index, queryInput),
      });
      index.register(options.childRunner.childSession());
      await pi.appendEntry?.({
        type: "custom_message",
        customType: "context-mesh.result",
        content: {
          sender: input.receiver,
          receiver: parentSessionId,
          summary: result.summary,
          contextRef: result.contextRef,
          status: result.status,
        },
      });
      return result;
    },
  });

  return index;
}
