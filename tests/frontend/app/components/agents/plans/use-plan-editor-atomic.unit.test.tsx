import { fireEvent, screen } from "@testing-library/react";
import { expect, it } from "vitest";

import { emptyPlanLoop } from "@/definition/AgentPlanLoop";

import { GROUP_SOURCES, agentNode } from "./plan-group-fixture";
import {
  actionScene,
  planPage,
  planView,
  renderWithEditor,
} from "./plan-panel-fixture";

it("reports the actual refusal when a second queued connection targets an occupied input", () => {
  const parameter = {
    type: "parameter" as const,
    x: 0,
    y: 0,
    name: "Source",
    format: "string" as const,
    value: { type: "text" as const, text: "value" },
  };
  const selected = planView({
    nodes: [
      { ...parameter, id: "first" },
      { ...parameter, id: "second" },
      agentNode("agent", "codex"),
    ],
  });
  renderWithEditor(
    planPage({ selected, sources: GROUP_SOURCES }),
    actionScene(),
    (editor) => (
      <>
        <button
          type="button"
          onClick={() => {
            editor.graph.connectFrom(
              { kind: "source", nodeId: "first" },
              "agent",
              "input1",
            );
            editor.graph.connectFrom(
              { kind: "source", nodeId: "second" },
              "agent",
              "input1",
            );
          }}
        >
          Connect both
        </button>
        <span>Issue: {editor.graph.connectionIssue?.reason ?? "none"}</span>
        <output aria-label="Nodes">{JSON.stringify(editor.draft.nodes)}</output>
      </>
    ),
  );

  fireEvent.click(screen.getByRole("button", { name: "Connect both" }));

  expect(screen.getByText("Issue: duplicate")).toBeDefined();
  const nodes: unknown = JSON.parse(
    screen.getByLabelText("Nodes").textContent ?? "null",
  );
  expect(nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "agent",
        bindings: { input1: { kind: "source", nodeId: "first" } },
      }),
    ]),
  );
});

it("retains an edge queued before a refused loop membership move", () => {
  const selected = planView({
    nodes: [
      emptyPlanLoop("loop", "Loop", { x: 0, y: 0 }),
      { id: "start", type: "start", x: 1100, y: 0 },
      agentNode("agent", "codex", { x: 900, y: 0 }),
    ],
  });
  renderWithEditor(
    planPage({ selected, sources: GROUP_SOURCES }),
    actionScene(),
    (editor) => (
      <>
        <button
          type="button"
          onClick={() => {
            editor.graph.connectFrom(
              { kind: "flow", nodeId: "start" },
              "agent",
            );
            editor.graph.place("agent", {
              pointer: { x: 300, y: 200 },
              position: { x: 240, y: 180 },
            });
          }}
        >
          Connect and move
        </button>
        <span>Notice: {editor.graph.notice?.kind ?? "none"}</span>
        <output aria-label="Graph">{JSON.stringify(editor.draft)}</output>
      </>
    ),
  );

  fireEvent.click(screen.getByRole("button", { name: "Connect and move" }));

  expect(screen.getByText("Notice: repair")).toBeDefined();
  const graph: unknown = JSON.parse(
    screen.getByLabelText("Graph").textContent ?? "null",
  );
  expect(graph).toMatchObject({
    edges: [{ from: "start", to: "agent" }],
  });
  if (!graph || typeof graph !== "object" || !("nodes" in graph))
    throw new Error("Graph nodes missing");
  expect(graph.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "agent", type: "agent" }),
      expect.objectContaining({ id: "loop", type: "loop", steps: [] }),
    ]),
  );
});
