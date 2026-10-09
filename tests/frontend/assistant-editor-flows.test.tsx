// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { AssistantPanel } from "@/app/components/assistant/assistant-panel";
import { useTextAssistant } from "@/app/components/assistant/use-text-assistant";
import { BlockEditor } from "@/app/components/editor/block-editor";
import { createI18n } from "@/app/lib/i18n";
import { readAgentObject } from "@/backend/agents/AgentPayload";

import { installEditorGeometry, pressKey, typeText } from "../helpers/editor";

import type { Editor } from "@tiptap/core";
import type { BlockEditorHandle } from "@/app/components/editor/block-editor-types";
import type { TextAssistantContext } from "@/definition/TextAssistant";
import type { Language } from "@/language/Language";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/text-assistant-client", async (original) => ({
  ...(await original<typeof import("@/app/lib/text-assistant-client")>()),
  assistantApi: api,
}));

const ORIGINAL = "Before **chosen**\n\nTail\n";
let autoApply = false;
let complete: ((response: Record<string, unknown>) => void) | null = null;
let shouldDelay = false;

function answer(
  input: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const request = readAgentObject(input.request);
  return {
    ok: true,
    result: {
      requestId: request.requestId,
      context: request.context,
      conversationId: "synthetic-conversation",
      change: request.change,
      text: "**Improved**",
    },
  };
}

function Story({
  context,
}: {
  readonly context: TextAssistantContext;
}): React.ReactElement {
  const handle = useRef<BlockEditorHandle | null>(null);
  const [content, setContent] = useState(ORIGINAL);
  const assistant = useTextAssistant({
    context,
    title: context.id,
    handle,
    content,
    canEdit: true,
    canSend: true,
    maximumLength: 1000,
  });
  const ready = useCallback((next: BlockEditorHandle | null): void => {
    handle.current = next;
  }, []);
  return (
    <>
      <BlockEditor
        key={context.id}
        label="Document"
        markdown={content}
        isEditable
        fallback={<p>{content}</p>}
        features={{
          isDisplayableImage: () => false,
          textAssistant: assistant.editorFeature,
        }}
        onReady={ready}
        onChange={setContent}
      />
      <AssistantPanel {...assistant.panel} />
    </>
  );
}

interface EditorElement extends HTMLElement {
  readonly editor: Editor;
}

async function openStory(
  language: Language,
  kind: TextAssistantContext["kind"],
) {
  const i18n = createI18n(language);
  const context = {
    kind,
    id: "document-one",
    version: kind === "wiki" ? "1" : ORIGINAL,
  };
  function view(selected: TextAssistantContext): React.ReactElement {
    return (
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <Story context={selected} />
        </MemoryRouter>
      </I18nextProvider>
    );
  }
  const rendered = render(view(context));
  const element = await screen.findByRole("textbox", { name: "Document" });
  const editor = (element as EditorElement).editor;
  act(() => {
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 8, to: 14 });
    pressKey(editor, "j", { mod: true });
  });
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: i18n.t("assistant.actions.proofread"),
    }),
  );
  return { ...rendered, editor, i18n, context, view };
}

beforeAll(installEditorGeometry);
beforeEach(() => {
  autoApply = false;
  shouldDelay = false;
  complete = null;
  api.mockImplementation(async (input: Readonly<Record<string, unknown>>) => {
    if (input.intent === "history")
      return {
        ok: true,
        conversations: [],
        preferences: { autoApply, targetLanguage: "en" },
      };
    if (input.intent === "messages") return { ok: true, messages: [] };
    if (input.intent !== "run") return { ok: true };
    if (!shouldDelay) return answer(input);
    return new Promise<Record<string, unknown>>((resolve) => {
      complete = resolve;
    });
  });
});

