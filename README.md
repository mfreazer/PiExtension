# Pi Context-Mesh Prototype

This repository checkout did not include Pi runtime source, so this branch adds an isolated, reversible Python prototype harness rather than claiming integration with unverified Pi APIs.

## Architecture

- `ContextMeshHarness` coordinates tasks, compact inter-agent messages, and explicit context lookup.
- `JsonContextStore` persists full contexts and task records in a JSON file.
- Workers are stateless callables. They receive a task and a compact message containing `summary + context_ref`.
- Full sender context is never copied into the receiver's initial working context.

## Running the prototype

```bash
python -m pytest
```

## Example interaction

1. Parent task `T1` stores full PLC rule/function context as `ctx:T1`.
2. Parent spawns child task `T2` with only a summary and `ctx:T1`.
3. Child verifies its initial message does not contain the full parent context.
4. Child calls `query_context("ctx:T1", "FORBIDDEN_LITERAL")` to retrieve evidence.
5. Child stores its own full evidence context as `ctx:T2` and returns only a compact summary plus `ctx:T2`.
6. Parent can query `ctx:T2` when it needs more evidence.

## Known limitations

- Not wired to real Pi extension hooks because no Pi source or extension API exists in this checkout.
- Retrieval is simple case-insensitive line search.
- Execution is synchronous and in-process.
- No production scheduler, durable locking, distributed infrastructure, authentication, or vector database is included.
