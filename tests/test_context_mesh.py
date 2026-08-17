from pathlib import Path

import pytest

from context_mesh import ContextMeshHarness, InterAgentMessage, JsonContextStore, TaskStatus


def plc_worker(task, message, harness):
    assert "FORBIDDEN_LITERAL" not in message.summary
    parent_evidence = harness.query_context(message.context_ref, "FORBIDDEN_LITERAL")
    status = TaskStatus.FAIL if parent_evidence else TaskStatus.PASS
    return (
        "PLC rule check failed: forbidden literal evidence found." if parent_evidence else "PLC rule check passed.",
        [
            f"worker_task={task.task_id}",
            f"received_summary={message.summary}",
            f"queried_parent_ref={message.context_ref}",
            *[f"evidence={line}" for line in parent_evidence],
        ],
        status,
    )


def test_context_addressable_parent_child_flow(tmp_path: Path):
    harness = ContextMeshHarness(JsonContextStore(tmp_path / "mesh.json"))
    parent = harness.create_root_task(
        "Determine whether a fictional PLC function follows the supplied rule.",
        [
            "Rule: PLC functions must not contain FORBIDDEN_LITERAL.",
            "Function FB_Demo sets output := FORBIDDEN_LITERAL when sensor_fault is true.",
            "Expected decision: fail if the literal is present.",
        ],
    )

    child, child_message = harness.spawn_task(
        parent=parent,
        receiver="stateless-plc-worker",
        objective="Check the PLC function against the rule.",
        summary="Check a fictional PLC function for a forbidden literal rule.",
    )

    assert child.parent_task_id == parent.task_id
    assert child_message.context_ref == parent.context_ref
    assert "FORBIDDEN_LITERAL" not in child_message.summary

    result_message = harness.run_worker(child, child_message, plc_worker)

    assert "failed" in result_message.summary
    assert result_message.context_ref.startswith("ctx:")
    assert result_message.context_ref != parent.context_ref
    assert "FORBIDDEN_LITERAL" not in result_message.summary

    child_evidence = harness.query_context(result_message.context_ref, "evidence")
    assert any("FORBIDDEN_LITERAL" in line for line in child_evidence)
    assert harness.store.get_context(parent.context_ref)
    assert harness.store.get_context(result_message.context_ref)


def test_messages_reject_missing_summary_or_context_ref():
    with pytest.raises(ValueError):
        InterAgentMessage(sender="A", receiver="B", summary="", context_ref="ctx:A")
    with pytest.raises(ValueError):
        InterAgentMessage(sender="A", receiver="B", summary="ok", context_ref="")
