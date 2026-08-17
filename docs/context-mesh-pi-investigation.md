# Context-Mesh Pi Upstream Investigation

## Exact upstream repository

- Upstream repository: <https://github.com/earendil-works/pi>
- Target coding-agent package lineage: the upstream README identifies `@earendil-works/pi-coding-agent` as the interactive coding agent CLI and `@earendil-works/pi-agent-core` as the agent runtime package.
- Local `git clone https://github.com/earendil-works/pi` failed in this environment with `CONNECT tunnel failed, response 403`; source inspection therefore used GitHub-rendered and raw source URLs for the upstream `main` branch.

## Commit / version inspected

- Latest release visible during the investigation: `v0.84.2`, released 2026-08-14, with short commit `914cf14` shown on the upstream releases page.
- Source files were inspected from `refs/heads/main` raw GitHub URLs on 2026-08-17. Because clone/API access was blocked by a 403 proxy response, I could not independently resolve the full current `main` SHA. All source claims below cite exact upstream file paths and symbols from the inspected raw files.

## Relevant packages

- `packages/coding-agent`: CLI, extension system, session manager, SDK/runtime-facing `AgentSession`, RPC/interactive integration.
- `packages/agent`: newer harness/session abstractions; package list shows this package, while public docs still refer to the package role as `pi-agent-core`.
- `packages/ai`: LLM model/provider API consumed by agent and compaction code.
- `packages/session-backends/sqlite-node`: present in the package tree; not needed for the first prototype recommendation below unless the prototype targets the newer harness storage abstraction.

## Relevant source files inspected

- `packages/coding-agent/src/core/agent-session.ts` — `AgentSession`, lifecycle, extension binding, prompt/send APIs, tool hooks, compaction plumbing.
- `packages/coding-agent/src/core/extensions/types.ts` — `ExtensionAPI`, event types, command/tool registration, `ExtensionContext`, `ReadonlySessionManager` access.
- `packages/coding-agent/src/core/extensions/runner.ts` — extension runner implementation and action plumbing.
- `packages/coding-agent/src/core/session-manager.ts` — JSONL session model, entries, context building, compaction entries, custom entries/messages.
- `packages/agent/src/harness/agent-harness.ts` — v2-style `AgentHarness`, lanes, hooks, lane interface, session tree access.
- `packages/agent/src/harness/session/session.ts` — durable `Session` wrapper over `SessionStorage`, branch querying, lane support, custom entries.
- `packages/agent/src/harness/session/context.ts` and `packages/agent/src/harness/session/types.ts` — v2 session context/storage types.
- `packages/agent/src/harness/compaction/compaction.ts` — compaction settings, preparation, summary generation, retained tail.
- `packages/coding-agent/docs/sdk.md`, `docs/extensions.md`, `docs/session-format.md`, and `docs/compaction.md` were used only to orient the source search; architectural claims below are grounded in source symbols.

## Actual session / context model

### Coding-agent JSONL session model

`packages/coding-agent/src/core/session-manager.ts` defines `SessionHeader`, `SessionEntryBase`, and a `SessionEntry` union. Entries are append-only JSONL records with `id`, `parentId`, and `timestamp`; the union includes message, compaction, branch summary, custom, custom message, label, and session-info entries. Important symbols:

- `SessionHeader` carries `type: "session"`, `version`, `id`, `timestamp`, `cwd`, and optional `parentSession`.
- `SessionEntryBase` carries `type`, `id`, `parentId`, and `timestamp`.
- `SessionMessageEntry` stores an `AgentMessage`.
- `CompactionEntry` stores `summary`, `firstKeptEntryId`, `tokensBefore`, optional `details`, optional `usage`, and optional `fromHook`.
- `BranchSummaryEntry` stores `fromId`, `summary`, optional `details`, optional `usage`, and optional `fromHook`.
- `CustomEntry` is explicitly for extension state and does **not** participate in LLM context.
- `CustomMessageEntry` is for extension-injected content and **does** participate in LLM context.
- `ReadonlySessionManager` exposes read APIs to extensions, including `getSessionId`, `getSessionFile`, `getLeafId`, `getLeafEntry`, `getEntry`, `getBranch`, `buildContextEntries`, `getHeader`, `getEntries`, `getTree`, and `getSessionName`.

