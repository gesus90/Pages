import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPageCommandOutcome } from "@/app/components/chat-page/chat-page-command-outcome";
import { ChatPageContextRings } from "@/app/components/chat-page/chat-page-context-rings";
import { ChatPageHeader } from "@/app/components/chat-page/chat-page-header";
import { ChatPageHistory } from "@/app/components/chat-page/chat-page-history";
import { useChatCommandRunner } from "@/app/components/chat-page/use-chat-command-runner";
import { createI18n } from "@/app/lib/i18n";

import { group, message, participant } from "./chat-page-fixture";

import type { ComponentProps } from "react";
import type { AgentChatControlResponse } from "@/definition/AgentChatControl";
import type { AgentChatSessionBrief } from "@/definition/AgentChatSession";
import type { VirtualGroup } from "@/definition/VirtualChat";
import type { ChatCommandRunner } from "@/app/components/chat-page/use-chat-command-runner";

const router = vi.hoisted(() => ({
  revalidate: vi.fn(),
  fetcher: { data: undefined, state: "idle", submit: vi.fn() },
}));
vi.mock("react-router", () => ({
  useFetcher: () => router.fetcher,
  useRevalidator: () => ({ state: "idle", revalidate: router.revalidate }),
}));

const i18n = createI18n("de");
const ED = participant("ed", { name: "Ed", username: "ed", role: "Entwickler" });
const MEI = participant("mei", { name: "Mei", username: "mei", role: "Test" });
const ANNA = participant("anna", { name: "Anna", kind: "human", role: "", username: "anna" });

const BRIEF: AgentChatSessionBrief = {
  sessionId: "s-ed",
  agentId: "ed",
  state: "ready",
  contextPercent: 62,
  waitingMessages: 0,
  contextUsed: 124_000,
  contextSize: 200_000,
  restartPercent: 80,
};

interface Call {
  readonly url: string;
  readonly fields: Record<string, string>;
}

/** Replaces `fetch` by the control endpoint and records every request. */
function stubControl(answer: (call: Call) => AgentChatControlResponse): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    // The count of "Medien & Dateien" the group menu reads (PAGE-387) is no control call.
    if (String(input).startsWith("/chat/media/")) return new Response("Not Found", { status: 404 });
    const fields =
      init.body instanceof FormData
        ? Object.fromEntries([...init.body.entries()].map(([key, value]) => [key, String(value)]))
        : {};
    const call = { url: String(input), fields };
    calls.push(call);
    return Response.json(answer(call));
  });
  return calls;
}

function teamGroup(overrides: Partial<VirtualGroup> = {}): VirtualGroup {
  return group("team", {
    name: "Pages Team",
    memberIds: ["ed", "mei", "anna"],
    agentSessions: [BRIEF],
    agentModels: {
      ed: { name: "Claude Opus 5.5", reasoningEffort: "high", isOverride: true, contextWindow: null },
      mei: { name: "Claude Sonnet 5.5", reasoningEffort: null, isOverride: false, contextWindow: null },
    },
    ...overrides,
  });
}

function renderHeader(props: Partial<ComponentProps<typeof ChatPageHeader>> = {}): void {
  render(
    <I18nextProvider i18n={i18n}>
      <ChatPageHeader
        opened={{ kind: "group", group: teamGroup(), members: [ED, MEI, ANNA] }}
        participants={[ED, MEI, ANNA]}
        isAnswering={false}
        onStop={vi.fn()}
        onAddMember={vi.fn()}
        isMuted={null}
        onToggleMute={vi.fn()}
        {...props}
      />
    </I18nextProvider>,
  );
}

function openChip(name: RegExp): void {
  fireEvent.pointerDown(screen.getByRole("button", { name }), { button: 0, ctrlKey: false });
}

function item(name: RegExp | string): HTMLElement {
  return screen.getByRole("menuitem", { name });
}

function isOff(element: HTMLElement): boolean {
  return element.getAttribute("aria-disabled") === "true";
}

