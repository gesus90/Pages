import { EditorContent } from "@tiptap/react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { beforeEach, expect, it, vi } from "vitest";

import { createI18n } from "@/app/lib/i18n";
import { MentionPicker } from "@/app/components/chat-page/mentions/mention-picker";
import { useMentionEditor } from "@/app/components/chat-page/mentions/use-mention-editor";
import { MentionMarkdown } from "@/app/components/chat-page/mentions/mention-markdown";
import { MentionDirectoryContext } from "@/app/components/chat-page/mentions/mention-context";
import { ChatPageHistory } from "@/app/components/chat-page/chat-page-history";
import {
  activeMention,
  mentionChoices,
  filterMentionChoices,
} from "@/app/components/chat-page/mentions/mention-choices";

import type { MentionEditor } from "@/app/components/chat-page/mentions/use-mention-editor";
import type { ConversationMentionDirectory } from "@/definition/ConversationMention";

const directory: ConversationMentionDirectory = {
  selfId: "igor",
  members: [
    { id: "igor", name: "Igor", username: "igor", kind: "human", role: "" },
    { id: "ed", name: "Ed", username: "ed", kind: "agent", role: "Developer" },
    {
      id: "bakuman",
      name: "Bakuman",
      username: "bakuman",
      kind: "agent",
      role: "Designer",
    },
    {
      id: "pica",
      name: "Pica",
      username: "pica",
      kind: "agent",
      role: "Assistant",
    },
  ],
  aliases: [{ name: "a-team", memberIds: ["ed", "pica"], kind: "group" }],
};
const memberIds = ["igor", "ed", "bakuman"];
const i18n = createI18n("en");
let input: MentionEditor | null = null;
const onSend = vi.fn();

function Harness(): React.ReactElement {
  input = useMentionEditor({
    label: "Message",
    placeholder: "Write",
    directory,
    memberIds,
    onSubmit: onSend,
  });
  return (
    <>
      <EditorContent editor={input.editor} />
      <MentionPicker input={input} />
      <output>{input.markdown}</output>
    </>
  );
}

async function write(text: string): Promise<HTMLElement> {
  render(
    <I18nextProvider i18n={i18n}>
      <Harness />
    </I18nextProvider>,
  );
  const editor = await screen.findByRole("combobox", { name: "Message" });
  act(() => {
    input?.editor?.commands.insertContent(text);
  });
  return editor;
}

beforeEach(() => {
  input = null;
  onSend.mockClear();
  const rect = {
    top: 500,
    bottom: 520,
    left: 20,
    right: 30,
    width: 10,
    height: 20,
    x: 20,
    y: 500,
    toJSON: () => ({}),
  };
  Range.prototype.getBoundingClientRect = () => rect;
  Range.prototype.getClientRects = () =>
    Object.assign([rect], {
      item: (index: number) => (index === 0 ? rect : null),
    });
});

it("offers aliases before members, groups alternate everyone spellings and disables outsiders", () => {
  const choices = mentionChoices(directory, memberIds);
  expect(choices.map((entry) => entry.username)).toEqual([
    "alle",
    "a-team",
    "ed",
    "bakuman",
    "pica",
  ]);
  expect(choices[0]).toMatchObject({ alternatives: ["all", "team"], count: 2 });
  expect(choices.at(-1)).toMatchObject({
    section: "outside",
    isSelectable: false,
  });
  expect(
    filterMentionChoices(choices, "all").map((entry) => entry.username),
  ).toEqual(["alle"]);
  expect(activeMention("email@team")).toBeNull();
  expect(activeMention("Hi @ba")).toEqual({ query: "ba", length: 3 });
});

