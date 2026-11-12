import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";

import { usePlanScriptForm } from "@/app/components/agents/plans/plan-script/use-plan-script-form";

import type { AgentPlanScript } from "@/definition/AgentPlanScript";

const SCRIPT: AgentPlanScript = {
  id: "script",
  type: "script",
  x: 0,
  y: 0,
  name: "Build",
  interpreterProfileId: "removed",
  content: "echo hello",
  inputs: [{ name: "source", type: "text", isRequired: true }],
  outputs: [{ name: "result", type: "text" }],
  timeoutSeconds: 30,
  bindings: { source: { kind: "source", nodeId: "parameter" } },
};

it("preserves a withdrawn profile and follows an input rename with its binding", () => {
  const { result } = renderHook(() =>
    usePlanScriptForm(SCRIPT, { interpreters: [], defaultOutput: "output" }),
  );
  expect(result.current.isProfileWithdrawn).toBe(true);
  const row = result.current.values.inputs[0];
  expect(row).toBeDefined();
  if (!row) throw new Error("Missing input row");
  act(() => result.current.changeInput(row.key, { name: "renamed" }));
  expect(result.current.isRowShown(row.key)).toBe(true);
  let submitted: ReturnType<typeof result.current.submit> = null;
  act(() => {
    submitted = result.current.submit();
  });
  expect(submitted).toMatchObject({
    configuration: {
      inputs: [{ name: "renamed", type: "text", isRequired: true }],
    },
    bindings: { renamed: SCRIPT.bindings.source },
  });
});

it("shows missing fields on submission and clears errors after correction", () => {
  const { result } = renderHook(() =>
    usePlanScriptForm(null, { interpreters: [], defaultOutput: "output" }),
  );
  expect(result.current.isShown("name")).toBe(false);
  act(() => {
    expect(result.current.submit()).toBeNull();
  });
  expect(result.current.isShown("name")).toBe(true);
  expect(result.current.issues.fields.has("profile")).toBe(true);
  act(() =>
    result.current.change({
      name: "Build",
      content: "echo hello",
      interpreterProfileId: "missing",
    }),
  );
  expect(result.current.issues.fields.has("profileMissing")).toBe(true);
});
