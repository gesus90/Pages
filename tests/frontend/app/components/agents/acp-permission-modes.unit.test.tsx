import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { AgentRunOptionsFields } from "@/app/components/settings/agents/agent-run-options-fields";
import { createI18n } from "@/app/lib/i18n";
import {
  DEFAULT_AGENT_RUN_OPTIONS,
  acpRunOptions,
} from "@/definition/AgentConfiguration";

import type {
  AgentConfiguration,
  AgentRunOptions,
} from "@/definition/AgentConfiguration";
import type { Mock } from "vitest";
import type { AgentProviderId } from "@/definition/AgentConnection";

type SaveMock = Mock<(configuration: AgentConfiguration) => void>;

const i18n = createI18n("de");
const scrollIntoView = HTMLElement.prototype.scrollIntoView;

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  HTMLElement.prototype.scrollIntoView = scrollIntoView;
});

// An agent saved without run options.
const WITHOUT_RUN: AgentConfiguration = {
  scope: "person",
  tag: "",
  markdown: "",
  projectId: null,
  accessMode: "shared",
  parameters: [],
  directoryParameter: null,
  sharing: { isGlobal: false, targets: [] },
};

function ModeDraft(props: {
  readonly initial: AgentConfiguration;
  readonly provider: AgentProviderId;
  readonly onSave: (configuration: AgentConfiguration) => void;
}): React.ReactElement {
  const [configuration, setConfiguration] = useState(props.initial);
  return (
    <div>
      <AgentRunOptionsFields
        configuration={configuration}
        provider={props.provider}
        disabled={false}
        onChange={setConfiguration}
      />
      <button onClick={() => props.onSave(configuration)}>Save draft</button>
    </div>
  );
}

const ACP_PROVIDERS = ["codex_cli", "claude_code"] as const;

function renderModes(
  initial: AgentConfiguration,
  provider: AgentProviderId = "codex_cli",
): { readonly saved: SaveMock; readonly unmount: () => void } {
  const saved = vi.fn<(configuration: AgentConfiguration) => void>();
  const { unmount } = render(
    <I18nextProvider i18n={i18n}>
      <ModeDraft initial={initial} provider={provider} onSave={saved} />
    </I18nextProvider>,
  );
  return { saved, unmount };
}

function modeSelect(): HTMLElement {
  return screen.getByRole("combobox", {
    name: i18n.t("settings.agents.run.mode"),
  });
}

async function openOptions(select: HTMLElement): Promise<readonly string[]> {
  fireEvent.keyDown(select, { key: "Enter" });
  const options = await screen.findAllByRole("option");
  return options.map((option) => option.textContent ?? "");
}

function savedRun(saved: SaveMock): AgentRunOptions | undefined {
  return saved.mock.calls.at(-1)?.[0].run;
}

it.each(ACP_PROVIDERS)(
  "offers a %s agent only Nur Lesen and YOLO, without separate switches, stores the choice and shows it again",
  async (provider) => {
    const first = renderModes(WITHOUT_RUN, provider);
    expect(modeSelect().textContent).toContain("Nur Lesen");
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    const options = await openOptions(modeSelect());
    expect(options).toHaveLength(2);
    expect(options[0]).toContain("Nur Lesen");
    expect(options[1]).toContain("YOLO");
    fireEvent.click(screen.getAllByRole("option")[1]);
    expect(
      screen.getByText(i18n.t("settings.agents.run.modes.yolo.description")),
    ).toBeDefined();
    fireEvent.click(screen.getByText("Save draft"));
    expect(savedRun(first.saved)).toEqual(acpRunOptions("yolo", 0));
    first.unmount();

    renderModes({ ...WITHOUT_RUN, run: acpRunOptions("yolo", 0) }, provider);
    expect(modeSelect().textContent).toContain("YOLO");
  },
);

it("keeps the mode when only the timeout changes", () => {
  const draft = renderModes(WITHOUT_RUN, "claude_code");
  fireEvent.change(
    screen.getByRole("spinbutton", {
      name: i18n.t("settings.agents.run.timeout"),
    }),
    { target: { value: "30" } },
  );
  fireEvent.click(screen.getByText("Save draft"));
  expect(savedRun(draft.saved)).toEqual(acpRunOptions("read_only", 30));
});

it.each(ACP_PROVIDERS)(
  "shows no mode for a %s agent saved with the earlier write mode and asks for a choice instead of assuming YOLO",
  async (provider) => {
    renderModes({ ...WITHOUT_RUN, run: DEFAULT_AGENT_RUN_OPTIONS }, provider);
    expect(modeSelect().textContent).toContain(
      i18n.t("settings.agents.run.chooseMode"),
    );
    expect(
      screen.getByText(i18n.t("settings.agents.run.modeRequired")),
    ).toBeDefined();
    const options = await openOptions(modeSelect());
    expect(options.join(" ")).not.toContain(
      i18n.t("plans.session.access.workspace_write"),
    );
    const selectable = screen
      .getAllByRole("option")
      .filter((option) => option.getAttribute("aria-disabled") !== "true");
    expect(selectable.map((option) => option.textContent)).toEqual([
      expect.stringContaining("Nur Lesen"),
      expect.stringContaining("YOLO"),
    ]);
  },
);

it("keeps workspace access, shell and web for runners without ACP and offers them no YOLO", async () => {
  renderModes({ ...WITHOUT_RUN, run: DEFAULT_AGENT_RUN_OPTIONS }, "opencode");
  expect(
    screen.queryByRole("combobox", {
      name: i18n.t("settings.agents.run.mode"),
    }),
  ).toBeNull();
  expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  const options = await openOptions(screen.getByRole("combobox"));
  expect(options).toEqual([
    i18n.t("plans.session.access.workspace_write"),
    i18n.t("plans.session.access.read_only"),
  ]);
});
