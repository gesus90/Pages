// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { ProjectActivityTab } from "@/app/components/projects/project-activity-tab";
import { ChatSettingsCard } from "@/app/components/settings/system/chat-settings-card";
import { createI18n } from "@/app/lib/i18n";

import { CHAT_ADMINISTRATION } from "../helpers/chat";

import type { SettingsActionData } from "@/app/lib/settings-actions/settings-action-support.server";
import type { ChatAdministration } from "@/definition/Chat";
import type { ProjectActivity } from "@/definition/Project";

function renderCard(
  settings: ChatAdministration,
  respond: SettingsActionData = { intent: "update-chat-settings", ok: true },
) {
  const submitted = vi.fn<(fields: Record<string, string>) => void>();
  const Stub = createRoutesStub([
    {
      Component: () => <ChatSettingsCard settings={settings} />,
      action: async ({ request }) => {
        const form = await request.formData();
        submitted(
          Object.fromEntries(
            [...form.entries()].map(([key, value]) => [key, String(value)]),
          ),
        );
        return respond;
      },
      path: "/settings/system",
    },
  ]);
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <Stub initialEntries={["/settings/system"]} />
    </I18nextProvider>,
  );
  return { user: userEvent.setup(), submitted };
}

function entry(
  id: string,
  source: ProjectActivity["source"],
  category: ProjectActivity["category"] = "tasks",
): ProjectActivity {
  return {
    id,
    projectId: "p1",
    userId: "writer",
    userDisplayName: "Wanda Writer",
    category,
    action: "ticket.create",
    message: `Eintrag ${id}`,
    createdAt: `2026-10-12T08:0${id}:00Z`,
    source,
  };
}

describe("A11.4: chat settings of administrators", () => {
  it("edits the attachment limit and the Markdown instruction next to a link to the agents panel", async () => {
    const { user, submitted } = renderCard(CHAT_ADMINISTRATION);
    const card = screen
      .getByRole("heading", { name: "Chat-Assistent Pica" })
      .closest("section");
    if (!card) throw new Error("Missing chat settings card.");
    const limit = within(card).getByRole("textbox", {
      name: "Maximale Anhanggröße (MB)",
    });
    expect(limit).toHaveValue("16");
    expect(
      within(card).getByRole("textbox", { name: "Systemanweisung (Markdown)" }),
    ).toHaveValue(CHAT_ADMINISTRATION.systemInstruction);
    expect(
      within(card).getByText(
        /Die Standardanweisung aus CHAT_AGENT.md ist aktiv./u,
      ),
    ).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "Einstellungen › Agents" }),
    ).toHaveAttribute("href", "/settings/agents");
    expect(
      within(card).queryByRole("button", { name: "Standard wiederherstellen" }),
    ).toBeNull();
    await user.clear(limit);
    await user.type(limit, "512");
    await user.click(
      within(card).getByRole("button", {
        name: "Chat-Einstellungen speichern",
      }),
    );
    expect(await within(card).findByText("Gespeichert.")).toBeInTheDocument();
    expect(submitted).toHaveBeenCalledWith({
      intent: "update-chat-settings",
      attachmentLimitMegabytes: "512",
      systemInstruction: CHAT_ADMINISTRATION.systemInstruction,
    });
  });

  it("restores the default instruction and shows invalid input", async () => {
    const { user, submitted } = renderCard(
      {
        ...CHAT_ADMINISTRATION,
        isDefaultInstruction: false,
        systemInstruction: "# Eigen",
      },
      { intent: "update-chat-settings", ok: false, error: "invalidSetting" },
    );
    expect(
      screen.getByText(/Eine eigene Anweisung ist aktiv./u),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Standard wiederherstellen" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Bitte eine Grenze von 1 bis 512 MB",
    );
    expect(submitted).toHaveBeenCalledWith(
      expect.objectContaining({ resetInstruction: "true" }),
    );
  });
});

describe("A11.4 AK-08: AI actions in the project activity", () => {
  it("marks chat actions as AI actions and MCP changes as such, under the person's name", () => {
    render(
      <I18nextProvider i18n={createI18n("de")}>
        <ProjectActivityTab
          activity={[
            entry("1", "ui"),
            entry("2", "mcp"),
            entry("3", "ai", "wiki"),
          ]}
          taskHistory={[]}
        />
      </I18nextProvider>,
    );
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    const [ai, mcp, ui] = items;
    expect(ai).toHaveTextContent("Wanda Writer");
    expect(within(ai).getByText("KI-Aktion über Pica")).toBeInTheDocument();
    expect(within(ai).getByText("Wiki")).toBeInTheDocument();
    expect(within(mcp).getByText("über MCP")).toBeInTheDocument();
    expect(within(ui).queryByText(/über/u)).toBeNull();
  });
});