beforeEach(() => {
  router.revalidate.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the menu of an agent in a chat (PAGE-380)", () => {
  it("shows the deviating model in the head, e.g. „Ed · Opus“", () => {
    renderHeader();
    expect(within(screen.getByRole("button", { name: /^Ed/ })).getByText("Opus")).toBeTruthy();
    // Mei answers with its own model, so no hint.
    expect(within(screen.getByRole("button", { name: /^Mei/ })).queryByText("Sonnet")).toBeNull();
  });

  it("switches restart and compaction off with a hint for a member without the right", () => {
    renderHeader();
    openChip(/^Ed/);
    expect(item(/^Modell in diesem Chat …\s*Opus · hoch$/)).toBeTruthy();
    expect(isOff(item(/^Jetzt verdichten/))).toBe(true);
    expect(isOff(item(/^Neu starten/))).toBe(true);
    expect(screen.getAllByText(/Nur wer vom Besitzer der Gruppe berechtigt ist/)).toHaveLength(2);
    // Removing is for the owner alone.
    const remove = item(/^Aus Gruppe entfernen …/);
    expect(isOff(remove)).toBe(true);
    expect(within(remove).getByText("nur Besitzer")).toBeTruthy();
  });

  it("sends /new and /compact for a member with the right and reads the page again", async () => {
    const calls = stubControl(() => ({ ok: true }));
    renderHeader({
      opened: {
        kind: "group",
        group: teamGroup({ canControlSessions: true }),
        members: [ED, MEI, ANNA],
      },
    });
    openChip(/^Ed/);
    fireEvent.click(item(/^Neu starten/));
    await waitFor(() => expect(router.revalidate).toHaveBeenCalledOnce());
    expect(calls[0]).toEqual({
      url: "/chat-page-api/agent-control",
      fields: { intent: "new", kind: "group", agentId: "ed", conversationId: "team" },
    });
    openChip(/^Ed/);
    fireEvent.click(item(/^Jetzt verdichten/));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]?.fields.intent).toBe("compact");
  });

  it("chooses model and level in the dialog and switches", async () => {
    const calls = stubControl((call) =>
      call.fields.intent === "models" || call.fields.intent === "set-model"
        ? {
            ok: true,
            overview: {
              agentId: "ed",
              agentName: "Ed",
              standard: {
                connectionId: "claude",
                model: "claude-sonnet-5-5",
                reasoningEffort: null,
                name: "Claude Sonnet 5.5",
              },
              override: null,
              choices: [
                {
                  connectionId: "claude",
                  model: "claude-opus-5-5",
                  name: "Claude Opus 5.5",
                  connectionName: "Claude Code",
                  provider: "claude_code",
                  reasoningEfforts: ["low", "medium", "high"],
                  defaultReasoningEffort: "medium",
                  contextWindow: 200_000,
                  aliases: ["opus"],
                },
              ],
              canControl: true,
            },
          }
        : { ok: true },
    );
    renderHeader({
      opened: {
        kind: "group",
        group: teamGroup({ canControlSessions: true }),
        members: [ED, MEI, ANNA],
      },
    });
    openChip(/^Ed/);
    fireEvent.click(item(/^Modell in diesem Chat …/));
    const dialog = await screen.findByRole("dialog", { name: "Modell für Ed in „Pages Team“" });
    fireEvent.click(await within(dialog).findByRole("button", { name: "Claude Opus 5.5" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "hoch" }));
    expect(
      (within(dialog).getByRole("button", { name: "Auf Standard zurücksetzen" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(within(dialog).getByRole("button", { name: "Wechseln" }));
    await waitFor(() => expect(calls.some((call) => call.fields.intent === "set-model")).toBe(true));
    expect(calls.find((call) => call.fields.intent === "set-model")?.fields).toEqual({
      intent: "set-model",
      connectionId: "claude",
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      kind: "group",
      agentId: "ed",
      conversationId: "team",
    });
  });

  it("lets the owner remove an agent after a short question naming what stays", async () => {
    const calls = stubControl(() => ({ ok: true }));
    renderHeader({
      opened: {
        kind: "group",
        group: teamGroup({ isOwner: true, canControlSessions: true }),
        members: [ED, MEI, ANNA],
      },
    });
    openChip(/^Ed/);
    fireEvent.click(item(/^Aus Gruppe entfernen …/));
    const dialog = await screen.findByRole("dialog", { name: "Ed aus „Pages Team“ entfernen?" });
    expect(within(dialog).getByText(/62 % Kontext/)).toBeTruthy();
    expect(within(dialog).getByText(/Claude Opus 5.5 für diesen Chat entfällt/)).toBeTruthy();
    expect(within(dialog).getByText(/MEMORY.md, DREAM.md, Lektionen, Rezepte und Lagebuch/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Entfernen" }));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]?.fields).toEqual({ intent: "remove-member", groupId: "team", memberId: "ed" });
  });

  it("lets the owner remove a person from its chip", async () => {
    const calls = stubControl(() => ({ ok: true }));
    renderHeader({
      opened: { kind: "group", group: teamGroup({ isOwner: true }), members: [ED, MEI, ANNA] },
    });
    fireEvent.pointerDown(screen.getByRole("button", { name: /Anna/ }), { button: 0, ctrlKey: false });
    fireEvent.click(item("Aus Gruppe entfernen …"));
    const dialog = await screen.findByRole("dialog", { name: "Anna aus „Pages Team“ entfernen?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Entfernen" }));
    await waitFor(() => expect(calls[0]?.fields.memberId).toBe("anna"));
  });

  it("asks before the owner dissolves the group, naming the sessions, the history and what stays", async () => {
    const calls = stubControl(() => ({ ok: true }));
    renderHeader({
      opened: { kind: "group", group: teamGroup({ isOwner: true }), members: [ED, MEI, ANNA] },
    });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat-Menü" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(item("Gruppe auflösen"));
    const dialog = await screen.findByRole("dialog", { name: "Gruppe „Pages Team“ auflösen?" });
    expect(within(dialog).getByText("Diese Agenten-Sitzungen werden geschlossen und gelöscht:")).toBeTruthy();
    expect(within(dialog).getByText("Ed")).toBeTruthy();
    expect(within(dialog).getByText("Mei")).toBeTruthy();
    expect(within(dialog).getByText(/endgültig gelöscht/)).toBeTruthy();
    expect(within(dialog).getByText(/Bleibt erhalten: MEMORY.md, DREAM.md/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Gruppe auflösen" }));
    await waitFor(() => expect(calls[0]?.fields).toEqual({ intent: "dissolve", groupId: "team" }));
  });

  it("offers neither the setting of who steers nor the dissolution to another member", () => {
    renderHeader();
    fireEvent.pointerDown(screen.getByRole("button", { name: "Chat-Menü" }), {
      button: 0,
      ctrlKey: false,
    });
    expect(screen.queryByRole("menuitem", { name: "Gruppe auflösen" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: /^Modell für diesen Chat/ })).toBeNull();
  });
});

describe("the context rings at the input field (PAGE-380)", () => {
  it("shows one ring per agent of a group with model, fill, threshold and state", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ChatPageContextRings
          opened={{ kind: "group", group: teamGroup(), members: [ED, MEI, ANNA] }}
          chatName="Pages Team"
        />
      </I18nextProvider>,
    );
    const rings = within(screen.getByRole("group", { name: "Kontext der Agenten in diesem Chat" }))
      .getAllByRole("button");
    expect(rings.map((ring) => ring.getAttribute("aria-label"))).toEqual([
      "Kontext von Ed: 62 %",
      "Kontext von Mei: – %",
    ]);
    fireEvent.focus(rings[0] as HTMLElement);
    const tooltip = screen.getAllByRole("tooltip").find((entry) => !entry.hidden);
    expect(tooltip?.textContent).toContain("Ed · Sitzung in „Pages Team“");
    expect(tooltip?.textContent).toContain("Claude Opus 5.5 · hoch");
    expect(tooltip?.textContent).toContain("nur dieser Chat");
    expect(tooltip?.textContent).toContain("62 % · 124k / 200k Token");
    expect(tooltip?.textContent).toContain("Neustart ab 80 % · bereit");
  });

  it("shows one ring in the direct chat with an agent and none with a person", () => {
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <ChatPageContextRings
          opened={{ kind: "participant", participant: { ...ED, session: BRIEF } }}
          chatName="Ed"
        />
      </I18nextProvider>,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    rerender(
      <I18nextProvider i18n={i18n}>
        <ChatPageContextRings opened={{ kind: "participant", participant: ANNA }} chatName="Anna" />
      </I18nextProvider>,
    );
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});

describe("system lines and chat commands (PAGE-380)", () => {
  it("shows a system line centered for everybody, outside any run of messages", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ChatPageHistory
          messages={[
            { ...message("m1"), authorId: null, content: "@Ed schau dir das an" },
            {
              ...message("line"),
              authorId: null,
              content: "Igor hat Ed in diesem Chat auf Claude Opus 5.5 · hoch umgestellt.",
              notice: "session_event",
            },
          ]}
          name="Pages Team"
          findParticipant={() => undefined}
        />
      </I18nextProvider>,
    );
    const note = screen.getByRole("note");
    expect(note.textContent).toBe("Igor hat Ed in diesem Chat auf Claude Opus 5.5 · hoch umgestellt.");
  });

  it("runs a typed command instead of sending it and leaves other text a message", async () => {
    const calls = stubControl(() => ({
      ok: true,
      outcome: { status: "done", command: "compact", agentName: "Ed" },
    }));
    const opened = { kind: "group" as const, group: teamGroup(), members: [ED, MEI, ANNA] };
    const { result } = renderHook(() => useChatCommandRunner(opened));
    expect(result.current.runIfCommand("Hallo zusammen")).toBe(false);
    let isCommand = false;
    act(() => {
      isCommand = result.current.runIfCommand("/compact @ed");
    });
    expect(isCommand).toBe(true);
    await waitFor(() => expect(result.current.outcome).not.toBeNull());
    expect(calls[0]?.fields).toEqual({
      intent: "command",
      text: "/compact @ed",
      kind: "group",
      conversationId: "team",
    });
    // A direct chat with a person takes no command: the text goes out as a message.
    const person = renderHook(() =>
      useChatCommandRunner({ kind: "participant", participant: ANNA }),
    );
    expect(person.result.current.runIfCommand("/new")).toBe(false);
  });

  it("asks which agent a group command means and runs the completed command", () => {
    const run = vi.fn();
    const runner: ChatCommandRunner = {
      isAvailable: true,
      outcome: {
        status: "chooseAgent",
        command: "new",
        agents: [
          { id: "ed", name: "Ed", username: "ed" },
          { id: "mei", name: "Mei", username: "mei" },
        ],
      },
      isPending: false,
      failure: null,
      runIfCommand: () => false,
      run,
      dismiss: vi.fn(),
    };
    render(
      <I18nextProvider i18n={i18n}>
        <ChatPageCommandOutcome runner={runner} />
      </I18nextProvider>,
    );
    expect(screen.getByText("Welchen Agenten meinst du?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Mei/ }));
    expect(run).toHaveBeenCalledWith("/new @mei");
  });

  it("tells a member without the right that nothing happened", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <ChatPageCommandOutcome
          runner={{
            isAvailable: true,
            outcome: { status: "forbidden" },
            isPending: false,
            failure: null,
            runIfCommand: () => false,
            run: vi.fn(),
            dismiss: vi.fn(),
          }}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText(/Dafür fehlt dir das Recht/)).toBeTruthy();
  });
});
