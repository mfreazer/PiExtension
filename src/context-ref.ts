export interface ContextRefParts {
  sessionId: string;
  leafId?: string;
  entryId?: string;
}

export function makeContextRef(parts: ContextRefParts): string {
  if (!parts.sessionId.trim()) {
    throw new Error("sessionId is required to create a contextRef");
  }
  const scope = parts.entryId ? `entry:${parts.entryId}` : `leaf:${parts.leafId ?? "latest"}`;
  return `ctx:pi-session:${encodeURIComponent(parts.sessionId)}#${scope}`;
}

export function parseContextRef(contextRef: string): ContextRefParts {
  if (!contextRef.startsWith("ctx:pi-session:")) {
    throw new Error(`Unsupported contextRef: ${contextRef}`);
  }
  const [, rawSessionAndScope = ""] = contextRef.split("ctx:pi-session:");
  const [encodedSessionId, scope = "leaf:latest"] = rawSessionAndScope.split("#");
  const sessionId = decodeURIComponent(encodedSessionId ?? "");
  if (!sessionId) {
    throw new Error(`Missing session id in contextRef: ${contextRef}`);
  }
  if (scope.startsWith("entry:")) {
    return { sessionId, entryId: scope.slice("entry:".length) };
  }
  if (scope.startsWith("leaf:")) {
    return { sessionId, leafId: scope.slice("leaf:".length) };
  }
  throw new Error(`Unsupported contextRef scope: ${scope}`);
}
