// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { AgentModelField } from "@/app/components/settings/agents/agent-model-field";
import { AgentReasoningField } from "@/app/components/settings/agents/agent-reasoning-field";
import { useAgentAssignment } from "@/app/components/settings/agents/use-agent-assignment";
import { createI18n } from "@/app/lib/i18n";
import { emptyModelCatalog } from "@/definition/AgentModelCatalog";

import {
  createAgentConnection,
  createCatalogModel,
  createCliConnection,
} from "../helpers/agents";

import type { AgentAssignment } from "@/definition/AgentAssignment";

const api = createAgentConnection({
  id: "google",
  name: "Google one",
  provider: "google_ai_studio",
  checks: {
    auth: {
      status: "passed",
      errorCode: null,
      checkedAt: "now",
      durationMs: 1,
      detail: {},
    },
    model: null,
  },
});
const cli = createCliConnection({
  id: "claude",
  name: "Claude one",
  provider: "claude_code",
  cli: {
    binaryFound: true,
    loggedInAt: "now",
    accountLabel: null,
    login: null,
    terminalCommand: "synthetic",
  },
});
const connections = [api, cli, { ...api, id: "other", name: "Google two" }];
const catalogs = {
  google: {
    ...emptyModelCatalog(),
    models: [
      createCatalogModel({
        id: "models/exact-3",
        name: "Bright",
        reasoning: "levels",
        reasoningEfforts: ["low", "high"],
        isFree: true,
        promptPrice: "0",
        completionPrice: "0",
      }),
      createCatalogModel({
        id: "models/different-2",
        name: "Dim",
        reasoning: "levels",
        reasoningEfforts: ["medium"],
      }),
      createCatalogModel({
        id: "models/automatic-1",
        name: "Automatic",
        reasoning: "automatic",
        promptPrice: "1",
        completionPrice: "1",
      }),
    ],
  },
  claude: {
    ...emptyModelCatalog(),
    models: [
      createCatalogModel({
        id: "claude-sonnet-5-5",
        name: "Sonnet",
        reasoning: "levels",
        reasoningEfforts: ["low", "high"],
      }),
      createCatalogModel({
        id: "claude-opus-5-5[1m]",
        name: "Opus (1M context)",
        reasoning: "levels",
        reasoningEfforts: ["low", "max"],
      }),
      createCatalogModel({
        id: "claude-haiku-5-5",
        name: "Haiku",
        reasoning: "none",
      }),
      createCatalogModel({
        id: "claude-haiku-4-5-20251001",
        name: "Haiku 4.5",
        reasoning: "none",
      }),
      createCatalogModel({
        id: "claude-fable-5-1",
        name: "Fable",
        reasoning: "levels",
        reasoningEfforts: ["max"],
      }),
    ],
  },
  other: {
    ...emptyModelCatalog(),
    models: [createCatalogModel({ id: "models/other", name: "Other account" })],
  },
};

function Fixture(props: {
  readonly assignment: AgentAssignment | null;
  readonly isPending?: boolean;
}): React.ReactElement {
  const selection = useAgentAssignment({
    assignment: props.assignment,
    connections,
    catalogs,
  });
  return (
    <>
      <AgentModelField
        selection={selection}
        isPending={props.isPending ?? false}
      />
      <AgentReasoningField
        selection={selection}
        isPending={props.isPending ?? false}
      />
      <output data-testid="choice">
        {selection.connectionId}|{selection.modelId}|{selection.effort}|
        {selection.error}
      </output>
    </>
  );
}

function story(
  lang: "de" | "en",
  assignment: AgentAssignment | null = null,
  isPending = false,
) {
  const request = vi.fn<typeof fetch>();
  vi.stubGlobal("fetch", request);
  render(
    <I18nextProvider i18n={createI18n(lang)}>
      <Fixture assignment={assignment} isPending={isPending} />
    </I18nextProvider>,
  );
  return { user: userEvent.setup(), request };
}

async function choose(label: string, option: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name: label }));
  await user.click(screen.getByRole("option", { name: option }));
}

