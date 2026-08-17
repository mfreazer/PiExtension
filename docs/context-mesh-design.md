# Context-Mesh Prototype Design

## Goal

Demonstrate that inter-agent messages can carry only a compact summary plus an addressable context reference, while the full context remains stored outside the receiving worker's initial working context.

## Architecture

```text
+-----------------------------+
| ContextMeshHarness           |
| - creates tasks              |
| - validates messages         |
| - stores addressable context |
| - exposes query_context      |
+--------------+--------------+
               |
               | task message: summary + context_ref
               v
+-----------------------------+
| Stateless worker function    |
| - receives working context   |
| - explicitly queries refs    |
| - returns summary + ctx ref  |
+-----------------------------+
```

## Data model

### Task

```text
task_id
parent_task_id
objective
context_ref
status
```

### Context

A context is a persistent JSON object addressed as `ctx:<id>`. The prototype stores contexts in a filesystem JSON file through `JsonContextStore`.

### Inter-agent message

```text
sender
receiver
summary
context_ref
```

`summary` and `context_ref` are mandatory. Creating a message without either value raises `ValueError`.

## Context querying

Workers call:

```python
query_context(context_ref, query)
```

The store returns matching lines from the referenced full context. This is intentionally exact/simple text retrieval, not vector search.

## Worker model

Workers are plain stateless callables. Task and context state live in `ContextMeshHarness` and `JsonContextStore`, not in persistent agent identities.

## Test scenario

The automated test creates a parent task containing a fictional PLC rule and candidate function, spawns a child task with only a summary and `ctx:T1`, verifies the child cannot see the full parent context until it queries `ctx:T1`, records the child's evidence in its own context, returns only a summary plus `ctx:T2`, and verifies the parent can query `ctx:T2` for evidence.

## Known limitations

- This is not wired into a real Pi extension API because this checkout did not include Pi source or extension hooks.
- Retrieval is simple line filtering.
- Worker execution is synchronous and in-process.
- There is no production scheduler, authentication, distributed coordination, or vector index.
