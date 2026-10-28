import { act, fireEvent, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PageAgentPageView } from "@/app/components/agents/definitions/page-agent-page";

import { i18n, PAGE, pageAgent, renderAgentRoute } from "./page-agent-fixture";

import type { PageAgentPage } from "@/definition/PageAgent";

// The rich-text editor needs a real layout engine; the form only hands it the markdown.
vi.mock("@/app/components/editor/block-editor", () => ({
  BlockEditor: (props: { readonly label: string }) => (
    <textarea aria-label={props.label} readOnly />
  ),
}));

function renderPage(page: PageAgentPage): ReturnType<typeof renderAgentRoute> {
  return renderAgentRoute(<PageAgentPageView page={page} />);
}

function createButton(): HTMLElement {
  return screen.getByRole("button", { name: i18n.t("pageAgents.create") });
}

it("offers the agent management only to an administrator", () => {
  renderPage({ ...PAGE, isAdministrator: true });

  expect(
    screen
      .getByRole("link", { name: i18n.t("navigation.agentManagement") })
      .getAttribute("href"),
  ).toBe("/settings/agents");
});

it("tells a person without a released model that nothing can be created", () => {
  renderPage({ ...PAGE, models: [] });

  expect(
    screen.queryByRole("link", { name: i18n.t("navigation.agentManagement") }),
  ).toBeNull();
  expect(createButton().hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("status").textContent).toBe(
    i18n.t("pageAgents.noModels"),
  );
  expect(screen.getByText(i18n.t("pageAgents.empty"))).toBeDefined();
});

it("lists the visible agents in a table with every column", () => {
  renderPage({
    ...PAGE,
    agents: [pageAgent(), pageAgent({ id: "agent-2", name: "Writer" })],
  });

  expect(
    screen.getAllByRole("columnheader").map((header) => header.textContent),
  ).toEqual(
    ["name", "model", "reasoning", "sharing", "status", "actions"].map(
      (column) => i18n.t(`pageAgents.${column}`),
    ),
  );
  expect(
    screen.getAllByRole("rowheader").map((header) => header.textContent),
  ).toEqual(["Reviewer", "Writer"]);
  expect(screen.queryByRole("status")).toBeNull();
});

it("creates a new agent in the dialog and closes it untouched", () => {
  renderPage(PAGE);

  fireEvent.click(createButton());
  const dialog = screen.getByRole("dialog");

  expect(
    within(dialog).getByRole("heading", { name: i18n.t("pageAgents.create") })
      .textContent,
  ).toBe(i18n.t("pageAgents.create"));
  fireEvent.click(
    within(dialog).getByRole("button", {
      name: i18n.t("settings.agents.cancel"),
    }),
  );
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("opens a listed agent in the same dialog", () => {
  renderPage({ ...PAGE, agents: [pageAgent({ canEdit: false })] });

  fireEvent.click(
    screen.getByRole("button", { name: i18n.t("pageAgents.view") }),
  );
  const dialog = screen.getByRole("dialog");

  expect(
    within(dialog).getByRole("heading", {
      name: i18n.t("pageAgents.viewAgent"),
    }),
  ).toBeDefined();
  expect(
    within(dialog).getByRole<HTMLInputElement>("textbox", {
      name: i18n.t("pageAgents.name"),
    }).value,
  ).toBe("Reviewer");
});

it("shows placeholders while the list reloads for longer than a moment", async () => {
  const { router } = renderPage({ ...PAGE, agents: [pageAgent()] });

  await act(async () => {
    void router.navigate("/slow");
  });

  expect(
    await screen.findByRole("status", { name: i18n.t("pageAgents.loading") }),
  ).toBeDefined();
  expect(screen.queryByRole("table")).toBeNull();
});
