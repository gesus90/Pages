import { fireEvent, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { PageAgentDelete } from "@/app/components/agents/definitions/page-agent-delete";

import {
  heldAnswer,
  i18n,
  pageAgent,
  renderAgentRoute,
} from "./page-agent-fixture";

import type { AgentActionAnswer } from "./page-agent-fixture";

function confirmButton(): HTMLElement {
  return screen.getByRole("button", {
    name: i18n.t("pageAgents.confirmDelete"),
  });
}

function cancelButton(): HTMLElement {
  return screen.getByRole("button", { name: i18n.t("settings.agents.cancel") });
}

it("submits the confirmed deletion and closes once the server removed the agent", async () => {
  const onClose = vi.fn();
  const { submissions } = renderAgentRoute(
    <PageAgentDelete agent={pageAgent()} onClose={onClose} />,
    async () => ({ ok: true, intent: "delete-agent" }),
  );

  expect(
    screen.getByRole("heading", {
      name: i18n.t("pageAgents.deleteTitle", { name: "Reviewer" }),
    }),
  ).toBeDefined();
  fireEvent.click(confirmButton());

  await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  const [formData] = submissions;
  expect(formData?.get("intent")).toBe("delete-agent");
  expect(formData?.get("agentId")).toBe("agent-1");
  expect(formData?.get("confirmation")).toBe("LÖSCHEN");
});

it.each<{ readonly answer: string; readonly result: AgentActionAnswer }>([
  {
    answer: "a refusal",
    result: { ok: false, intent: "delete-agent", error: "accessDenied" },
  },
  {
    answer: "the success of another intent",
    result: { ok: true, intent: "save-agent" },
  },
])("stays open after $answer", async ({ result }) => {
  const onClose = vi.fn();
  const { action } = renderAgentRoute(
    <PageAgentDelete agent={pageAgent()} onClose={onClose} />,
    async () => result,
  );

  fireEvent.click(confirmButton());

  await waitFor(() => expect(action).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(confirmButton().hasAttribute("disabled")).toBe(false),
  );
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog")).toBeDefined();
});

it("shows the translated reason of a refused deletion", async () => {
  renderAgentRoute(
    <PageAgentDelete agent={pageAgent()} onClose={vi.fn()} />,
    async () => ({ ok: false, intent: "delete-agent", error: "accessDenied" }),
  );

  fireEvent.click(confirmButton());

  expect((await screen.findByRole("alert")).textContent).toBe(
    i18n.t("agentExecution.error.accessDenied"),
  );
});

it("cancels at once but ignores every dismissal while the deletion is pending", async () => {
  const held = heldAnswer();
  const onClose = vi.fn();
  renderAgentRoute(
    <PageAgentDelete agent={pageAgent()} onClose={onClose} />,
    held.answer,
  );

  fireEvent.click(confirmButton());
  await waitFor(() =>
    expect(cancelButton().hasAttribute("disabled")).toBe(true),
  );
  expect(confirmButton().hasAttribute("disabled")).toBe(true);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();

  held.release({ ok: false, intent: "delete-agent", error: "accessDenied" });
  await waitFor(() =>
    expect(cancelButton().hasAttribute("disabled")).toBe(false),
  );
  fireEvent.click(cancelButton());
  expect(onClose).toHaveBeenCalledOnce();
});
