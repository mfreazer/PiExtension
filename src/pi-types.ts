export interface PiSessionEntry {
  id: string;
  parentId?: string | null;
  type: string;
  message?: { role?: string; content?: unknown };
  content?: unknown;
  summary?: string;
  customType?: string;
}

export interface ReadonlyPiSessionManager {
  getSessionId(): string;
  getLeafId?(): string | undefined;
  getEntries?(): readonly PiSessionEntry[];
  getBranch?(leafId?: string): readonly PiSessionEntry[];
  buildContextEntries?(leafId?: string): readonly PiSessionEntry[];
}

export interface PiToolDefinition<TInput = unknown, TResult = unknown> {
  name: string;
  description: string;
  inputSchema: unknown;
  execute(input: TInput): Promise<TResult> | TResult;
}

export interface PiAppendEntryInput {
  type: "custom" | "custom_message";
  customType: string;
  content: unknown;
  display?: unknown;
}

export interface PiExtensionAPI {
  registerTool(tool: PiToolDefinition): void;
  appendEntry?(entry: PiAppendEntryInput): Promise<void> | void;
  sendMessage?(message: unknown): Promise<void> | void;
}

export interface PiExtensionContext {
  sessionManager: ReadonlyPiSessionManager;
}
