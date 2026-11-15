import { describe, expect, it, vi } from "vitest";

import {
  chatModelNote,
  directChatMenu,
  groupChatMenu,
} from "@/app/components/chat-page/chat-menu/chat-menu-model";
import { createI18n } from "@/app/lib/i18n";

import { group, participant } from "../chat-page-fixture";

import type {
  ChatMenuEntry,
  ChatMenuModel,
  GroupChatMenuInput,
  DirectChatMenuInput,
} from "@/app/components/chat-page/chat-menu/chat-menu-model";

const i18n = createI18n("de");
const t = (key: string, options?: Record<string, unknown>): string =>
  i18n.t(key, options);
const ED = participant("ed", { name: "Ed" });
const MEI = participant("mei", { name: "Mei" });
const ANNA = participant("anna", { name: "Anna", kind: "human", role: "" });
const OPUS = {
  name: "Claude Opus 5.5",
  reasoningEffort: "high",
  isOverride: true,
  contextWindow: null,
};

function groupInput(
  overrides: Partial<GroupChatMenuInput> = {},
): GroupChatMenuInput {
  return {
    t,
    group: group("g", { name: "Pages Team", memberIds: ["ed", "mei", "anna"] }),
    agents: [ED, MEI],
    mediaNote: "8",
    onOpenMedia: vi.fn(),
    isConfidential: false,
    onToggleConfidential: vi.fn(),
    isMuted: false,
    onToggleMute: vi.fn(),
    onOpenDialog: vi.fn(),
    onOpenModel: vi.fn(),
    ...overrides,
  };
}

function directInput(
  overrides: Partial<DirectChatMenuInput> = {},
): DirectChatMenuInput {
  return {
    t,
    participant: ED,
    mediaNote: "0",
    onOpenMedia: vi.fn(),
    isConfidential: false,
    onToggleConfidential: vi.fn(),
    isMuted: null,
    onToggleMute: vi.fn(),
    onOpenModel: vi.fn(),
    onNewSession: vi.fn(),
    isNewSessionPending: false,
    ...overrides,
  };
}

function ids(model: ChatMenuModel): Record<string, readonly string[]> {
  return Object.fromEntries(
    model.sections.map((section) => [
      section.id,
      section.entries.map((entry) => entry.id),
    ]),
  );
}

function find(model: ChatMenuModel, id: string): ChatMenuEntry {
  const entry = model.sections
    .flatMap((section) => section.entries)
    .find((candidate) => candidate.id === id);
  if (entry === undefined) throw new Error(`No entry ${id}`);
  return entry;
}

