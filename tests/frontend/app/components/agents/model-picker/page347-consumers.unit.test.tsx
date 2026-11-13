import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { AgentGeneralSection } from "@/app/components/users/agents/agent-general-section";
import { createAgentDraft } from "@/app/components/users/agents/agent-draft";
import { ModelPicker } from "@/app/components/agents/model-picker";
import { createI18n } from "@/app/lib/i18n";
import { AGENT_PROVIDERS, isAgentProvider } from "@/definition/AgentConnection";

import { pageModel } from "../plans/plan-model-fixture";

import type { AgentModelConsumer } from "@/definition/AgentModelConsumers";
import type { AgentEmployeeAccess } from "@/definition/AgentEmployee";

const i18n = createI18n("en");
const models = Object.keys(AGENT_PROVIDERS)
  .filter(isAgentProvider)
  .map((provider) =>
    pageModel(provider, {
      provider,
      modelName: `Catalog ${provider}`,
      model: provider === "opencode" ? "opencode/free" : `vendor/${provider}`,
      isFree: provider === "opencode",
    }),
  );

beforeEach(() => {
  Element.prototype.scrollTo = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});

function picker(
  consumer: AgentModelConsumer,
  employeeAccess: AgentEmployeeAccess = "read_only",
): ReturnType<typeof vi.fn> {
  const change = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ModelPicker
        value=""
        models={models}
        consumer={consumer}
        employeeAccess={employeeAccess}
        disabled={false}
        onChange={change}
      />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.change(
    screen.getByRole("combobox", { name: "Search model or provider" }),
    { target: { value: "Catalog" } },
  );
  return change;
}

it.each(["pica", "employee", "plan"] as const)(
  "shows every provider for %s and refuses unsupported API rows with a reason",
  (consumer) => {
    const change = picker(consumer, "workspace");
    for (const model of models) {
      const row = screen.getByRole("treeitem", {
        name: new RegExp(`^Catalog ${model.provider}`, "u"),
      });
      expect(row.textContent).toContain(`Catalog ${model.provider}`);
      const isRefused =
        consumer !== "plan" &&
        (AGENT_PROVIDERS[model.provider].chatAdapter === null ||
          (consumer === "pica" && model.provider === "opencode"));
      expect(row.getAttribute("aria-disabled")).toBe(isRefused ? "true" : null);
      if (isRefused) {
        expect(row.textContent).toContain(
          i18n.t(
            model.provider === "opencode"
              ? "settings.agents.error.picaZenUnsupported"
              : "settings.agents.modelSelection.refusal.noChatAdapter",
          ),
        );
        fireEvent.click(row);
        fireEvent.mouseEnter(row);
        fireEvent.keyDown(
          screen.getByRole("combobox", { name: "Search model or provider" }),
          { key: "Enter" },
        );
        expect(change).not.toHaveBeenCalled();
      }
    }
  },
);

it.each([
  {
    consumer: "pica",
    access: "workspace",
    key: "settings.agents.error.picaZenUnsupported",
  },
  {
    consumer: "employee",
    access: "read_only",
    key: "settings.agents.modelSelection.refusal.employeeToolsMissing",
  },
] as const)(
  "keeps Zen visible and unselectable for $consumer with $access access",
  ({ consumer, access, key }) => {
    const change = picker(consumer, access);
    const row = screen.getByRole("treeitem", { name: /^Catalog opencode/u });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    expect(row.textContent).toContain(i18n.t(key));
    expect(row.textContent).toContain("Free");
    fireEvent.click(row);
    fireEvent.mouseEnter(row);
    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Search model or provider" }),
      { key: "Enter" },
    );
    expect(change).not.toHaveBeenCalled();
  },
);

it.each(["workspace", "yolo"] as const)(
  "selects free Zen for employees with %s access",
  (access) => {
    const change = picker("employee", access);
    fireEvent.click(
      screen.getByRole("treeitem", { name: /^Catalog opencode/u }),
    );
    expect(change).toHaveBeenCalledWith("opencode");
  },
);

it("uses the employee draft's current access and retains every provider in its actual form", () => {
  const draft = createAgentDraft(null, { roleId: "", soul: "" });
  const change = vi.fn();
  function section(access: AgentEmployeeAccess): React.ReactElement {
    return (
      <I18nextProvider i18n={i18n}>
        <AgentGeneralSection
          draft={{ ...draft, access }}
          onChange={change}
          models={models}
          roles={[]}
          departments={[]}
          imageUrl={null}
          onImage={vi.fn()}
          savedModel=""
          isDisabled={false}
        />
      </I18nextProvider>
    );
  }
  const view = render(section("read_only"));
  fireEvent.click(screen.getByRole("combobox", { name: /^Model/u }));
  fireEvent.change(
    screen.getByRole("combobox", { name: "Search model or provider" }),
    { target: { value: "Catalog" } },
  );
  expect(
    screen
      .getByRole("treeitem", { name: /^Catalog opencode/u })
      .getAttribute("aria-disabled"),
  ).toBe("true");
  for (const model of models)
    expect(
      screen.getByRole("treeitem", {
        name: new RegExp(`^Catalog ${model.provider}`, "u"),
      }),
    ).toBeTruthy();
  view.rerender(section("workspace"));
  fireEvent.click(screen.getByRole("treeitem", { name: /^Catalog opencode/u }));
  expect(change).toHaveBeenCalledWith("modelKey", "opencode");
});

it("shows non-chat and tool-less plan models disabled while simulated models stay usable", () => {
  const change = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <ModelPicker
        value=""
        disabled={false}
        onChange={change}
        models={[
          pageModel("no-chat", {
            modelName: "Catalog non-chat",
            isChatCapable: false,
          }),
          pageModel("no-tools", {
            modelName: "Catalog no tools",
            isToolCapable: false,
          }),
          pageModel("simulation", {
            modelName: "Catalog simulation",
            isToolCapable: false,
            isSimulation: true,
          }),
        ]}
      />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.change(
    screen.getByRole("combobox", { name: "Search model or provider" }),
    { target: { value: "Catalog" } },
  );
  for (const name of [/^Catalog non-chat/u, /^Catalog no tools/u]) {
    const row = screen.getByRole("treeitem", { name });
    expect(row.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(row);
  }
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("treeitem", { name: /^Catalog simulation/u }),
  );
  expect(change).toHaveBeenCalledWith("simulation");
});