Source: `packages/coding-agent/src/core/session-manager.ts` symbols `SessionHeader`, `SessionEntryBase`, `SessionEntry`, `CustomEntry`, `CustomMessageEntry`, `ReadonlySessionManager`, `buildContextEntries`, and `buildSessionContext`.

### Context construction

`sessionEntryToContextMessages(entry)` projects session entries into model-visible context. Plain `custom` entries return no context messages; `custom_message`, `branch_summary`, and `compaction` entries become model-visible messages. `buildContextEntries(entries, leafId)` follows the active branch and, if a compaction entry exists, returns the latest compaction summary plus kept entries instead of the full historical prefix. `buildSessionContext(entries, leafId)` then flattens those context entries into `AgentMessage[]`.

This directly supports the required distinction:

- full context: JSONL session file / full entry list;
- working context: `buildContextEntries` / `buildSessionContext` output;
- compact message: extension-defined custom message or tool result containing summary plus a reference.

Source: `packages/coding-agent/src/core/session-manager.ts` symbols `sessionEntryToContextMessages`, `buildContextEntries`, and `buildSessionContext`.

### Agent-harness session model

`packages/agent/src/harness/session/session.ts` defines `Session<TMetadata>` over `SessionStorage`. It exposes `findEntries`, `findEntry`, `findEntriesOnBranch`, `appendMessage`, `appendCustomEntry`, `appendEntry`, `appendRecord`, `findRecords`, `getLog`, `getLanes`, `createLane`, and `moveLane`. `view(lane)` returns a lane-scoped `SessionTree` with read/query/append methods. This is a cleaner future substrate for multi-agent lanes, but many `AgentHarness` runtime operations are currently unavailable in the inspected `AgentHarness` implementation.

Source: `packages/agent/src/harness/session/session.ts` symbols `Session`, `view`, `findEntriesOnBranch`, `appendCustomEntry`, `createLane`, and `moveLane`.

## Message representation

The coding-agent imports `AgentMessage`, `AgentState`, `AgentTool`, and event types from `@earendil-works/pi-agent-core` in `AgentSession`. Session persistence stores messages through `SessionMessageEntry.message: AgentMessage`. Extension custom messages use `CustomMessage` / `CustomMessageEntry`; custom messages include `customType`, `content`, `details`, and `display` and participate in LLM context when converted by `sessionEntryToContextMessages`.

For the Context-Mesh protocol, the clean representation is an extension-owned custom entry for durable mesh state plus a model-visible tool result or custom message containing only `{ sender, receiver, summary, context_ref }`. Full sender context should not be sent as `CustomMessageEntry` content unless intentionally visible to the model.

Source: `packages/coding-agent/src/core/agent-session.ts` imports `AgentMessage`, `AgentState`, and `AgentTool`; `packages/coding-agent/src/core/session-manager.ts` symbols `SessionMessageEntry`, `CustomEntry`, and `CustomMessageEntry`.

## Agent lifecycle

`AgentSession` is the main coding-agent lifecycle facade. The file-level comment states it encapsulates agent state access, event subscription with session persistence, model/thinking-level management, compaction, bash execution, and session switching/branching. The class owns an `Agent`, a `SessionManager`, settings/model runtime, event listener lists, queue state, compaction/branch-summary abort controllers, extension runner, tool registry, and system prompt state.

Important lifecycle APIs and fields:

- `AgentSessionConfig` requires `agent`, `sessionManager`, `settingsManager`, `cwd`, `resourceLoader`, `modelRuntime`, optional `customTools`, tool allow/deny lists, and extension runner references.
- Constructor subscribes to agent events, installs tool hooks, installs next-turn refresh, and builds runtime.
- `prompt`, `steer`, `followUp`, `sendCustomMessage`, and `sendUserMessage` are the relevant turn/message injection APIs.
- `subscribe(listener)` is exposed by SDK docs and backed by `AgentSessionEvent` listeners.

Source: `packages/coding-agent/src/core/agent-session.ts` symbols `AgentSession`, `AgentSessionConfig`, `AgentSessionEvent`, `PromptOptions`, `sendCustomMessage`, and `sendUserMessage`.

## Actual extension points

`ExtensionAPI` supports:

