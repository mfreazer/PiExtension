"""Context-addressable task mesh prototype."""

from .harness import (
    ContextMeshHarness,
    InterAgentMessage,
    JsonContextStore,
    Task,
    TaskStatus,
)

__all__ = [
    "ContextMeshHarness",
    "InterAgentMessage",
    "JsonContextStore",
    "Task",
    "TaskStatus",
]
