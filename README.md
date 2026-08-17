# Pi Context-Mesh Extension Prototype

A minimal TypeScript Pi extension/package prototype for validating context-addressable inter-agent messaging:

```text
message = compact summary + contextRef
```

The sender's full Pi session context is not copied into the receiver's working context. Receivers explicitly call `query_context` when they need a relevant slice.

## Installation

This repository is a standalone package prototype. Build it with the TypeScript compiler available in the environment:

```bash
npm run build
```

In a Pi extension workspace, expose `activate` from `dist/index.js` and call it with Pi's `ExtensionAPI` and `ExtensionContext`.

## Architecture

- `spawn_context_mesh_task` creates a `MeshTask` and a compact `MeshMessage`.
- `contextRef` points at a Pi session/leaf: `ctx:pi-session:<session-id>#leaf:<entry-id>`.
- `query_context` resolves `contextRef + query` into relevant snippets from registered Pi session entries.
- Task metadata is persisted with Pi custom entries; compact child results can be appended as Pi custom messages.
- Child execution uses Pi's subagent/SDK pattern via a small `ChildRunner` adapter, not a new agent runtime.

## Example parent/child exchange

1. Parent session contains: `Requirement: every command function must be idempotent.`
2. Parent calls `spawn_context_mesh_task` with summary `Assess StartMotor against the command-function requirement.`
3. Child initially receives only that summary and `ctx:pi-session:parent-session#leaf:p3`.
4. Child calls `query_context({ contextRef, query: "idempotent command function requirement" })`.
5. Child returns summary `StartMotor violates the idempotence requirement...` plus `ctx:pi-session:child-session#leaf:c2`.
6. Parent initially sees only the summary and child context reference, then queries the child context for evidence if needed.

## Running the demo tests

```bash
npm test
```

The tests use deterministic mock Pi sessions and a mock `ChildRunner` to prove the protocol without calling an LLM.

## Known limitations

- No task DAG scheduler or worker pool.
- No vector database/RAG; retrieval is exact keyword search.
- No Pi core changes.
- Session indexing is in-memory for the vertical slice; v0.2 should use Pi's real persisted session index or a tiny extension-owned index.
