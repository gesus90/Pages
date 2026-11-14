import { fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";

import { AgentAccessSection } from "@/app/components/users/agents/agent-access-section";
import { createI18n } from "@/app/lib/i18n";

const i18n = createI18n("en");

it("locks workspace access without isolation and lists detected servers", () => {
  const change = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <AgentAccessSection
        value="read_only"
        savedValue="read_only"
        onChange={change}
        canChange
        environment={{
          isIsolationAvailable: false,
          mcpServers: [{ name: "search", transport: "stdio", source: "user" }],
        }}
      />
    </I18nextProvider>,
  );
  expect(
    screen.getByRole("radio", { name: /workspace/i }).hasAttribute("disabled"),
  ).toBe(true);
  expect(screen.getByText("search")).toBeTruthy();
  expect(screen.getByText("stdio · user")).toBeTruthy();
  expect(
    screen.getByText(i18n.t("agentEmployees.accessTab.isolationMissing")),
  ).toBeTruthy();
  expect(change).not.toHaveBeenCalled();
});

it("requires confirmation before selecting yolo", () => {
  const change = vi.fn();
  render(
    <I18nextProvider i18n={i18n}>
      <AgentAccessSection
        value="read_only"
        savedValue="read_only"
        onChange={change}
        canChange
        environment={{ isIsolationAvailable: true, mcpServers: [] }}
      />
    </I18nextProvider>,
  );
  fireEvent.click(screen.getByRole("radio", { name: /yolo/i }));
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole("button", {
      name: i18n.t("agentEmployees.accessTab.confirm"),
    }),
  );
  expect(change).toHaveBeenCalledWith("yolo");
});