describe("the chat menu of a group (PAGE-389)", () => {
  it("names the group with its members and orders the sections", () => {
    const model = groupChatMenu(
      groupInput({
        group: group("g", {
          name: "Pages Team",
          memberIds: ["ed", "mei", "anna"],
          isOwner: true,
          canControlSessions: true,
        }),
      }),
    );
    expect(model.title).toBe("Pages Team");
    expect(model.subtitle).toBe("Gruppe · 4 Mitglieder");
    expect(model.sections.map((section) => section.title)).toEqual([
      "Inhalte",
      "Zusammenarbeit",
      "Einstellungen",
      undefined,
    ]);
    expect(ids(model)).toEqual({
      content: ["media", "context"],
      collaboration: ["members", "reply", "model", "sessions"],
      settings: ["confidential", "mute"],
      danger: ["dissolve"],
    });
    const dissolve = find(model, "dissolve");
    expect(dissolve.kind === "action" && dissolve.isDestructive).toBe(true);
    expect(model.sections.at(-1)?.isSeparated).toBe(true);
  });

  it("shows counts and the current mode as remarks", () => {
    const model = groupChatMenu(
      groupInput({
        group: group("g", { memberIds: ["ed", "mei"], replyMode: "mentions" }),
      }),
    );
    expect(find(model, "media")).toMatchObject({ note: "8", opensMore: true });
    expect(find(model, "members")).toMatchObject({ note: "3" });
    expect(find(model, "reply")).toMatchObject({ note: "Nur @" });
  });

  it("leaves out what the person may not use", () => {
    const model = groupChatMenu(
      groupInput({
        group: group("g", { isOwner: false, canControlSessions: false }),
        isConfidential: null,
        isMuted: null,
      }),
    );
    expect(ids(model)).toEqual({
      content: ["media", "context"],
      collaboration: ["members", "reply", "sessions"],
    });
  });

  it("opens the dialogs of the entries with arrows", () => {
    const onOpenDialog = vi.fn();
    const model = groupChatMenu(
      groupInput({ group: group("g", { isOwner: true }), onOpenDialog }),
    );
    for (const id of ["context", "members", "reply", "sessions", "dissolve"]) {
      const entry = find(model, id);
      if (entry.kind === "action") entry.onSelect();
    }
    expect(onOpenDialog.mock.calls.map(([dialog]) => dialog)).toEqual([
      "context",
      "members",
      "reply",
      "sessions",
      "dissolve",
    ]);
  });

  it("switches confidential and muting at once", () => {
    const input = groupInput({ isConfidential: true, isMuted: false });
    const model = groupChatMenu(input);
    const confidential = find(model, "confidential");
    const mute = find(model, "mute");
    expect(confidential).toMatchObject({ kind: "toggle", isOn: true });
    expect(mute).toMatchObject({ kind: "toggle", isOn: false });
    if (confidential.kind === "toggle") confidential.onToggle();
    if (mute.kind === "toggle") mute.onToggle();
    expect(input.onToggleConfidential).toHaveBeenCalledTimes(1);
    expect(input.onToggleMute).toHaveBeenCalledTimes(1);
  });

  it("asks for the agent whose model changes, with the model of each", () => {
    const onOpenModel = vi.fn();
    const model = groupChatMenu(
      groupInput({
        group: group("g", {
          canControlSessions: true,
          agentModels: {
            ed: OPUS,
            mei: { ...OPUS, name: "Claude Sonnet 5.5", isOverride: false },
          },
        }),
        onOpenModel,
      }),
    );
    const entry = find(model, "model");
    expect(entry).toMatchObject({ kind: "submenu", note: "1 angepasst" });
    if (entry.kind !== "submenu") return;
    expect(entry.entries.map((child) => [child.label, child.note])).toEqual([
      ["Ed", "Opus · hoch"],
      ["Mei", "Sonnet · hoch"],
    ]);
    entry.entries[1]?.onSelect();
    expect(onOpenModel).toHaveBeenCalledWith(MEI);
  });

  it("opens the model of the only agent at once", () => {
    const onOpenModel = vi.fn();
    const model = groupChatMenu(
      groupInput({
        group: group("g", { canControlSessions: true }),
        agents: [ED],
        onOpenModel,
      }),
    );
    const entry = find(model, "model");
    expect(entry).toMatchObject({ kind: "action", note: "Standard" });
    if (entry.kind === "action") entry.onSelect();
    expect(onOpenModel).toHaveBeenCalledWith(ED);
  });
});

describe("the chat menu of a direct chat (PAGE-389)", () => {
  it("offers an agent its media, model, a new session and confidentiality", () => {
    const input = directInput({ participant: { ...ED, chatModel: OPUS } });
    const model = directChatMenu(input);
    expect(model.subtitle).toBe("Direkt-Chat · Agent");
    expect(ids(model)).toEqual({
      content: ["media", "model", "new"],
      settings: ["confidential"],
    });
    expect(find(model, "model")).toMatchObject({ note: "Opus · hoch" });
    expect(find(model, "new")).toMatchObject({
      label: "Neue Sitzung",
      note: "/new",
    });
    const renew = find(model, "new");
    if (renew.kind === "action") renew.onSelect();
    expect(input.onNewSession).toHaveBeenCalledTimes(1);
  });

  it("turns the new session off while one starts", () => {
    const model = directChatMenu(directInput({ isNewSessionPending: true }));
    expect(find(model, "new")).toMatchObject({ isDisabled: true });
  });

  it("offers a person the embedded websites and muting, but no model", () => {
    const onOpenEmbedDomains = vi.fn();
    const model = directChatMenu(
      directInput({
        participant: ANNA,
        isConfidential: null,
        isMuted: true,
        onOpenEmbedDomains,
      }),
    );
    expect(model.subtitle).toBe("Direkt-Chat · Person");
    expect(ids(model)).toEqual({
      content: ["media", "embed"],
      settings: ["mute"],
    });
    expect(find(model, "embed")).toMatchObject({
      label: "Eingebettete Webseiten",
    });
  });

  it("leaves out the embedded websites of a chat that is not stored yet", () => {
    const model = directChatMenu(
      directInput({ participant: ANNA, isConfidential: null, isMuted: null }),
    );
    expect(ids(model)).toEqual({ content: ["media"] });
  });
});

it("names the standard model when the chat has none of its own", () => {
  expect(chatModelNote(t, undefined)).toBe("Standard");
  expect(chatModelNote(t, { ...OPUS, reasoningEffort: null })).toBe("Opus");
});
