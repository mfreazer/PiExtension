"""Minimal context-addressable multi-agent task mesh harness.

The prototype intentionally keeps workers stateless: all durable task and
context state is owned by the harness/store. Inter-agent messages carry only a
summary plus a context reference.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import StrEnum
import json
from pathlib import Path
from typing import Callable, Iterable
from uuid import uuid4


class TaskStatus(StrEnum):
    """Lifecycle states used by the prototype task store."""

    PENDING = "PENDING"
    RUNNING = "RUNNING"
    PASS = "PASS"
    FAIL = "FAIL"
    UNCERTAIN = "UNCERTAIN"
    BLOCKED = "BLOCKED"
    ESCALATE = "ESCALATE"


@dataclass(frozen=True)
class Task:
    """Stateful task record claimed by otherwise stateless workers."""

    task_id: str
    parent_task_id: str | None
    objective: str
    context_ref: str
    status: TaskStatus = TaskStatus.PENDING


@dataclass(frozen=True)
class InterAgentMessage:
    """Compact inter-agent message with an addressable context reference."""

    sender: str
    receiver: str
    summary: str
    context_ref: str

    def __post_init__(self) -> None:
        if not self.summary.strip():
            raise ValueError("inter-agent messages require a non-empty summary")
        if not self.context_ref.strip():
            raise ValueError("inter-agent messages require a non-empty context_ref")
        if not self.context_ref.startswith("ctx:"):
            raise ValueError("context_ref must use the ctx:<id> format")


class JsonContextStore:
    """Filesystem-backed store for addressable full contexts and task records."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write({"contexts": {}, "tasks": {}})

    def create_context(self, lines: Iterable[str], context_id: str | None = None) -> str:
        context_key = context_id or uuid4().hex
        ref = f"ctx:{context_key}"
        data = self._read()
        data["contexts"][ref] = list(lines)
        self._write(data)
        return ref

    def append_context(self, context_ref: str, lines: Iterable[str]) -> None:
        data = self._read()
        self._require_context(data, context_ref).extend(lines)
        self._write(data)

    def get_context(self, context_ref: str) -> list[str]:
        data = self._read()
        return list(self._require_context(data, context_ref))

    def query_context(self, context_ref: str, query: str, *, limit: int = 5) -> list[str]:
        """Return relevant context lines using simple case-insensitive term search."""

        terms = [term for term in query.lower().split() if term]
        lines = self.get_context(context_ref)
        if not terms:
            return lines[:limit]
        matches = [line for line in lines if any(term in line.lower() for term in terms)]
        return matches[:limit]

    def save_task(self, task: Task) -> None:
        data = self._read()
        encoded = asdict(task)
        encoded["status"] = task.status.value
        data["tasks"][task.task_id] = encoded
        self._write(data)

    def get_task(self, task_id: str) -> Task:
        data = self._read()
        try:
            encoded = data["tasks"][task_id]
        except KeyError as exc:
            raise KeyError(f"unknown task: {task_id}") from exc
        return Task(
            task_id=encoded["task_id"],
            parent_task_id=encoded["parent_task_id"],
            objective=encoded["objective"],
            context_ref=encoded["context_ref"],
            status=TaskStatus(encoded["status"]),
        )

    def _read(self) -> dict:
        return json.loads(self.path.read_text(encoding="utf-8"))

    def _write(self, data: dict) -> None:
        self.path.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")

    @staticmethod
    def _require_context(data: dict, context_ref: str) -> list[str]:
        try:
            return data["contexts"][context_ref]
        except KeyError as exc:
            raise KeyError(f"unknown context_ref: {context_ref}") from exc


Worker = Callable[[Task, InterAgentMessage, "ContextMeshHarness"], tuple[str, list[str], TaskStatus]]


class ContextMeshHarness:
    """Coordinates task creation, message validation, and context querying."""

    def __init__(self, store: JsonContextStore) -> None:
        self.store = store
        self.inbox: list[InterAgentMessage] = []

    def create_root_task(self, objective: str, full_context: Iterable[str], *, task_id: str = "T1") -> Task:
        context_ref = self.store.create_context(full_context, context_id=task_id)
        task = Task(task_id=task_id, parent_task_id=None, objective=objective, context_ref=context_ref)
        self.store.save_task(task)
        return task

    def spawn_task(
        self,
        *,
        parent: Task,
        receiver: str,
        objective: str,
        summary: str,
        task_id: str = "T2",
    ) -> tuple[Task, InterAgentMessage]:
        message = InterAgentMessage(
            sender=parent.task_id,
            receiver=receiver,
            summary=summary,
            context_ref=parent.context_ref,
        )
        task = Task(task_id=task_id, parent_task_id=parent.task_id, objective=objective, context_ref=parent.context_ref)
        self.store.save_task(task)
        self.inbox.append(message)
        return task, message

    def run_worker(self, task: Task, message: InterAgentMessage, worker: Worker) -> InterAgentMessage:
        running = Task(task.task_id, task.parent_task_id, task.objective, task.context_ref, TaskStatus.RUNNING)
        self.store.save_task(running)
        summary, full_context, status = worker(running, message, self)
        child_context_ref = self.store.create_context(full_context, context_id=task.task_id)
        finished = Task(task.task_id, task.parent_task_id, task.objective, child_context_ref, status)
        self.store.save_task(finished)
        return InterAgentMessage(
            sender=task.task_id,
            receiver=task.parent_task_id or "root",
            summary=summary,
            context_ref=child_context_ref,
        )

    def query_context(self, context_ref: str, query: str, *, limit: int = 5) -> list[str]:
        return self.store.query_context(context_ref, query, limit=limit)
