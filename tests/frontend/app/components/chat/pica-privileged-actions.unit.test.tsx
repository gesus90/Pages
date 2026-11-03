import { render, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";

import { ChatPrivilegedActions } from "@/app/components/chat/chat-privileged-actions";
import { ChatJobStatus } from "@/app/components/chat/chat-job-status";
import { startChatLiveJob } from "@/app/components/chat/chat-job-state";
import { createI18n } from "@/app/lib/i18n";

import type { ChatLiveJob } from "@/app/components/chat/chat-job-state";
import type { ChatJobToolEvent } from "@/definition/ChatJob";

function call(
  id: number,
  overrides: Partial<ChatJobToolEvent> = {},
): ChatJobToolEvent {
  return {
    kind: "tool",
    callId: `call-${id}`,
    tool: `list_admin_users_${id}`,
    status: "completed",
    error: null,
    isPrivileged: true,
    ...overrides,
  };
}

function actions(
  tools: readonly ChatJobToolEvent[],
  locale: "de" | "en" = "de",
): React.ReactElement {
  return (
    <I18nextProvider i18n={createI18n(locale)}>
      <ChatPrivilegedActions tools={tools} />
    </I18nextProvider>
  );
}

function live(
  tools: readonly ChatJobToolEvent[],
  state: "running" | "failed" = "running",
): ChatLiveJob {
  return {
    ...startChatLiveJob({
      id: "12345678-1234-4234-8234-123456789abc",
      sessionId: "apfel-birne-kirsche-pflaume-traube",
      state,
      createdAt: "2026-11-03T10:00:00Z",
      endedAt: null,
      errorCode: state === "failed" ? "adminRevoked" : null,
      usage: { context: null, cost: null, tokens: null },
    }),
    tools,
  };
}

it("shows nothing for ordinary tool calls, so the quiet activity row stays quiet", () => {
  const { container } = render(
    actions([
      call(1, { isPrivileged: undefined }),
      call(2, { isPrivileged: false }),
    ]),
  );

  expect(container.textContent).toBe("");
});

it("names each administrator call with its state and the reason of a failure", () => {
  render(
    actions([
      call(1),
      call(2, { status: "running" }),
      call(3, { status: "failed", error: "CONFIRMATION_REQUIRED" }),
      call(4, { status: "failed", error: "ADMIN_REQUIRED" }),
      call(5, { status: "failed", error: "SOMETHING_NEW" }),
    ]),
  );

  const list = screen.getByRole("region", { name: "Administrator-Aktionen" });
  const rows = within(list).getAllByRole("listitem");
  expect(rows.map((row) => row.textContent)).toEqual([
    "list_admin_users_1ausgeführt",
    "list_admin_users_2läuft …",
    "list_admin_users_3wartet auf deine Bestätigung – nichts geändert",
    "list_admin_users_4Administratorrecht fehlt oder wurde entzogen",
    "list_admin_users_5fehlgeschlagen",
  ]);
  expect(within(list).getByRole("list").getAttribute("aria-live")).toBe(
    "polite",
  );
});

it("keeps the latest calls and counts the earlier ones", () => {
  render(
    actions(
      Array.from({ length: 10 }, (_, index) => call(index + 1)),
      "en",
    ),
  );

  const rows = screen.getAllByRole("listitem");
  expect(rows).toHaveLength(9);
  expect(rows[0].textContent).toBe("2 earlier actions");
  expect(rows.at(-1)?.textContent).toBe("list_admin_users_10done");
});

it("belongs to the running job and to the status of a job that ended", () => {
  const tools = [call(1, { status: "failed", error: "ADMIN_REQUIRED" })];
  const { rerender } = render(
    <I18nextProvider i18n={createI18n("de")}>
      <ChatJobStatus live={live(tools)} isOpen />
    </I18nextProvider>,
  );
  expect(screen.getByText("list_admin_users_1")).toBeTruthy();
  expect(screen.getByRole("timer")).toBeTruthy();

  rerender(
    <I18nextProvider i18n={createI18n("de")}>
      <ChatJobStatus
        live={{
          ...live(tools, "failed"),
          ended: { kind: "end", state: "failed", errorCode: "adminRevoked" },
        }}
        isOpen
      />
    </I18nextProvider>,
  );
  expect(screen.getByText("list_admin_users_1")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain(
    "Administratorrechte entzogen",
  );
});
