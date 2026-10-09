import { useEffect, useState } from "react";

import { useAssistantHistory } from "./use-assistant-history";
import { useAssistantRun } from "./use-assistant-run";

import type {
  AssistantEditorTarget,
  BlockEditorHandle,
  EditorTextAssistant,
} from "@/app/components/editor/block-editor-types";
import type {
  TextAssistantContext,
  TextAssistantRequest,
} from "@/definition/TextAssistant";
import type { AssistantPanelProps } from "./assistant-panel";
import type { AssistantFormState } from "./assistant-form";

interface TextAssistantOptions {
  readonly context: TextAssistantContext;
  readonly title: string;
  readonly handle: React.RefObject<BlockEditorHandle | null>;
  readonly content: string;
  readonly canEdit: boolean;
  readonly canSend: boolean;
  readonly maximumLength: number;
  readonly selectionElement?: HTMLElement | null;
}

function defaultAssistantChange(
  action: AssistantFormState["action"],
): AssistantFormState["change"] {
  if (["chat", "summarize", "explain"].includes(action)) return "answer";
  return action === "generate" ? "insert" : "replace";
}

function createRequest(
  form: AssistantFormState,
  context: TextAssistantContext,
  selected: AssistantEditorTarget,
  conversationId: string | null,
): TextAssistantRequest {
  const sources = {
    none: "",
    selection: selected.selectionMarkdown,
    document: selected.documentMarkdown,
  };
  return {
    requestId: crypto.randomUUID(),
    conversationId,
    context: { ...context },
    action: form.action,
    scope: form.scope,
    change: form.change,
    source: sources[form.scope],
    instruction: form.instruction,
    targetLanguage: form.targetLanguage,
  };
}

function capture(options: TextAssistantOptions): AssistantEditorTarget {
  const selection =
    typeof window === "undefined" ? null : window.getSelection();
  const element = options.selectionElement;
  const passage =
    selection &&
    element &&
    element.contains(selection.anchorNode) &&
    element.contains(selection.focusNode)
      ? selection.toString()
      : "";
  return (
    options.handle.current?.captureAssistantTarget?.() ?? {
      from: 0,
      to: 0,
      documentMarkdown: options.content,
      selectionMarkdown: passage,
    }
  );
}

/** Shared state plugs into editor menus and the permanently available agent button. */
export function useTextAssistant(options: TextAssistantOptions): {
  readonly editorFeature: EditorTextAssistant;
  readonly panel: AssistantPanelProps;
} {
  const [isOpen, setIsOpen] = useState(false);
  const [target, setTarget] = useState<AssistantEditorTarget | null>(null);
  const [form, setForm] = useState<AssistantFormState>({
    action: "chat",
    scope: "none",
    change: "answer",
    instruction: "",
    targetLanguage: "de",
    autoApply: false,
  });
  const kind = options.context.kind;
  const id = options.context.id;
  useEffect(() => {
    setIsOpen(false);
    setTarget(null);
    setForm((current) => ({
      ...current,
      action: "chat",
      scope: "none",
      change: "answer",
      instruction: "",
    }));
  }, [kind, id]);
  const history = useAssistantHistory(options.context, isOpen);
  const run = useAssistantRun({
    context: options.context,
    handle: options.handle,
    maximumLength: options.maximumLength,
    onComplete: history.refresh,
  });

  useEffect(() => {
    setForm((current) => ({ ...current, ...history.preferences }));
  }, [history.preferences]);

  function open(action?: Parameters<EditorTextAssistant["open"]>[0]): void {
    setTarget(capture(options));
    if (action)
      setForm((current) => ({
        ...current,
        action,
        scope: action === "generate" ? "none" : "selection",
        change: defaultAssistantChange(action),
      }));
    setIsOpen(true);
  }

  function changeForm(next: AssistantFormState, savePreferences = false): void {
    setForm(next);
    if (
      savePreferences &&
      (next.autoApply !== form.autoApply ||
        next.targetLanguage !== history.preferences.targetLanguage)
    )
      void history.configure({
        autoApply: next.autoApply,
        targetLanguage: next.targetLanguage,
      });
  }

  function send(): void {
    const selected =
      form.scope === "selection" && target ? target : capture(options);
    const request = createRequest(
      form,
      options.context,
      selected,
      history.conversationId,
    );
    void run.send({
      request,
      target: selected,
      autoApply: history.preferences.autoApply,
    });
  }

  return {
    editorFeature: { open },
    panel: {
      isOpen,
      title: options.title,
      canWrite: options.canEdit,
      canSend: options.canSend,
      form,
      history,
      run,
      onFormChange: changeForm,
      onSend: send,
      onToggle: () => {
        if (isOpen) setIsOpen(false);
        else open();
      },
    },
  };
}