describe.each(["de", "en"] as const)(
  "%s real editor and assistant integration",
  (language) => {
    it("opens the same sidebar with its separate editor shortcut without generating", async () => {
      const { editor, i18n } = await openStory(language, "wiki");
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("assistant.close") }),
      );
      act(() => pressKey(editor, "j", { mod: true, alt: true, shift: true }));
      expect(await screen.findByRole("complementary")).toBeInTheDocument();
      expect(screen.queryByRole("menu")).toBeNull();
      expect(
        api.mock.calls.filter(
          ([input]) => readAgentObject(input).intent === "run",
        ),
      ).toHaveLength(0);
      expect(
        screen.getByRole("button", { name: i18n.t("assistant.toggle") }),
      ).toHaveAttribute(
        "aria-keyshortcuts",
        "Control+Alt+Shift+J Meta+Alt+Shift+J",
      );
    });

    it.each(["wiki", "ticket"] as const)(
      "%s previews, discards, applies and undoes only the chosen passage",
      async (kind) => {
        const { editor, i18n } = await openStory(language, kind);
        expect(
          api.mock.calls.filter(
            ([input]) => readAgentObject(input).intent === "run",
          ),
        ).toHaveLength(0);
        fireEvent.click(
          screen.getByRole("button", { name: i18n.t("assistant.send") }),
        );
        fireEvent.click(
          await screen.findByRole("button", {
            name: i18n.t("assistant.discard"),
          }),
        );
        expect(editor.getText()).toBe("Before chosen\n\nTail");
        fireEvent.click(
          screen.getByRole("button", { name: i18n.t("assistant.send") }),
        );
        fireEvent.click(
          await screen.findByRole("button", {
            name: i18n.t("assistant.apply"),
          }),
        );
        await waitFor(() =>
          expect(editor.getText()).toBe("Before Improved\n\nTail"),
        );
        expect(api).toHaveBeenCalledWith(
          expect.objectContaining({ intent: "validate" }),
        );
        act(() => pressKey(editor, "z", { mod: true }));
        expect(editor.getText()).toBe("Before chosen\n\nTail");
        act(() => pressKey(editor, "z", { mod: true, shift: true }));
        expect(editor.getText()).toBe("Before Improved\n\nTail");
        fireEvent.click(
          screen.getByRole("button", { name: i18n.t("assistant.close") }),
        );
        fireEvent.click(
          screen.getByRole("button", { name: i18n.t("assistant.toggle") }),
        );
        expect(screen.getByRole("complementary")).toBeInTheDocument();
        expect(editor.getText()).toBe("Before Improved\n\nTail");
      },
    );

    it("keeps newer typing on conflict and rejects a completion after cancellation", async () => {
      const { editor, i18n } = await openStory(language, "wiki");
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("assistant.send") }),
      );
      await screen.findByRole("button", { name: i18n.t("assistant.apply") });
      act(() => {
        editor.commands.focus("end");
        typeText(editor, " newer");
      });
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("assistant.apply") }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        i18n.t("assistant.error.versionConflict"),
      );
      expect(editor.getText()).toContain("Tail newer");
      shouldDelay = true;
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("assistant.send") }),
      );
      fireEvent.click(
        await screen.findByRole("button", { name: i18n.t("assistant.cancel") }),
      );
      expect(await screen.findByRole("alert")).toHaveTextContent(
        i18n.t("assistant.error.cancelled"),
      );
      await act(async () => {
        complete?.({ ok: false });
      });
      expect(
        screen.queryByRole("button", { name: i18n.t("assistant.apply") }),
      ).toBeNull();
      expect(editor.getText()).toContain("Tail newer");
    });

    it("auto-applies one undo transaction and clears the proposal when changing documents", async () => {
      autoApply = true;
      const { editor, i18n, rerender, view, context } = await openStory(
        language,
        "ticket",
      );
      await waitFor(() => expect(screen.getByRole("checkbox")).toBeChecked());
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("assistant.send") }),
      );
      await waitFor(() =>
        expect(editor.getText()).toBe("Before Improved\n\nTail"),
      );
      act(() => pressKey(editor, "z", { mod: true }));
      expect(editor.getText()).toBe("Before chosen\n\nTail");
      shouldDelay = true;
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("assistant.send") }),
      );
      await screen.findByRole("button", { name: i18n.t("assistant.cancel") });
      rerender(view({ ...context, id: "document-two" }));
      await act(async () => {
        complete?.({ ok: false });
      });
      expect(screen.queryByRole("complementary")).toBeNull();
      expect(
        await screen.findByRole("textbox", { name: "Document" }),
      ).toHaveTextContent("Before chosen");
      expect(api).toHaveBeenCalledWith(
        expect.objectContaining({ intent: "cancel" }),
      );
    });
  },
);
