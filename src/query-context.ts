import { parseContextRef } from "./context-ref.js";
import type { PiSessionEntry, ReadonlyPiSessionManager } from "./pi-types.js";

export interface ContextResolver {
  currentSession(): ReadonlyPiSessionManager;
  sessionById(sessionId: string): ReadonlyPiSessionManager | undefined;
}

export interface QueryContextInput {
  contextRef: string;
  query: string;
  limit?: number;
}

export interface QueryContextResult {
  contextRef: string;
  query: string;
  matches: string[];
}

export class SessionContextIndex implements ContextResolver {
  private readonly sessions = new Map<string, ReadonlyPiSessionManager>();

  constructor(private readonly active: ReadonlyPiSessionManager) {
    this.register(active);
  }

  currentSession(): ReadonlyPiSessionManager {
    return this.active;
  }

  register(session: ReadonlyPiSessionManager): void {
    this.sessions.set(session.getSessionId(), session);
  }

  sessionById(sessionId: string): ReadonlyPiSessionManager | undefined {
    return this.sessions.get(sessionId);
  }
}

export function queryContext(resolver: ContextResolver, input: QueryContextInput): QueryContextResult {
  const { sessionId, leafId, entryId } = parseContextRef(input.contextRef);
  const session = resolver.sessionById(sessionId);
  if (!session) {
    throw new Error(`No session registered for contextRef session ${sessionId}`);
  }

  const entries = selectEntries(session, leafId, entryId);
  const haystack = entries.flatMap(entryToSearchableLines);
  const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length === 0
    ? haystack
    : haystack.filter((line) => terms.some((term) => line.toLowerCase().includes(term)));

  return {
    contextRef: input.contextRef,
    query: input.query,
    matches: matches.slice(0, input.limit ?? 5),
  };
}

function selectEntries(session: ReadonlyPiSessionManager, leafId?: string, entryId?: string): readonly PiSessionEntry[] {
  const entries = session.getEntries?.() ?? session.getBranch?.(leafId) ?? [];
  if (entryId) {
    return entries.filter((entry) => entry.id === entryId);
  }
  if (session.getBranch) {
    return session.getBranch(leafId);
  }
  return entries;
}

function entryToSearchableLines(entry: PiSessionEntry): string[] {
  const lines = [`entry:${entry.id} type:${entry.type}`];
  collectStrings(entry.message, lines);
  collectStrings(entry.content, lines);
  collectStrings(entry.summary, lines);
  return lines;
}

function collectStrings(value: unknown, lines: string[]): void {
  if (typeof value === "string") {
    lines.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, lines);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectStrings(item, lines);
  }
}
