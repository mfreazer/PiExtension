import assert from "node:assert/strict";
import test from "node:test";
import { activate, makeContextRef, queryContext, validateMeshMessage } from "../dist/index.js";

class MockSession {
  constructor(id, entries, leafId = "leaf") {
    this.id = id;
    this.entries = entries;
    this.leafId = leafId;
  }
  getSessionId() { return this.id; }
  getLeafId() { return this.leafId; }
  getEntries() { return this.entries; }
  getBranch() { return this.entries; }
  buildContextEntries() { return this.entries.slice(-2); }
}

class MockPi {
  constructor() {
    this.tools = new Map();
    this.entries = [];
  }
  registerTool(tool) { this.tools.set(tool.name, tool); }
  appendEntry(entry) { this.entries.push(entry); }
}

function contentOf(entries) {
  return entries.map((entry) => JSON.stringify(entry.content ?? entry.message ?? entry.summary ?? "")).join("\n");
}

test("Context-Mesh vertical slice uses summary plus context reference", async () => {
  const parentTranscript = [
    {
      id: "p1",
      type: "message",
      message: { role: "user", content: "Requirement: every command function must be idempotent." },
    },
    {
      id: "p2",
      type: "message",
      message: { role: "assistant", content: "Candidate: function StartMotor() Start := TRUE; end_function" },
    },
    {
      id: "p3",
      type: "message",
      message: { role: "user", content: "Irrelevant history: alpha beta gamma delta epsilon zeta." },
    },
  ];
  const parentSession = new MockSession("parent-session", parentTranscript, "p3");
  const childEntries = [];
  const childSession = new MockSession("child-session", childEntries, "c2");

  const childRunner = {
    childSession: () => childSession,
    async runChild(task, message, tools) {
      assert.equal(task.contextRef, message.contextRef);
      assert.equal(message.summary, "Assess StartMotor against the command-function requirement.");
      assert.doesNotMatch(message.summary, /every command function must be idempotent/);
      assert.doesNotMatch(message.summary, /alpha beta gamma/);

      const requirement = tools.queryContext({
        contextRef: message.contextRef,
        query: "idempotent requirement command function",
      });
      assert.ok(requirement.matches.some((line) => line.includes("idempotent")));

      childEntries.push(
        {
          id: "c1",
          type: "custom_message",
          content: "Child queried parent context for the command-function requirement.",
        },
        {
          id: "c2",
          type: "message",
          message: {
            role: "assistant",
            content: "Evidence used: parent requirement says every command function must be idempotent; StartMotor writes Start := TRUE.",
          },
        },
      );

      return {
        summary: "StartMotor violates the idempotence requirement because repeated execution lacks defined idempotent semantics.",
        contextRef: makeContextRef({ sessionId: "child-session", leafId: "c2" }),
        status: "FAIL",
      };
    },
  };

  const pi = new MockPi();
  const index = activate(pi, { sessionManager: parentSession }, { childRunner });
  assert.ok(pi.tools.has("spawn_context_mesh_task"));
  assert.ok(pi.tools.has("query_context"));

  const result = await pi.tools.get("spawn_context_mesh_task").execute({
    taskId: "T1",
    receiver: "child-plc-worker",
    objective: "Determine whether StartMotor satisfies the project requirement.",
    summary: "Assess StartMotor against the command-function requirement.",
  });

  assert.equal(result.status, "FAIL");
  assert.match(result.contextRef, /^ctx:pi-session:child-session#leaf:c2$/);
  assert.doesNotMatch(result.summary, /Evidence used:/);
  assert.doesNotMatch(result.summary, /Irrelevant history/);

  const taskEntry = pi.entries.find((entry) => entry.customType === "context-mesh.task");
  assert.ok(taskEntry);
  assert.equal(taskEntry.content.message.contextRef, makeContextRef({ sessionId: "parent-session", leafId: "p3" }));
  assert.doesNotMatch(JSON.stringify(taskEntry.content.message), /every command function must be idempotent/);

  const resultEntry = pi.entries.find((entry) => entry.customType === "context-mesh.result");
  assert.ok(resultEntry);
  assert.equal(resultEntry.content.summary, result.summary);
  assert.equal(resultEntry.content.contextRef, result.contextRef);
  assert.doesNotMatch(JSON.stringify(resultEntry.content), /Evidence used:/);

  const childEvidence = queryContext(index, { contextRef: result.contextRef, query: "What evidence did you use? idempotent" });
  assert.ok(childEvidence.matches.some((line) => line.includes("Evidence used:")));

  assert.ok(parentSession.getEntries().length > 0);
  assert.ok(childSession.getEntries().length > 0);
});

test("stored context, working context, and message remain distinct", async () => {
  const irrelevant = Array.from({ length: 50 }, (_, index) => ({
    id: `noise-${index}`,
    type: "message",
    message: { role: "user", content: `Irrelevant parent material ${index}: ${"x".repeat(80)}` },
  }));
  const relevant = {
    id: "rule",
    type: "message",
    message: { role: "user", content: "Requirement: every command function must be idempotent." },
  };
  const parentSession = new MockSession("large-parent", [...irrelevant, relevant], "rule");
  const pi = new MockPi();
  activate(pi, { sessionManager: parentSession });

  const spawned = await pi.tools.get("spawn_context_mesh_task").execute({
    taskId: "T-large",
    receiver: "child",
    objective: "Find the command-function rule.",
    summary: "Find the command-function rule using the supplied context reference.",
  });

  const storedContext = contentOf(parentSession.getEntries());
  const workingContext = contentOf(parentSession.buildContextEntries());
  const messagePayload = JSON.stringify(spawned.message);

  assert.notEqual(storedContext, workingContext);
  assert.notEqual(storedContext, messagePayload);
  assert.notEqual(workingContext, messagePayload);
  assert.ok(storedContext.length > messagePayload.length * 20);
  assert.doesNotMatch(messagePayload, /Irrelevant parent material/);
  assert.doesNotMatch(messagePayload, /every command function must be idempotent/);

  const targeted = pi.tools.get("query_context").execute({
    contextRef: spawned.message.contextRef,
    query: "idempotent command function requirement",
  });
  assert.ok(targeted.matches.some((line) => line.includes("idempotent")));
});

test("malformed Context-Mesh messages are rejected", () => {
  assert.throws(() => validateMeshMessage({ sender: "A", receiver: "B", summary: "", contextRef: "ctx:pi-session:A#leaf:latest" }));
  assert.throws(() => validateMeshMessage({ sender: "A", receiver: "B", summary: "ok", contextRef: "" }));
  assert.throws(() => validateMeshMessage({ sender: "A", receiver: "B", summary: "ok", contextRef: "inline-full-context" }));
});
