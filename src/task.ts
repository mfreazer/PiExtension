import type { MeshStatus } from "./protocol.js";

export interface MeshTask {
  taskId: string;
  parentTaskId?: string;
  objective: string;
  contextRef: string;
  status: MeshStatus | "PENDING" | "RUNNING";
}

export function createMeshTask(input: MeshTask): MeshTask {
  if (!input.taskId.trim()) throw new Error("taskId is required");
  if (!input.objective.trim()) throw new Error("objective is required");
  if (!input.contextRef.startsWith("ctx:")) throw new Error("contextRef must start with ctx:");
  return { ...input };
}
