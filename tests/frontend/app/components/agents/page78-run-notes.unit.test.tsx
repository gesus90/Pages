import { I18nextProvider } from "react-i18next";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { AgentTemplateEditor } from "@/app/components/settings/agents/agent-template-editor";
import { createI18n } from "@/app/lib/i18n";
import { emptyAgentConfiguration } from "@/definition/AgentConfiguration";

vi.mock("@/app/components/editor/block-editor", () => ({
  BlockEditor: ({
    markdown,
  }: {
    readonly markdown: string;
  }): React.ReactElement => (
    <div data-testid="template-preview">{markdown}</div>
  ),
}));

it("documents the catalog's token and keeps preview symbolic without suggesting a parameter input", () => {
  const i18n = createI18n("de");
  render(
    <I18nextProvider i18n={i18n}>
      <AgentTemplateEditor
        configuration={{
          ...emptyAgentConfiguration(),
          markdown: "{{@run.notes}}",
        }}
        provider="codex_cli"
        disabled={false}
        onChange={vi.fn()}
      />
    </I18nextProvider>,
  );
  expect(screen.getByTestId("template-preview").textContent).toBe(
    "{{@run.notes}}",
  );
  expect(
    screen.getByText(i18n.t("settings.agents.definition.runNotesHint")),
  ).toBeDefined();
  expect(
    screen.queryByRole("button", {
      name: i18n.t("settings.agents.definition.confirmParameter"),
    }),
  ).toBeNull();
  expect(screen.queryByRole("status")).toBeNull();
});