function optionNames(): string[] {
  return screen
    .getAllByRole("option")
    .map((option) => option.textContent ?? "");
}

const selected: AgentAssignment = {
  function: "text",
  connectionId: "google",
  model: "models/exact-3",
  reasoningEffort: "high",
};

describe("agent task dropdowns with search", () => {
  it.each(["de", "en"] as const)(
    "lists each connection with its provider and searches connections inside the %s panel",
    async (lang) => {
      const { user, request } = story(lang, selected);
      const label = lang === "de" ? "Anbindung" : "Connection";
      expect(screen.getByRole("combobox", { name: label })).toHaveTextContent(
        "Google one (Google AI Studio API)",
      );
      await user.click(screen.getByRole("combobox", { name: label }));
      expect(optionNames()).toEqual([
        "Google one (Google AI Studio API)",
        "Claude one (Claude Code CLI)",
        "Google two (Google AI Studio API)",
      ]);
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        lang === "de" ? "3 von 3 Anbindungen" : "3 of 3 connections",
      );
      const search = screen.getByRole("searchbox", {
        name: lang === "de" ? "Anbindungen suchen" : "Search connections",
      });
      expect(search).toHaveFocus();
      // The provider's full name is searchable, too.
      await user.type(search, lang === "de" ? "abo" : "subscription");
      expect(optionNames()).toEqual(["Claude one (Claude Code CLI)"]);
      await user.clear(search);
      await user.type(search, "google two");
      expect(optionNames()).toEqual(["Google two (Google AI Studio API)"]);
      await user.clear(search);
      await user.type(search, "zai");
      expect(
        screen.getByText(
          lang === "de"
            ? "Keine passende Anbindung."
            : "No matching connection.",
        ),
      ).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.getByTestId("choice")).toHaveTextContent(
        "google|models/exact-3|high|",
      );
      await choose(label, "Claude one (Claude Code CLI)");
      expect(screen.getByTestId("choice")).toHaveTextContent(
        "claude|||modelUnavailable",
      );
      expect(request).not.toHaveBeenCalled();
    },
  );

  it.each(["de", "en"] as const)(
    "searches models and prefilters levels and free models inside the %s model panel without changing the assignment",
    async (lang) => {
      const { user, request } = story(lang, selected);
      const model = lang === "de" ? "Modell" : "Model";
      await user.click(screen.getByRole("combobox", { name: model }));
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        lang === "de" ? "3 von 3 Modellen" : "3 of 3 models",
      );
      const search = screen.getByRole("searchbox", {
        name: lang === "de" ? "Modelle suchen" : "Search models",
      });
      await user.type(search, "DIFFERENT-2");
      expect(optionNames()).toEqual(["Dim (models/different-2)"]);
      expect(screen.getAllByRole("status")[0]).toHaveTextContent(
        lang === "de" ? "1 von 3 Modellen" : "1 of 3 models",
      );
      await user.clear(search);
      await user.click(
        screen.getByRole("button", {
          name:
            lang === "de" ? "Mit Reasoning-Stufen" : "With reasoning levels",
        }),
      );
      expect(optionNames()).toEqual([
        lang === "de"
          ? "Bright (models/exact-3) · Free (kostenlos)"
          : "Bright (models/exact-3) · Free",
        "Dim (models/different-2)",
      ]);
      await user.click(
        screen.getByRole("button", {
          name: lang === "de" ? "Free (kostenlos)" : "Free",
        }),
      );
      expect(optionNames()).toHaveLength(1);
      expect(
        screen.getByRole("option", { name: /Bright \(models\/exact-3\)/ }),
      ).toHaveAttribute("aria-selected", "true");
      await user.type(search, "zz");
      expect(
        screen.getByText(
          lang === "de"
            ? "Keine passenden Modelle im Katalog dieser Anbindung."
            : "No matching models in this connection’s catalog.",
        ),
      ).toBeInTheDocument();
      await user.keyboard("{Escape}");
      expect(screen.getByTestId("choice")).toHaveTextContent(
        "google|models/exact-3|high|",
      );
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("lists every Claude version with its canonical ID, offers per-model levels and no free prefilter without prices", async () => {
    const { user, request } = story("en", selected);
    await choose("Connection", "Claude one (Claude Code CLI)");
    await user.click(screen.getByRole("combobox", { name: "Model" }));
    expect(screen.queryByRole("button", { name: "Free" })).toBeNull();
    expect(optionNames()).toEqual([
      "Sonnet (claude-sonnet-5-5)",
      "Opus (1M context) (claude-opus-5-5[1m])",
      "Haiku (claude-haiku-5-5)",
      "Haiku 4.5 (claude-haiku-4-5-20251001)",
      "Fable (claude-fable-5-1)",
    ]);
    await user.type(
      screen.getByRole("searchbox", { name: "Search models" }),
      "haiku",
    );
    expect(optionNames()).toEqual([
      "Haiku (claude-haiku-5-5)",
      "Haiku 4.5 (claude-haiku-4-5-20251001)",
    ]);
    await user.click(
      screen.getByRole("option", {
        name: "Haiku 4.5 (claude-haiku-4-5-20251001)",
      }),
    );
    expect(screen.getByTestId("choice")).toHaveTextContent(
      "claude|claude-haiku-4-5-20251001||",
    );
    expect(
      screen.getByText("No reasoning level available", { selector: "p" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Reasoning level" }),
    ).toBeDisabled();
    await choose("Model", "Opus (1M context) (claude-opus-5-5[1m])");
    expect(screen.getByTestId("choice")).toHaveTextContent(
      "claude|claude-opus-5-5[1m]||reasoningUnsupported",
    );
    await user.click(screen.getByRole("combobox", { name: "Reasoning level" }));
    expect(optionNames()).toEqual(["Choose listed level", "low", "max"]);
    await user.click(screen.getByRole("option", { name: "max" }));
    expect(screen.getByTestId("choice")).toHaveTextContent(
      "claude|claude-opus-5-5[1m]|max|",
    );
    await choose("Connection", "Google two (Google AI Studio API)");
    await user.click(screen.getByRole("combobox", { name: "Model" }));
    expect(optionNames()).toEqual(["Other account (models/other)"]);
    expect(request).not.toHaveBeenCalled();
  });

  it("clears a level on model changes and never substitutes missing saved choices", async () => {
    story("de", selected);
    await choose("Modell", "Dim (models/different-2)");
    expect(screen.getByTestId("choice")).toHaveTextContent(
      "google|models/different-2||reasoningUnsupported",
    );
    await choose("Reasoning-Stufe", "medium");
    await choose("Modell", "Automatic (models/automatic-1)");
    expect(
      screen.getByText("Keine Reasoning-Stufe verfügbar", { selector: "p" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("choice")).toHaveTextContent(
      "google|models/automatic-1||",
    );
  });

  it("starts empty, disables the model dropdown without a connection and while saving, and keeps unavailable values visible", () => {
    story("de");
    expect(
      screen.getByRole("combobox", { name: "Anbindung" }),
    ).toHaveTextContent("Anbindung auswählen");
    expect(screen.getByRole("combobox", { name: "Modell" })).toBeDisabled();
    expect(screen.getByTestId("choice")).toHaveTextContent(
      "|||connectionUnavailable",
    );
    story(
      "en",
      {
        ...selected,
        connectionId: "missing",
        model: "removed",
        reasoningEffort: "xhigh",
      },
      true,
    );
    expect(
      screen.getByRole("combobox", { name: "Connection" }),
    ).toHaveTextContent("missing (Unavailable)");
    expect(screen.getByRole("combobox", { name: "Model" })).toHaveTextContent(
      "removed (Unavailable)",
    );
    expect(
      screen
        .getAllByRole("combobox")
        .slice(-3)
        .every((element) => element.hasAttribute("disabled")),
    ).toBe(true);
  });
});