- event subscription via `pi.on(...)` for session, context, provider, agent, turn, message, tool, user bash, and input events;
- `registerTool(tool)` for LLM-callable tools;
- `registerCommand`, `registerShortcut`, and `registerFlag`;
- renderers/markdown transformers;
- `sendMessage`, `sendUserMessage`, and `appendEntry`;
- session metadata (`setSessionName`, `getSessionName`, `setLabel`);
- `exec`, tool listing/activation, command listing;
- model/thinking-level control;
- provider registration;
- shared `events: EventBus` for extension communication.

Important event hooks for Context-Mesh:

- `context` can return `ContextEventResult` with replacement/additional `messages`.
- `before_agent_start` can return a custom message and/or system-prompt replacement.
- `message_end` can replace a finalized message while preserving role.
- `tool_call` can block/mutate tool input.
- `tool_result` can modify tool output.
- `session_before_compact` can cancel or provide a compaction result.
- `session_compact` observes compaction.
- `session_before_tree` can cancel or provide branch summary data.

Source: `packages/coding-agent/src/core/extensions/types.ts` symbols `ExtensionAPI`, `ExtensionContext`, `ExtensionCommandContext`, `ContextEventResult`, `BeforeAgentStartEventResult`, `SessionBeforeCompactResult`, `SessionBeforeTreeResult`, `ToolCallEventResult`, and `ToolResultEventResult`.

## Actual SDK/API mechanisms

The SDK documentation and source exports show `createAgentSession()` as the factory for a single `AgentSession`; it can accept a `SessionManager`, model runtime, tools, and resource loader. The SDK also documents `createAgentSessionRuntime()` / `AgentSessionRuntime` for replacing the active session across new-session, switch, fork, clone, and import flows.

Important API conclusions:

- Programmatic embedding can create more than one `AgentSession` by calling the SDK factory multiple times from an external host process.
- The extension API itself does **not** expose `createAgentSession()` or an in-process child-session factory on `ExtensionAPI`.
- The extension context exposes a read-only `sessionManager`, not a mutable child-session creation API.
- `sendUserMessage` and `sendMessage` inject into the current active session, not a separate independent agent session.

Source: `packages/coding-agent/docs/sdk.md` section `createAgentSession()` / `AgentSession`; `packages/coding-agent/src/core/extensions/types.ts` symbols `ExtensionAPI`, `ExtensionContext.sessionManager`, `sendMessage`, and `sendUserMessage`.

## Persistence

The existing coding-agent session store is a strong candidate for addressable context references:

- JSONL sessions already contain full conversation history.
- Entries have stable `id` and `parentId` values.
- The session file path and session id are exposed read-only through `ReadonlySessionManager`.
- `CustomEntry` is designed for extension state and does not pollute LLM context.
- `CustomMessageEntry` can be used when a compact mesh message should be visible in the transcript/model context.

For a prototype, a `context_ref` can be a structured string that references a session and entry/branch, for example:

```text
pi-session:<sessionId>#entry:<entryId>
pi-session:<sessionId>#branch:<leafId>
```

The query tool can resolve the session file via a small extension-owned index stored as `CustomEntry` or in an external JSON/SQLite store. However, because `ReadonlySessionManager` is scoped to the current session, querying another session's JSONL file from an extension may require direct filesystem reads or an external store.

Source: `packages/coding-agent/src/core/session-manager.ts` symbols `ReadonlySessionManager`, `CustomEntry`, `loadEntriesFromFile`, `buildContextEntries`, and `buildSessionContext`.

## Compaction / context reduction model

Pi's compaction model is already aligned with "compress visible, preserve addressable":

- `CompactionEntry` stores a summary and `firstKeptEntryId`, while older JSONL entries remain in the session file.
- `buildContextEntries` uses the latest compaction entry to construct working context as summary plus kept tail, omitting older entries from the model-visible context without deleting them from storage.
- `CompactionResult` stores `summary`, `tokensBefore`, optional `usage`, `retainedTail`, and optional details.
- `prepareCompaction(pathEntries, settings)` computes `messagesToSummarize`, `turnPrefixMessages`, `retainedTail`, split-turn status, previous summary, file operations, and settings.
- `compact(...)` constructs a summarization prompt from serialized conversation, calls the model via `completeSimpleWithRetries`, and returns generated summary data.
- `session_before_compact` can cancel or inject an extension-provided compaction result.

Source: `packages/coding-agent/src/core/session-manager.ts` symbols `CompactionEntry` and `buildContextEntries`; `packages/agent/src/harness/compaction/compaction.ts` symbols `CompactionSettings`, `CompactResult`, `prepareCompaction`, `completeSimpleWithRetries`, and `compact`; `packages/coding-agent/src/core/extensions/types.ts` symbol `SessionBeforeCompactResult`.

