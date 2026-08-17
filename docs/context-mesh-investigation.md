# Context-Mesh Investigation

Pi version / commit:
- Repository commit inspected: `4a52f72ec009d4ba199a59061d1ff8e9e0cf0702`.
- Git branch inspected: `work`.
- No Pi source files, package manifests, or remotes are present in this checkout; the repository contains only `.gitkeep` before this prototype was added.

Repository:
- Local repository path: `/workspace/PiExtension`.
- `git remote -v` reports no configured remote.
- `rg --files` returned no tracked source files before implementation.

Relevant packages:
- None could be identified from source because the checkout did not include Pi packages or manifests.

## Agent lifecycle

No Pi agent lifecycle implementation could be verified in this checkout. There are no source files defining agent/worker lifecycle symbols, constructors, turn loops, task runners, or session orchestration.

## Context representation

No existing Pi context representation could be verified. The repository did not contain types or functions for context windows, transcript state, memory, or addressable context storage.

## Message representation

No existing Pi message representation could be verified. The repository did not contain message classes, schemas, protocol definitions, or serializers.

## Extension API

No Pi extension/plugin API could be inspected in this checkout. There are no manifests, extension host implementations, hook definitions, tool-registration helpers, or plugin runtime files.

## Persistence

No existing Pi persistence mechanism could be verified. The repository did not contain session stores, database migrations, filesystem stores, or persistence abstractions.

## Compaction

No existing Pi compaction/summarization implementation could be verified. The repository did not contain compaction policies, summarizers, transcript reducers, or context-window management code.

## Agent-to-agent possibilities

Because no Pi runtime source is present, the investigation could not verify whether a second Pi agent can be launched from an extension without creating an independent process. No in-process agent factory, worker pool, task scheduler, or extension hook for spawning workers exists in this checkout.

## Recommended integration point

The cleanest reversible path available in this repository is an isolated prototype harness that models the requested primitive without claiming integration with unavailable Pi APIs. The harness should expose the smallest concepts needed for later replacement by real Pi hooks:

- task creation and claiming,
- addressable context persistence,
- strict inter-agent message validation,
- context querying by reference,
- stateless worker execution.

If the real Pi source is later added, the likely replacement points to investigate are the actual tool-registration mechanism, turn/session persistence layer, and any in-process agent/worker runner. Those are hypotheses only, not verified Pi APIs.

## Rejected approaches

- Building against undocumented Pi APIs: rejected because no Pi API source exists in this checkout.
- Launching subprocess agents: rejected for the prototype because it would validate process orchestration rather than the context-addressable message primitive.
- Adding Redis/Kafka/vector databases: rejected because the minimal experiment only needs exact retrieval/simple search over persisted contexts.
- Copying full parent context into a child prompt: rejected because it violates the core context semantics.

## Minimal prototype architecture

The prototype should be an isolated Python harness with a filesystem-backed JSON store:

```text
TaskStore / ContextStore
        |
        v
 ContextMeshHarness
   | spawn_task(summary + ctx:parent)
   v
 Stateless worker function
   | query_context(ctx:parent, query)
   v
 result summary + ctx:child
```

This architecture validates the hypothesis while making no claims about unavailable Pi extension points.
