import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PageAgentSharing } from "@/app/components/agents/definitions/page-agent-sharing";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import { chooseOption, i18n } from "./page-agent-fixture";

import type { Mock } from "vitest";
import type { AgentConfiguration } from "@/definition/AgentConfiguration";

const DIRECTORY = {
  persons: [{ id: "ada", name: "Ada" }],
  groups: [{ id: "team", name: "Team" }],
  departments: [{ id: "sales", name: "Sales" }],
};

type Sharing = AgentConfiguration["sharing"];
type SharingSpy = Mock<(configuration: AgentConfiguration) => void>;

function configured(sharing: Sharing): AgentConfiguration {
  return { ...emptyAgentConfiguration(), sharing };
}

/** Keeps the configuration as a form would and reports every change. */
function SharingDraft(props: {
  readonly initial: AgentConfiguration;
  readonly hasDeletedTargets?: boolean;
  readonly disabled?: boolean;
  readonly onChange: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const [configuration, setConfiguration] = useState(props.initial);
  function change(next: AgentConfiguration): void {
    setConfiguration(next);
    props.onChange(next);
  }
  return (
    <PageAgentSharing
      configuration={configuration}
      directory={DIRECTORY}
      disabled={props.disabled ?? false}
      hasDeletedTargets={props.hasDeletedTargets ?? false}
      onChange={change}
    />
  );
}

function renderSharing(
  sharing: Sharing,
  options: {
    readonly hasDeletedTargets?: boolean;
    readonly disabled?: boolean;
  } = {},
): SharingSpy {
  const onChange: SharingSpy = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <SharingDraft
        initial={configured(sharing)}
        onChange={onChange}
        {...options}
      />
    </I18nextProvider>,
  );
  return onChange;
}

function lastSharing(onChange: SharingSpy): Sharing | undefined {
  return onChange.mock.lastCall?.[0].sharing;
}

function scopePicker(): HTMLElement {
  const [scope] = screen.getAllByRole("combobox");
  if (!scope) throw new Error("The sharing picker is missing.");
  return scope;
}

it("keeps a private share free of targets and operators", () => {
  renderSharing({ isGlobal: false, targets: [] });

  expect(scopePicker().textContent).toBe(i18n.t("pageAgents.private"));
  expect(screen.getAllByRole("combobox")).toHaveLength(1);
  expect(screen.queryByRole("status")).toBeNull();
});

it("warns that a deleted group or department leaves the share", () => {
  renderSharing({ isGlobal: false, targets: [] }, { hasDeletedTargets: true });

  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("pageAgents.deletedTargets"),
  );
});

it("names a global share and clears its targets", async () => {
  const onChange = renderSharing({
    isGlobal: false,
    targets: [{ kind: "group", targetId: "team" }],
    operator: "and",
  });

  await chooseOption(scopePicker(), i18n.t("pageAgents.global"));

  expect(lastSharing(onChange)).toEqual({
    isGlobal: true,
    targets: [],
    operator: "and",
  });
  expect(scopePicker().textContent).toBe(i18n.t("pageAgents.global"));
});

it("keeps a restricted share open before its first target", async () => {
  const onChange = renderSharing({ isGlobal: true, targets: [] });

  await chooseOption(scopePicker(), i18n.t("pageAgents.restricted"));

  expect(lastSharing(onChange)).toEqual({ isGlobal: false, targets: [] });
  expect(scopePicker().textContent).toBe(i18n.t("pageAgents.restricted"));
  const [, operator] = screen.getAllByRole("combobox");
  expect(operator?.textContent).toBe(i18n.t("pageAgents.or"));
  expect(screen.queryByRole("checkbox", { name: "Ada" })).toBeNull();
  expect(screen.getByRole("checkbox", { name: "Sales" })).toBeDefined();
});

it("adds a group and joins the targets with AND", async () => {
  const onChange = renderSharing({
    isGlobal: false,
    targets: [{ kind: "department", targetId: "sales" }],
  });

  fireEvent.click(screen.getByRole("checkbox", { name: "Team" }));
  expect(lastSharing(onChange)).toEqual({
    isGlobal: false,
    targets: [
      { kind: "department", targetId: "sales" },
      { kind: "group", targetId: "team" },
    ],
  });
  const [, operator] = screen.getAllByRole("combobox");
  if (!operator) throw new Error("The operator picker is missing.");
  await chooseOption(operator, i18n.t("pageAgents.and"));

  expect(lastSharing(onChange)).toMatchObject({ operator: "and" });
  expect(operator.textContent).toBe(i18n.t("pageAgents.and"));
});

it("drops the targets when a restricted share becomes private", async () => {
  const onChange = renderSharing({
    isGlobal: false,
    targets: [{ kind: "group", targetId: "team" }],
    operator: "and",
  });

  await chooseOption(scopePicker(), i18n.t("pageAgents.private"));

  expect(lastSharing(onChange)).toEqual({
    isGlobal: false,
    targets: [],
    operator: "and",
  });
  expect(screen.queryByRole("checkbox", { name: "Team" })).toBeNull();
});

it("locks every sharing control of a read-only agent", () => {
  renderSharing(
    { isGlobal: false, targets: [{ kind: "group", targetId: "team" }] },
    { disabled: true },
  );

  for (const picker of screen.getAllByRole("combobox"))
    expect(picker.hasAttribute("disabled")).toBe(true);
  expect(
    screen.getByRole<HTMLInputElement>("checkbox", { name: "Team" }).checked,
  ).toBe(true);
});