## Context querying

Pi has branch/entry retrieval mechanisms, but no verified built-in semantic query API over arbitrary sessions:

- In coding-agent, `ReadonlySessionManager` exposes current-session reads (`getEntry`, `getBranch`, `buildContextEntries`, `getEntries`, `getTree`).
- In the newer `packages/agent` session abstraction, `Session.findEntries`, `findEntry`, `findEntriesOnBranch`, and query objects support selective traversal over stored entries.
- Neither inspected extension API nor `AgentSession` exposes a cross-session `query_context(context_ref, query)` semantic retrieval API.

Therefore the smallest prototype should register a custom `query_context` tool. The first implementation should parse a `context_ref`, load/inspect the referenced session branch or extension-owned context object, and return only matched/relevant snippets using exact text search. This avoids copying full context into the receiver's prompt and uses Pi's persisted sessions/custom entries as the addressable substrate.

Source: `packages/coding-agent/src/core/extensions/types.ts` symbol `ExtensionAPI.registerTool`; `packages/coding-agent/src/core/session-manager.ts` symbols `ReadonlySessionManager`, `getEntry`, `getBranch`, and `buildContextEntries`; `packages/agent/src/harness/session/session.ts` symbols `findEntries` and `findEntriesOnBranch`.

## Existing multi-agent / subagent mechanisms

The upstream README explicitly says Pi ships without built-in subagents and plan mode, but extensions can implement them. The current release notes mention a "subagent example" fixes, which indicates examples exist in the upstream tree, but I did not rely on that example as a built-in framework.

Source search conclusions from inspected APIs:

- `ExtensionAPI` provides enough hooks to build subagent-like behavior externally: custom tools, commands, message injection, custom entries, and event bus.
- SDK docs explicitly list "Build custom tools that spawn sub-agents" as an SDK use case.
- No `ExtensionAPI.createAgentSession`, `spawnAgent`, `subagent`, or `delegate` method was found in `ExtensionAPI`.
- `packages/agent/src/harness/agent-harness.ts` defines lane concepts (`AgentLane`, `createLane`, `lane`, `lanes`), but in the inspected implementation many operational methods return `HarnessNotImplemented`, so it should not be treated as a production-ready extension integration point without deeper version-specific validation.

Source: `packages/coding-agent/src/core/extensions/types.ts` symbol `ExtensionAPI`; `packages/agent/src/harness/agent-harness.ts` symbols `AgentLane`, `createLane`, `lane`, `lanes`, `HarnessNotImplemented`, and `UnavailableRegistry`.

## Can Pi create/control multiple independent agent sessions from an extension or SDK?

- **SDK:** Yes, from an external embedding application, the SDK can create `AgentSession` instances with `createAgentSession()`; `AgentSessionRuntime` can replace/fork/switch the active session. This is the cleanest verified mechanism for multiple independent sessions.
- **Extension:** Not directly verified. `ExtensionAPI` does not expose a child-session factory. An extension can inject messages into the current session, store state, register tools, and use `exec` to launch external processes, but those are not the same as directly controlling independent in-process sessions.
- **Core/harness package:** `AgentHarness`/`AgentLane` points toward lanes and session tree abstractions, but the inspected `AgentHarness` implementation returns `HarnessNotImplemented` for core run/compact/navigation/queue/watch/lane operations. Treat as not ready for the smallest extension prototype unless upstream evolves.

Source: `packages/coding-agent/docs/sdk.md` symbols `createAgentSession`, `AgentSession`, and `AgentSessionRuntime`; `packages/coding-agent/src/core/extensions/types.ts` symbol `ExtensionAPI`; `packages/agent/src/harness/agent-harness.ts` symbols `AgentHarness`, `AgentLane`, and `HarnessNotImplemented`.

## Candidate integration architectures

### A. Pi extension only

Pros:
- Best fit for tool registration (`spawn_task`, `query_context`) and message protocol validation.
- Can persist mesh state as `CustomEntry` without adding prompt pollution.
- Can use `sendMessage`/`sendUserMessage` to expose compact summaries to the current session.
- Can hook compaction/context events.

Cons:
- No verified in-extension API to create independent child `AgentSession` objects.
- Worker B would either be simulated in the same session, launched via external process, or coordinated by an external SDK host.

