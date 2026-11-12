import { fireEvent, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PlanScriptDialog } from "@/app/components/agents/plans/plan-script/plan-script-dialog";

import { i18n, renderTranslated } from "../plan-group-fixture";

import type {
  AgentPlanInterpreter,
  AgentPlanScript,
} from "@/definition/AgentPlanScript";

const PROFILE: AgentPlanInterpreter = {
  id: "shell",
  name: "Shell",
  status: "ok",
  version: "1.0",
  error: null,
};

const SCRIPT: AgentPlanScript = {
  id: "script",
  type: "script",
  x: 0,
  y: 0,
  name: "Build",
  interpreterProfileId: "shell",
  content: "echo hello",
  inputs: [{ name: "source", type: "text", isRequired: true }],
  outputs: [{ name: "result", type: "text" }],
  timeoutSeconds: 30,
  bindings: {},
};

function renderDialog(disabled = false): ReturnType<typeof vi.fn> {
  const onApply = vi.fn();
  renderTranslated(
    <PlanScriptDialog
      script={SCRIPT}
      interpreters={[PROFILE]}
      disabled={disabled}
      workspace={{ name: "Workspace", path: "/work" }}
      onApply={onApply}
      onClose={vi.fn()}
    />,
  );
  return onApply;
}

it("edits script fields and applies the checked configuration", () => {
  const onApply = renderDialog();
  fireEvent.change(screen.getByLabelText(i18n.t("plans.scripts.name")), {
    target: { value: "  Compile  " },
  });
  fireEvent.change(screen.getByLabelText(i18n.t("plans.scripts.content")), {
    target: { value: "echo done" },
  });
  fireEvent.change(
    screen.getByLabelText(i18n.t("plans.scripts.inputName", { index: 1 })),
    {
      target: { value: "input" },
    },
  );
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: new RegExp(i18n.t("plans.scripts.disabled")),
    }),
  );
  fireEvent.change(
    screen.getByLabelText(i18n.t("plans.scripts.disabledOutput")),
    {
      target: { value: "skipped" },
    },
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.closeNode") }),
  );
  expect(onApply).toHaveBeenCalledWith(
    expect.objectContaining({
      name: "Compile",
      content: "echo done",
      inputs: [{ name: "input", type: "text", isRequired: true }],
      disabled: true,
      disabledOutput: "skipped",
    }),
    {},
  );
  expect(screen.getByText("Workspace")).toBeDefined();
  expect(screen.getByText("/work")).toBeDefined();
});

it("shows validation errors and does not apply invalid values", () => {
  const onApply = renderDialog();
  fireEvent.change(screen.getByLabelText(i18n.t("plans.scripts.name")), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByLabelText(i18n.t("plans.scripts.timeout")), {
    target: { value: "0" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.closeNode") }),
  );
  expect(onApply).not.toHaveBeenCalled();
  expect(
    screen
      .getByLabelText(i18n.t("plans.scripts.name"))
      .getAttribute("aria-invalid"),
  ).toBe("true");
  expect(
    screen
      .getByLabelText(i18n.t("plans.scripts.timeout"))
      .getAttribute("aria-invalid"),
  ).toBe("true");
});

it("disables editing and hides apply in read-only mode", () => {
  const onApply = renderDialog(true);
  expect(
    screen.getByLabelText(i18n.t("plans.scripts.name")).matches(":disabled"),
  ).toBe(true);
  expect(
    screen.queryByRole("button", { name: i18n.t("plans.closeNode") }),
  ).toBeNull();
  expect(onApply).not.toHaveBeenCalled();
});

it("adds and removes declared inputs and rejects duplicate names", () => {
  const onApply = renderDialog();
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.scripts.addInput") }),
  );
  const second = screen.getByLabelText(
    i18n.t("plans.scripts.inputName", { index: 2 }),
  );
  fireEvent.change(second, { target: { value: "result" } });
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.closeNode") }),
  );
  expect(onApply).not.toHaveBeenCalled();
  expect(second.getAttribute("aria-invalid")).toBe("true");
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("plans.scripts.removeInput", { name: "result" }),
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("plans.closeNode") }),
  );
  expect(onApply).toHaveBeenCalledOnce();
});

it("shows the remote host and warns about local paths in remote scripts", () => {
  renderTranslated(
    <PlanScriptDialog
      script={{
        ...SCRIPT,
        content: "cat /home/user/file",
        executionTarget: {
          kind: "remote",
          workspaceId: "remote",
        },
      }}
      interpreters={[PROFILE]}
      remoteTargets={[
        {
          kind: "remote",
          connectionId: "nas",
          connectionRevision: 1,
          connectionName: "NAS",
          workspaceId: "remote",
          workspaceRevision: 1,
          workspaceName: "Remote",
          path: "/srv/work",
        },
      ]}
      disabled={false}
      onApply={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByText("NAS")).toBeDefined();
  expect(screen.getByText("Remote")).toBeDefined();
  expect(screen.getByText("/srv/work")).toBeDefined();
  expect(screen.getByRole("note").textContent).toContain("/home/user/file");
});
