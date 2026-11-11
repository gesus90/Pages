import { render, renderHook, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import {
  AgentModelAliasNotice,
  AgentModelField,
} from "@/app/components/settings/agents/agent-model-field";
import { useAgentAssignment } from "@/app/components/settings/agents/use-agent-assignment";
import { createI18n } from "@/app/lib/i18n";

const i18n = createI18n("en");

it("shows an empty model picker and disables it while saving", () => {
  const { result } = renderHook(
    () =>
      useAgentAssignment({ assignment: null, connections: [], catalogs: {} }),
    {
      wrapper: ({ children }) => (
        <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
      ),
    },
  );
  const selection = result.current;
  const view = render(
    <I18nextProvider i18n={i18n}>
      <AgentModelField selection={selection} isPending={false} />
      <AgentModelAliasNotice selection={selection} />
    </I18nextProvider>,
  );
  const picker = screen.getByRole("combobox", {
    name: /^Model/u,
  });
  expect(picker.hasAttribute("disabled")).toBe(false);
  expect(screen.queryByRole("status")).toBeNull();
  view.rerender(
    <I18nextProvider i18n={i18n}>
      <AgentModelField selection={selection} isPending />
      <AgentModelAliasNotice
        selection={{ ...selection, savedAlias: "sonnet", modelId: "claude-1" }}
      />
    </I18nextProvider>,
  );
  expect(picker.hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("status").textContent).toContain("sonnet");
  expect(screen.getByRole("status").textContent).toContain("claude-1");
});