it("uses arrows and Tab to insert an atomic mention without sending and keeps its plain Markdown", async () => {
  const editor = await write("@");
  expect(screen.getByRole("listbox")).toBeTruthy();
  expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe(
    "true",
  );
  expect(
    screen.getAllByRole("option").at(-1)?.getAttribute("aria-disabled"),
  ).toBe("true");
  fireEvent.keyDown(editor, { key: "ArrowUp" });
  expect(
    screen
      .getByRole("option", { name: /Bakuman/u })
      .getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.keyDown(editor, { key: "ArrowDown" });
  expect(screen.getAllByRole("option")[0].getAttribute("aria-selected")).toBe(
    "true",
  );
  fireEvent.click(screen.getByRole("option", { name: /Pica/u }));
  expect(screen.getByRole("listbox")).toBeTruthy();
  fireEvent.keyDown(editor, { key: "ArrowDown" });
  fireEvent.keyDown(editor, { key: "Tab" });
  await waitFor(() =>
    expect(
      editor.querySelector("[data-chat-mention='a-team']")?.textContent,
    ).toBe("@a-team"),
  );
  expect(
    editor
      .querySelector("[data-chat-mention]")
      ?.getAttribute("contenteditable"),
  ).toBe("false");
  expect(screen.getByRole("status").textContent).toBe("@a-team");
  expect(onSend).not.toHaveBeenCalled();
  act(() => {
    const end = input?.editor?.state.selection.from;
    if (end) input?.editor?.commands.setTextSelection(end - 1);
  });
  fireEvent.keyDown(editor, { key: "Backspace" });
  expect(editor.querySelector("[data-chat-mention]")).toBeNull();
});

it("inserts a filtered member by mouse and Enter while Escape and no-match space close the picker", async () => {
  const editor = await write("Please @ba");
  const option = screen.getByRole("option");
  expect(option.querySelector("strong")?.textContent).toBe("Ba");
  fireEvent.mouseDown(option);
  fireEvent.click(option);
  expect(editor.textContent).toContain("Please @bakuman");
  expect(screen.queryByRole("listbox")).toBeNull();
  act(() => input?.setMarkdown(""));
  act(() => {
    input?.editor?.commands.insertContent("@ed");
  });
  fireEvent.keyDown(editor, { key: "Enter" });
  expect(editor.querySelector("[data-chat-mention='ed']")).toBeTruthy();
  expect(onSend).not.toHaveBeenCalled();
  act(() => input?.setMarkdown(""));
  act(() => {
    input?.editor?.commands.insertContent("@nobody");
  });
  expect(screen.getByText("Nobody matches “@nobody”.")).toBeTruthy();
  fireEvent.keyDown(editor, { key: " " });
  expect(screen.queryByRole("listbox")).toBeNull();
  act(() => input?.setMarkdown(""));
  act(() => {
    input?.editor?.commands.insertContent("@");
  });
  fireEvent.keyDown(editor, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("marks mentions without changing code, email, links, punctuation or raw HTML", () => {
  const { container } = render(
    <MentionDirectoryContext value={directory}>
      <MentionMarkdown
        source={
          "Hello @igor, @bakuman. @alle `@ed` [@ed](https://example.test) mail@ed <img src=x onerror=alert(1)>"
        }
      />
    </MentionDirectoryContext>,
  );
  const marks = [...container.querySelectorAll("mark")];
  expect(marks.map((mark) => mark.textContent)).toEqual([
    "@igor",
    "@bakuman",
    "@alle",
  ]);
  expect(marks[0].getAttribute("data-own-mention")).toBe("true");
  expect(marks[0].className).toContain("text-primary-foreground");
  expect(marks[1].className).toContain("bg-primary-subtle");
  expect(container.textContent).toContain("@bakuman.");
  expect(container.querySelector("img")).toBeNull();
});

it("marks a message mentioning the viewer with the primary left stripe", () => {
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <MentionDirectoryContext value={directory}>
        <ChatPageHistory
          name="Team"
          findParticipant={() => undefined}
          messages={[
            {
              id: "answer",
              authorId: "ed",
              author: { name: "Ed", kind: "agent", color: null },
              content: "@igor please review.",
              mentions: ["igor"],
              toolUses: [],
            },
          ]}
        />
      </MentionDirectoryContext>
    </I18nextProvider>,
  );
  const article = container.querySelector("article");
  expect(article?.getAttribute("data-own-mention")).toBe("true");
  expect(article?.className).toContain("border-l-[3px]");
  expect(article?.querySelector("mark")?.getAttribute("data-own-mention")).toBe(
    "true",
  );
});

it.each(["ready", "noModel", "modelUnavailable"] as const)(
  "shows %s model health and the last fallback in a group",
  async (status) => {
    const { ChatDecisionHealth } =
      await import("@/app/components/chat-page/mentions/chat-decision-health");
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <ChatDecisionHealth
          status={status}
          opened={{
            kind: "group",
            group: {
              id: "group",
              name: "Team",
              description: "",
              memberIds,
              unreadCount: 0,
              lastActivityAt: "today",
            },
            members: [],
          }}
          messages={[
            {
              id: "message",
              authorId: null,
              content: "Question",
              toolUses: [],
              decision: {
                messageId: "message",
                outcome: "unavailable",
                fallback: "model_failed",
                responders: [],
                answerProbability: null,
                choices: [],
                model: null,
              },
            },
          ]}
        />
      </I18nextProvider>,
    );
    const health = container.querySelector("[data-chat-decision-status]");
    expect(health?.getAttribute("data-chat-decision-status")).toBe(status);
    expect(health?.textContent).toContain(
      i18n.t(`chatPage.decisionHealth.${status}`),
    );
    expect(health?.textContent).toContain(
      i18n.t("chatPage.decision.fallbacks.model_failed"),
    );
  },
);

it("shows the decision probabilities and model in its expandable explanation", async () => {
  const { ChatPageDecision } =
    await import("@/app/components/chat-page/chat-page-decision");
  const { container } = render(
    <I18nextProvider i18n={i18n}>
      <ChatPageDecision
        decision={{
          messageId: "message",
          outcome: "responders",
          fallback: "none",
          responders: [{ id: "ed", name: "Ed" }],
          answerProbability: 0.82,
          choices: [{ agentId: "ed", name: "Ed", probability: 0.78 }],
          model: "decision-model",
        }}
      />
    </I18nextProvider>,
  );
  expect(container.querySelector("details")?.hasAttribute("open")).toBe(false);
  expect(container.querySelector("details")?.textContent).toContain("82 %");
  expect(container.querySelector("details")?.textContent).toContain("Ed 78 %");
  expect(container.querySelector("details")?.textContent).toContain(
    "decision-model",
  );
});
