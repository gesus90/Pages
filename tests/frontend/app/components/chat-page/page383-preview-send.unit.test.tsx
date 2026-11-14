import { act, render, renderHook, screen } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { ChatPageHistory } from "@/app/components/chat-page/chat-page-history";
import { useChatPage } from "@/app/components/chat-page/use-chat-page";
import { createI18n } from "@/app/lib/i18n";

import { directory, group, message, participant } from "./chat-page-fixture";

const submit = vi.hoisted(() => vi.fn());
const fetcher = vi.hoisted(() => ({
  state: "idle",
  data: undefined as unknown,
  formData: undefined as FormData | undefined,
  submit,
}));
vi.mock("react-router", () => ({
  useFetcher: () => fetcher,
  useRevalidator: () => ({ state: "idle", revalidate: vi.fn() }),
}));

function sent(): Record<string, string>[] {
  return submit.mock.calls.map((call: unknown[]) => {
    const formData = call[0];
    if (!(formData instanceof FormData)) throw new Error("no form submitted");
    return Object.fromEntries([...formData.entries()].map(([key, entry]) => [key, String(entry)]));
  });
}

beforeEach(() => {
  submit.mockReset();
  fetcher.formData = undefined;
  fetcher.state = "idle";
});

it("sends the text of a preview into the opened group as an ordinary message marked by its client ID (PAGE-383)", () => {
  const { result } = renderHook(() => useChatPage(directory({ groups: [group("g")] })));
  act(() => result.current.sendFromPreview("Variante B nehmen @ed"));
  const [entries] = sent();
  expect(entries).toMatchObject({ intent: "send-group", groupId: "g", text: "Variante B nehmen @ed" });
  expect(entries?.["clientMessageId"]).toMatch(/^preview-[0-9a-f-]{36}$/u);
});

it("sends the text of a preview to an agent of a direct chat, and nothing for blank text (PAGE-383)", () => {
  const { result } = renderHook(() => useChatPage(directory({ participants: [participant("ed")] })));
  act(() => result.current.sendFromPreview("   "));
  expect(submit).not.toHaveBeenCalled();
  act(() => result.current.sendFromPreview("B"));
  expect(sent()[0]).toMatchObject({ intent: "send", agentId: "ed", text: "B" });
});

it("shows the message of a preview on its way with its mark (PAGE-383)", () => {
  const formData = new FormData();
  formData.set("text", "B");
  formData.set("groupId", "g");
  formData.set("clientMessageId", "preview-1");
  fetcher.formData = formData;
  fetcher.state = "submitting";
  const { result } = renderHook(() => useChatPage(directory({ groups: [group("g")] })));
  expect(result.current.messages.at(-1)).toMatchObject({ id: "pending", content: "B", isFromPreview: true });
});

it("marks own and other messages sent from a preview in the history (PAGE-383)", () => {
  const ada = participant("ada", { name: "Ada", kind: "human" });
  render(
    <I18nextProvider i18n={createI18n("de")}>
      <ChatPageHistory
        findParticipant={(id) => (id === "ada" ? ada : undefined)}
        messages={[
          { ...message("1"), isFromPreview: true },
          { ...message("2"), authorId: "ada", isFromPreview: true },
          message("3"),
        ]}
        name="Team"
      />
    </I18nextProvider>,
  );
  expect(screen.getAllByText("aus der Vorschau gesendet")).toHaveLength(2);
});
