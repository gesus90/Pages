import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, expect, it, vi } from "vitest";

import {
  ChatPageToolUse,
  formatToolDuration,
} from "@/app/components/chat-page/chat-page-tool-uses";
import { agentDraftPayload, createAgentDraft } from "@/app/components/users/agents/agent-draft";
import { AgentToolGroupsSection } from "@/app/components/users/agents/agent-tool-groups-section";
import { createI18n } from "@/app/lib/i18n";

afterEach(cleanup);

function renderSection(
  props: Partial<React.ComponentProps<typeof AgentToolGroupsSection>> = {},
): ReturnType<typeof vi.fn> {
  const onChange = vi.fn();
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <AgentToolGroupsSection
        access="workspace"
        disabled={[]}
        savedDisabled={[]}
        onChange={onChange}
        canEdit
        canEnable
        {...props}
      />
    </I18nextProvider>,
  );
  return onChange;
}

it("switches a tool group of an agent off (PAGE-390)", () => {
  const onChange = renderSection();
  const browser = screen.getByRole("checkbox", { name: /Browser/u });
  expect((browser as HTMLInputElement).checked).toBe(true);
  fireEvent.click(browser);
  expect(onChange).toHaveBeenCalledWith(["browser"]);
});

it("shows what Nur Lesen allows and offers no shell", () => {
  renderSection({ access: "read_only" });
  const shell = screen.getByRole("checkbox", { name: /Shell/u });
  expect((shell as HTMLInputElement).disabled).toBe(true);
  expect(screen.getAllByText("nur lesen").length).toBe(4);
});

it("keeps a saved disabled group off for someone who may not widen the agent", () => {
  renderSection({
    disabled: ["web"],
    savedDisabled: ["web"],
    canEnable: false,
  });
  const web = screen.getByRole("checkbox", { name: /^Web/u });
  expect((web as HTMLInputElement).disabled).toBe(true);
  expect((web as HTMLInputElement).checked).toBe(false);
});

it("sends the switched-off groups with the agent panel", () => {
  const draft = {
    ...createAgentDraft(null, { roleId: "role", soul: "" }),
    disabledToolGroups: ["browser"] as const,
  };
  expect(JSON.parse(agentDraftPayload(draft, [], null))).toMatchObject({
    disabledToolGroups: ["browser"],
  });
});

it("shows name, short description and duration of a call in the tool line", () => {
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <ul>
        <ChatPageToolUse
          use={{
            name: "web_abrufen",
            detail: "",
            status: "completed",
            summary: "Fetch a public HTTPS page.",
            durationMs: 1530,
            input: '{"url":"https://example.com"}',
            output: "Example",
          }}
        />
      </ul>
    </I18nextProvider>,
  );
  expect(screen.getByText("web_abrufen")).toBeTruthy();
  expect(screen.getByText("Fetch a public HTTPS page.")).toBeTruthy();
  expect(screen.getByText("1.5 s")).toBeTruthy();
  expect(formatToolDuration(340)).toBe("340 ms");
  expect(formatToolDuration(125_000)).toBe("2 min 5 s");
});
