export type MeshRole = "parent" | "child" | string;

export type MeshStatus = "PASS" | "FAIL" | "UNCERTAIN" | "BLOCKED";

export interface MeshMessage {
  sender: MeshRole;
  receiver: MeshRole;
  summary: string;
  contextRef: string;
}

export interface MeshResult {
  summary: string;
  contextRef: string;
  status: MeshStatus;
}

export function validateMeshMessage(message: MeshMessage): MeshMessage {
  if (!message.summary?.trim()) {
    throw new Error("Context-Mesh messages require a non-empty summary");
  }
  if (!message.contextRef?.trim()) {
    throw new Error("Context-Mesh messages require a non-empty contextRef");
  }
  if (!message.contextRef.startsWith("ctx:")) {
    throw new Error("Context-Mesh contextRef must use the ctx:<session-id>#<scope> format");
  }
  return message;
}

export function assertNoEmbeddedContext(message: MeshMessage, forbiddenFullContext: string): void {
  validateMeshMessage(message);
  if (forbiddenFullContext.trim() && message.summary.includes(forbiddenFullContext)) {
    throw new Error("Context-Mesh message embeds complete context in summary");
  }
}
