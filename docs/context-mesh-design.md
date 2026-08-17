# Context-Mesh Pi Extension Design

## Goal

Validate the primitive:

```text
MESSAGE = SUMMARY + CONTEXT_REFERENCE
```

The receiver gets a compact summary and an opaque `contextRef`; it must explicitly call `query_context` to retrieve a relevant slice of the referenced Pi session context.

## Architecture

```text
Pi parent session
    |
    | spawn_context_mesh_task({ objective, summary })
    v
Context-Mesh extension
    |  creates MeshTask
    |  persists task metadata as Pi custom entry
    |  sends only MeshMessage(summary + contextRef)
    v
Child Pi session / subagent pattern
    |
    | query_context({ contextRef, query })
    v
Referenced Pi session entries
    |
    v
Child result: { summary, contextRef, status }
```

## Pi APIs used

The implementation is intentionally shaped around the upstream Pi APIs identified in `docs/context-mesh-pi-investigation.md`:

- `ExtensionAPI.registerTool` for `spawn_context_mesh_task` and `query_context`.
- `ExtensionAPI.appendEntry` for `context-mesh.task` and `context-mesh.result` custom/custom-message entries.
- `ReadonlySessionManager.getSessionId`, `getLeafId`, `getEntries`, and `getBranch` as the addressable session/context substrate.
- Pi custom entries for extension-owned task metadata that should not pollute model context.

## Source structure

- `src/protocol.ts` defines `MeshMessage`, `MeshResult`, status types, and validation.
- `src/context-ref.ts` creates/parses opaque `ctx:pi-session:<session-id>#leaf:<entry-id>` references.
- `src/task.ts` defines the minimal `MeshTask` shape.
- `src/query-context.ts` resolves `contextRef + query` into relevant session-entry snippets with exact keyword retrieval.
- `src/extension.ts` registers the Pi tools and wires the optional child-runner/subagent adapter used by the deterministic test.

## Message protocol

```ts
interface MeshMessage {
  sender: string;
  receiver: string;
  summary: string;
  contextRef: string;
}
```

`summary` and `contextRef` are mandatory. `contextRef` must start with `ctx:`. Full transcripts are not legal message payloads.

## Context references

The prototype uses:

```text
ctx:pi-session:<session-id>#leaf:<entry-id>
```

This maps to Pi session state rather than copying context. The reference is opaque to the model/tool caller except for passing it back to `query_context`.

## Context querying

`query_context({ contextRef, query, limit })` parses the context reference, locates the registered Pi session, extracts branch entries, and returns matching text snippets. Retrieval is intentionally simple keyword search for the vertical slice.

## Child agent creation

The extension is written around Pi's subagent pattern instead of a new runtime. The production adapter should delegate to the existing Pi subagent/SDK mechanism. In tests, `ChildRunner` is a deterministic adapter that proves the exact information flow without requiring a live LLM.

## Persistence

Task metadata is appended as a Pi `custom` entry so it remains persisted but not part of normal LLM context. Child results are appended as compact `custom_message` entries so the parent sees only the summary plus child `contextRef`.

## Known limitations

- The prototype does not implement a scheduler, worker pool, vector retrieval, UI, auth, or distributed coordination.
- Session lookup is in-memory in `SessionContextIndex`; v0.2 should use Pi's real session file index or a tiny extension-owned index.
- The child agent is represented by a `ChildRunner` adapter to keep the extension reversible and testable without modifying Pi core.