### B. External SDK host/package

Pros:
- Verified SDK path can create and control multiple `AgentSession` instances.
- Cleanly models stateless workers and task/context state in the host.
- Can use Pi's session files as addressable contexts and custom tools inside each session.

Cons:
- Less like a pure Pi extension; requires running an embedding app/harness.
- Needs careful handling of credentials/settings/resource loaders.

### C. Pi core modification

Pros:
- Could expose first-class task/session spawning and cross-session context query APIs.
- Could use session manager internals without filesystem re-parsing.

Cons:
- Too invasive for a prototype.
- Violates the "minimum vertical slice" goal unless extension/SDK proves impossible.

### D. Extension + external task/context store

Pros:
- Most practical extension-first prototype if independent child sessions are not required in-process.
- Extension registers tools and stores mesh task records in `CustomEntry` plus optional JSON/SQLite sidecar.
- External SDK worker can run child sessions and write results back via the store/protocol.

Cons:
- More moving pieces than SDK-only.
- If implemented with subprocess CLI agents, it may validate process orchestration more than in-process context semantics.

### E. New `packages/agent` lanes/harness

Pros:
- `AgentLane` and session lanes map conceptually to multiple workers over shared durable session state.

Cons:
- The inspected `AgentHarness` has many core methods stubbed with `HarnessNotImplemented`; not safe as the smallest prototype target yet.

## Rejected alternatives

- Copying full parent context into child prompt: rejected because Pi already distinguishes full session entries from working context, and copying violates the Context-Mesh semantics.
- Treating compaction as destructive memory: rejected because Pi's compaction keeps full JSONL history and only changes working context projection.
- Building a vector database first: rejected; source shows exact entry/branch access and JSONL persistence are enough for the minimal query tool.
- Implementing in `packages/agent` lanes first: rejected for the first prototype because the inspected `AgentHarness` run/lane operations are not fully implemented.
- Pure extension spawning independent in-process sessions: rejected as unverified; `ExtensionAPI` has no session factory.

## Precise recommendation for the smallest prototype

Build the v0 prototype as **an external SDK harness plus a small Pi extension package**, not as a core fork.

1. **Extension responsibilities**
   - Register `spawn_context_mesh_task` and `query_context` tools with `pi.registerTool`.
   - Validate inter-agent messages require `summary` and `context_ref`.
   - Persist mesh task/message metadata as `CustomEntry` so it does not enter LLM context.
   - Optionally render compact mesh messages with `registerMessageRenderer` or inject compact summaries through `sendMessage` only when the parent should see them.
   - Use `session_before_compact` only if the prototype needs custom compaction metadata; do not replace Pi's default compaction initially.

2. **SDK harness responsibilities**
   - Create/control Agent A and Agent B as independent `AgentSession` instances via `createAgentSession()`.
   - Store task state externally in a simple JSON or SQLite file keyed by `task_id`.
   - Store `context_ref` values that point to Pi session id/file and leaf/entry id.
   - Run child worker sessions with only the compact task summary and context reference.
   - Provide `query_context(context_ref, query)` to each worker as an extension/SDK custom tool that returns only relevant snippets from the referenced session entries.

3. **Context reference format**

```text
pi-session:<sessionId>#leaf:<entryId>
pi-session:<sessionId>#entry:<entryId>
mesh-context:<id>
```

4. **Why this is smallest**
   - It uses verified Pi SDK mechanisms for independent sessions.
   - It uses verified extension mechanisms for tools, custom entries, message injection, and context hooks.
   - It reuses Pi JSONL sessions as the full addressable context store.
   - It avoids modifying core and avoids external infrastructure beyond a local task/index file.

## Open risks / items to verify before implementation

- Resolve the exact full upstream `main` SHA once network allows `git clone` or GitHub API access.
- Inspect the upstream subagent example referenced by release notes before designing the SDK harness; it may already solve child-session setup/config propagation.
- Confirm whether package namespace should target `@earendil-works/pi-coding-agent` or the compatibility/fork namespace `@mariozechner/pi-coding-agent` required by the user's deployment.
- Verify how `SessionManager` locates session files by id across cwd-scoped directories; if not globally indexed, the prototype should persist a small `sessionId -> file path` index.
- Verify whether extension `appendEntry` can be used safely from all modes needed by the demo.
