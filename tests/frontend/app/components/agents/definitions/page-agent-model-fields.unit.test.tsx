import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PageAgentModelFields } from "@/app/components/agents/definitions/page-agent-model-fields";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

import {
  chooseOption,
  i18n,
  MODEL,
  modelTrigger,
  openModelRows,
} from "./page-agent-fixture";

import type { PageAgentInput, PageAgentModel } from "@/definition/PageAgent";

const OPUS: PageAgentModel = {
  ...MODEL,
  id: "model-2",
  name: "Claude Code · Opus",
  modelName: "Opus",
  model: "claude-opus",
  provider: "claude_code",
  connectionId: "cli",
  reasoningEfforts: ["low", "high"],
  isManual: true,
  isFree: true,
};

const HAIKU: PageAgentModel = {
  ...OPUS,
  id: "model-3",
  name: "Claude Code · Haiku",
  modelName: undefined,
  model: "claude-haiku",
  reasoningEfforts: ["low"],
  isManual: false,
  isFree: false,
};

interface FieldOptions {
  readonly models?: readonly PageAgentModel[];
  readonly disabled?: boolean;
  readonly isModelWithdrawn?: boolean;
  readonly savedModel?: string;
  readonly savedAlias?: string | null;
}

function draft(
  modelProfileId: string,
  reasoningEffort: string | null = null,
): PageAgentInput {
  return {
    name: "Reviewer",
    modelProfileId,
    reasoningEffort,
    configuration: emptyAgentConfiguration(),
  };
}

/** Keeps the draft as the form does and reports every change. */
function ModelDraft(props: {
  readonly initial: PageAgentInput;
  readonly options: FieldOptions;
  readonly onChange: (input: PageAgentInput) => void;
}): React.ReactElement {
  const [input, setInput] = useState(props.initial);
  function change(next: PageAgentInput): void {
    setInput(next);
    props.onChange(next);
  }
  return (
    <PageAgentModelFields
      draft={input}
      models={props.options.models ?? [MODEL, OPUS, HAIKU]}
      disabled={props.options.disabled ?? false}
      isModelWithdrawn={props.options.isModelWithdrawn ?? false}
      savedModel={props.options.savedModel}
      savedAlias={props.options.savedAlias}
      onChange={change}
    />
  );
}

function renderFields(
  initial: PageAgentInput,
  options: FieldOptions = {},
): {
  readonly onChange: ReturnType<typeof vi.fn>;
  readonly container: HTMLElement;
} {
  const onChange = vi.fn();
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <ModelDraft initial={initial} options={options} onChange={onChange} />
    </I18nextProvider>,
  );
  return { onChange, container };
}

function modelPicker(): HTMLElement {
  return modelTrigger(i18n.t("pageAgents.model"));
}

function reasoningPicker(): HTMLElement {
  return screen.getByRole("combobox", { name: i18n.t("pageAgents.reasoning") });
}

it("describes every released model by its short name and free badge", async () => {
  renderFields(draft(MODEL.id));

  expect(modelPicker().textContent).toContain("Sonnet");
  const rows = await openModelRows(modelPicker());

  expect(rows.map((row) => row.getAttribute("aria-label")).toSorted()).toEqual([
    "Claude Code · Haiku",
    `Opus, ${i18n.t("plans.modelPicker.free")}`,
    "Sonnet",
  ]);
});

it("keeps the chosen level when another model is selected", async () => {
  const { onChange } = renderFields(draft(OPUS.id, "high"));

  const rows = await openModelRows(modelPicker());
  fireEvent.click(
    rows.find(
      (row) => row.getAttribute("aria-label") === "Claude Code · Haiku",
    ) ?? document.body,
  );

  expect(onChange).toHaveBeenLastCalledWith(draft(HAIKU.id, "high"));
});

it("chooses a listed level and the default again", async () => {
  const { onChange } = renderFields(draft(OPUS.id));

  await chooseOption(reasoningPicker(), "high");
  expect(onChange).toHaveBeenLastCalledWith(draft(OPUS.id, "high"));
  await chooseOption(reasoningPicker(), i18n.t("pageAgents.defaultReasoning"));

  expect(onChange).toHaveBeenLastCalledWith(draft(OPUS.id));
});

it("explains which model lacks a level of its target", async () => {
  renderFields(draft(HAIKU.id));

  fireEvent.keyDown(reasoningPicker(), { key: "Enter" });
  const high = await screen.findByRole("option", { name: "high" });

  expect(high.getAttribute("aria-disabled")).toBe("true");
  expect(high.textContent).toContain(
    i18n.t("reasoningChoice.unsupported", { model: HAIKU.name }),
  );
});

it("names the model of an unsupported level by its catalog name", async () => {
  renderFields(draft(OPUS.id), {
    models: [OPUS, { ...HAIKU, reasoningEfforts: ["max"] }],
  });

  fireEvent.keyDown(reasoningPicker(), { key: "Enter" });
  const max = await screen.findByRole("option", { name: "max" });

  expect(max.textContent).toContain(
    i18n.t("reasoningChoice.unsupported", { model: "Opus" }),
  );
});

it("locks the reasoning of a model without levels", () => {
  renderFields(draft(MODEL.id));

  expect(reasoningPicker().hasAttribute("disabled")).toBe(true);
  expect(modelPicker().hasAttribute("disabled")).toBe(false);
});

it("locks both pickers of a read-only agent", () => {
  renderFields(draft(OPUS.id), { disabled: true });

  expect(modelPicker().hasAttribute("disabled")).toBe(true);
  expect(reasoningPicker().hasAttribute("disabled")).toBe(true);
});

it("names a withdrawn saved model and asks for a replacement", () => {
  renderFields(draft("gone"), {
    isModelWithdrawn: true,
    savedModel: "claude-legacy",
  });

  expect(modelPicker().textContent).toContain(
    `claude-legacy · ${i18n.t("pageAgents.missingModel")}`,
  );
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("pageAgents.modelWithdrawn"),
  );
});

it("marks a missing model without a saved name", () => {
  renderFields(draft("gone"));

  expect(modelPicker().textContent).toContain(
    i18n.t("pageAgents.missingModel"),
  );
  expect(screen.queryByRole("status")).toBeNull();
});

it.each([
  [OPUS, "Opus"],
  [HAIKU, HAIKU.name],
])("explains which version the saved alias stands for", (model, name) => {
  renderFields(draft(model.id), { savedAlias: "sonnet" });

  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("pageAgents.modelAlias", {
      alias: "sonnet",
      model: name,
      id: model.model,
    }),
  );
});

it("keeps quiet about an alias of a model that is gone", () => {
  renderFields(draft("gone"), { savedAlias: "sonnet" });

  expect(screen.queryByRole("status")).toBeNull();
});
