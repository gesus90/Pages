// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/app/lib/text-assistant-client", async (original) => ({
  ...(await original<typeof import("@/app/lib/text-assistant-client")>()),
  assistantApi: api,
}));

import { AssistantClientError } from "@/app/lib/text-assistant-client";
import { useAssistantRun } from "@/app/components/assistant/use-assistant-run";
import { useAssistantHistory } from "@/app/components/assistant/use-assistant-history";
import { useTextAssistant } from "@/app/components/assistant/use-text-assistant";
import { assistantRequest } from "../helpers/text-assistant";
import type { BlockEditorHandle } from "@/app/components/editor/block-editor-types";
import type {
  TextAssistantContext,
  TextAssistantRequest,
} from "@/definition/TextAssistant";

const context: TextAssistantContext = {
  kind: "wiki",
  id: "page",
  version: "1",
};
const target = {
  from: 1,
  to: 4,
  selectionMarkdown: "Chosen",
  documentMarkdown: "Full document",
};
const history = {
  ok: true,
  conversations: [{ id: "c", lastMessageAt: "now" }],
  preferences: { autoApply: false, targetLanguage: "en" },
};
const messages = {
  ok: true,
  messages: [
    {
      id: "m",
      text: "Saved",
      role: "assistant",
      change: "answer",
      createdAt: "now",
    },
  ],
};
function output(request: TextAssistantRequest) {
  return {
    ok: true,
    result: {
      requestId: request.requestId,
      conversationId: "c",
      context: request.context,
      text: "New text",
      change: request.change,
    },
  };
}
function handle() {
  return {
    current: {
      getMarkdown: vi.fn().mockReturnValue(target.documentMarkdown),
      replaceMarkdown: vi.fn(),
      focusStart: vi.fn(),
      element: document.createElement("div"),
      captureAssistantTarget: vi.fn().mockReturnValue(target),
      applyAssistantText: vi.fn().mockReturnValue(true),
    } satisfies BlockEditorHandle,
  };
}
function deferred() {
  let resolve: (value: unknown) => void = () => undefined;
  const promise = new Promise<unknown>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function openRun() {
  const editor = handle();
  const complete = vi.fn().mockResolvedValue(undefined);
  const hook = renderHook(
    ({ selected }) =>
      useAssistantRun({
        context: selected,
        handle: editor,
        maximumLength: 100,
        onComplete: complete,
      }),
    { initialProps: { selected: context } },
  );
  return { ...hook, editor, complete };
}

describe("text request lifecycle", () => {
  it("previews without editing, validates before apply, supports discard and auto-apply", async () => {
    const { result, editor, complete } = openRun();
    const request = assistantRequest();
    api.mockResolvedValueOnce(output(request)).mockResolvedValue({ ok: true });
    await act(async () => {
      await result.current.apply();
      await result.current.cancel();
      await result.current.send({ request, target, autoApply: false });
    });
    expect(result.current.proposal?.result.text).toBe("New text");
    expect(editor.current.applyAssistantText).not.toHaveBeenCalled();
    expect(complete).toHaveBeenCalledWith("c");
    await act(async () => {
      await result.current.apply();
    });
    expect(editor.current.applyAssistantText).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "selection",
        kind: "replace",
        maximumLength: 100,
      }),
    );
    expect(result.current.isApplied).toBe(true);
    api.mockResolvedValueOnce(output(request));
    await act(async () => {
      await result.current.send({ request, target, autoApply: true });
    });
    expect(editor.current.applyAssistantText).toHaveBeenCalledTimes(2);
    api.mockResolvedValueOnce(output(request));
    await act(async () => {
      await result.current.send({ request, target, autoApply: false });
      result.current.discard();
    });
    expect(result.current.proposal).toBeNull();
  });

  it("never auto-applies answers and exposes safe provider/server/draft failures", async () => {
    const { result, editor } = openRun();
    const request = assistantRequest({ change: "answer", action: "explain" });
    api.mockResolvedValueOnce(output(request));
    await act(async () => {
      await result.current.send({ request, target, autoApply: true });
    });
    expect(editor.current.applyAssistantText).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.apply();
    });
    expect(result.current.error).toBe("versionConflict");
    api.mockRejectedValueOnce(new Error("private diagnostic"));
    await act(async () => {
      await result.current.send({ request, target, autoApply: true });
    });
    expect(result.current.error).toBe("providerFailed");
    const replacement = assistantRequest();
    api.mockResolvedValueOnce(output(replacement));
    await act(async () => {
      await result.current.send({
        request: replacement,
        target,
        autoApply: false,
      });
    });
    editor.current.getMarkdown.mockReturnValueOnce("Changed draft");
    await act(async () => {
      await result.current.apply();
    });
    expect(result.current.error).toBe("versionConflict");
    api.mockRejectedValueOnce(new AssistantClientError("accessDenied"));
    await act(async () => {
      await result.current.apply();
    });
    expect(result.current.error).toBe("accessDenied");
    api.mockResolvedValueOnce({ ok: true });
    editor.current.applyAssistantText.mockReturnValueOnce(false);
    await act(async () => {
      await result.current.apply();
    });
    expect(result.current.error).toBe("versionConflict");
  });

  it("rejects mismatched envelopes, allows only one pending request and owns cancellation", async () => {
    const { result } = openRun();
    const request = assistantRequest();
    for (const response of [
      { ...output(request).result, requestId: "wrong" },
      { ...output(request).result, context: { ...context, id: "other" } },
      { ...output(request).result, context: { ...context, kind: "ticket" } },
      { ...output(request).result, context: { ...context, version: "0" } },
      { ...output(request).result, change: "insert" },
    ]) {
      api.mockResolvedValueOnce({ ok: true, result: response });
      await act(async () => {
        await result.current.send({ request, target, autoApply: false });
      });
      expect(result.current.error).toBe("invalidOutput");
    }
    const delay = deferred();
    api.mockReturnValueOnce(delay.promise).mockResolvedValueOnce({ ok: true });
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.send({ request, target, autoApply: false });
    });
    await act(async () => {
      await result.current.send({ request, target, autoApply: false });
      await result.current.cancel();
    });
    expect(result.current.error).toBe("cancelled");
    await act(async () => {
      delay.resolve(output(request));
      await pending;
    });
    expect(result.current.proposal).toBeNull();
    const next = deferred();
    api
      .mockReturnValueOnce(next.promise)
      .mockRejectedValueOnce(new Error("cancel network failed"));
    act(() => {
      pending = result.current.send({ request, target, autoApply: false });
    });
    await act(async () => {
      await result.current.cancel();
    });
    expect(result.current.error).toBe("providerFailed");
    await act(async () => {
      next.resolve(output(request));
      await pending;
    });
  });

  it("cancels on context switch/unmount and guards context changes during validation", async () => {
    const hook = openRun();
    const request = assistantRequest();
    const delay = deferred();
    api.mockReturnValueOnce(delay.promise).mockResolvedValue({ ok: true });
    let pending = Promise.resolve();
    act(() => {
      pending = hook.result.current.send({ request, target, autoApply: true });
    });
    hook.rerender({ selected: { ...context, id: "other" } });
    await act(async () => {
      delay.resolve(output(request));
      await pending;
    });
    expect(hook.result.current.proposal).toBeNull();
    expect(hook.editor.current.applyAssistantText).not.toHaveBeenCalled();
    hook.rerender({ selected: context });
    api.mockResolvedValueOnce(output(request));
    await act(async () => {
      await hook.result.current.send({ request, target, autoApply: false });
    });
    const validation = deferred();
    api.mockReturnValueOnce(validation.promise);
    act(() => {
      pending = hook.result.current.apply();
    });
    hook.rerender({ selected: { ...context, id: "other" } });
    await act(async () => {
      validation.resolve({ ok: true });
      await pending;
    });
    expect(hook.editor.current.applyAssistantText).not.toHaveBeenCalled();
    hook.rerender({ selected: context });
    const last = deferred();
    api
      .mockReturnValueOnce(last.promise)
      .mockRejectedValueOnce(new Error("cancel unavailable"));
    act(() => {
      pending = hook.result.current.send({ request, target, autoApply: false });
    });
    hook.unmount();
    last.resolve(output(request));
    await pending;
  });
});

describe("private chat history lifecycle", () => {
  it("loads only on explicit opening, selects, refreshes, configures and deletes own history", async () => {
    api.mockResolvedValue(history);
    const { result, rerender } = renderHook(
      ({ open }) => useAssistantHistory(context, open),
      { initialProps: { open: false } },
    );
    expect(api).not.toHaveBeenCalled();
    rerender({ open: true });
    await waitFor(() => expect(result.current.conversations).toHaveLength(1));
    expect(result.current.preferences).toEqual(history.preferences);
    api.mockResolvedValueOnce(messages);
    await act(async () => {
      await result.current.select("c");
    });
    expect(result.current.messages).toHaveLength(1);
    api.mockResolvedValueOnce(messages).mockResolvedValueOnce(history);
    await act(async () => {
      await result.current.refresh("c");
    });
    api.mockResolvedValueOnce({ ok: true });
    await act(async () => {
      await result.current.configure({ autoApply: true, targetLanguage: "fr" });
    });
    expect(result.current.preferences.autoApply).toBe(true);
    await act(async () => {
      await result.current.remove();
      await result.current.remove();
    });
    expect(result.current.conversationId).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it("keeps late selections/context loads out of the new context and maps failures", async () => {
    api.mockResolvedValue(history);
    const hook = renderHook(
      ({ selected }) => useAssistantHistory(selected, true),
      { initialProps: { selected: context } },
    );
    await waitFor(() =>
      expect(hook.result.current.conversations).toHaveLength(1),
    );
    const delay = deferred();
    api.mockReturnValueOnce(delay.promise);
    let pending = Promise.resolve();
    act(() => {
      pending = hook.result.current.select("c");
    });
    await act(async () => {
      await hook.result.current.select(null);
      delay.resolve(messages);
      await pending;
    });
    expect(hook.result.current.messages).toEqual([]);
    const old = deferred();
    api.mockReturnValueOnce(old.promise);
    act(() => {
      pending = hook.result.current.refresh("c");
    });
    hook.rerender({ selected: { kind: "ticket", id: "ticket", version: "" } });
    await act(async () => {
      old.resolve(messages);
      await pending;
    });
    expect(hook.result.current.messages).toEqual([]);
    api.mockRejectedValue(new AssistantClientError("conversationMissing"));
    await act(async () => {
      await hook.result.current.select("c");
      await hook.result.current.refresh("c");
      await hook.result.current.remove();
      await hook.result.current.configure({
        autoApply: true,
        targetLanguage: "en",
      });
    });
    expect(hook.result.current.error).toBe("conversationMissing");
    hook.rerender({ selected: context });
    await waitFor(() =>
      expect(hook.result.current.error).toBe("conversationMissing"),
    );
    const loading = deferred();
    api.mockReturnValueOnce(loading.promise);
    hook.rerender({ selected: { ...context, id: "third" } });
    hook.unmount();
    loading.resolve(history);
  });

  it("uses default preferences for malformed metadata and ignores rejected aborted loads", async () => {
    api.mockResolvedValue({ ...history, preferences: {} });
    const hook = renderHook(() => useAssistantHistory(context, true));
    await waitFor(() =>
      expect(hook.result.current.conversations).toHaveLength(1),
    );
    expect(hook.result.current.preferences.targetLanguage).toBe("de");
    hook.unmount();
    const delay = deferred();
    api.mockReturnValueOnce(delay.promise);
    const second = renderHook(() => useAssistantHistory(context, true));
    second.unmount();
    delay.resolve(history);
  });
});

describe("assistant editor entry points", () => {
  it("opens menus without generation, sends only chosen context and saves preferences explicitly", async () => {
    const editor = handle();
    api.mockResolvedValue(history);
    const hook = renderHook(() =>
      useTextAssistant({
        context,
        title: "Page",
        handle: editor,
        content: "Full document",
        canEdit: true,
        canSend: true,
        maximumLength: 100,
      }),
    );
    act(() => hook.result.current.editorFeature.open("translate"));
    await waitFor(() =>
      expect(hook.result.current.panel.form.targetLanguage).toBe("en"),
    );
    expect(api.mock.calls.every(([input]) => input.intent === "history")).toBe(
      true,
    );
    act(() =>
      hook.result.current.panel.onFormChange({
        ...hook.result.current.panel.form,
        targetLanguage: "fr",
      }),
    );
    expect(hook.result.current.panel.form.targetLanguage).toBe("fr");
    api.mockImplementation(async (input) =>
      input.intent === "run"
        ? output(input.request)
        : input.intent === "messages"
          ? messages
          : input.intent === "history"
            ? history
            : { ok: true },
    );
    act(() =>
      hook.result.current.panel.onFormChange(
        { ...hook.result.current.panel.form, autoApply: true },
        true,
      ),
    );
    await waitFor(() =>
      expect(hook.result.current.panel.history.preferences.autoApply).toBe(
        true,
      ),
    );
    act(() => hook.result.current.panel.onSend());
    await waitFor(() =>
      expect(hook.result.current.panel.run.isApplied).toBe(true),
    );
    const sent = api.mock.calls.find(([input]) => input.intent === "run")?.[0]
      .request;
    expect(sent).toMatchObject({
      scope: "selection",
      source: "Chosen",
      action: "translate",
      targetLanguage: "fr",
    });
    expect(JSON.stringify(sent)).not.toContain("Full document");
    act(() => hook.result.current.panel.onToggle());
    expect(hook.result.current.panel.isOpen).toBe(false);
    act(() => hook.result.current.editorFeature.open("generate"));
    expect(hook.result.current.panel.form).toMatchObject({
      scope: "none",
      change: "insert",
    });
    act(() => hook.result.current.editorFeature.open("summarize"));
    expect(hook.result.current.panel.form.change).toBe("answer");
    act(() =>
      hook.result.current.panel.onFormChange({
        ...hook.result.current.panel.form,
        scope: "document",
      }),
    );
    act(() => hook.result.current.panel.onSend());
    await waitFor(() =>
      expect(
        api.mock.calls.filter(([input]) => input.intent === "run"),
      ).toHaveLength(2),
    );
    expect(
      api.mock.calls.filter(([input]) => input.intent === "run")[1][0].request
        .source,
    ).toBe("Full document");
  });

  it("captures browser selection only inside the explicit reader element", () => {
    api.mockResolvedValue(history);
    const element = document.createElement("div");
    element.textContent = "Selected reader text";
    document.body.append(element);
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const hook = renderHook(() =>
      useTextAssistant({
        context,
        title: "Page",
        handle: { current: null },
        content: "Reader document",
        canEdit: false,
        canSend: true,
        maximumLength: 100,
        selectionElement: element,
      }),
    );
    act(() => hook.result.current.panel.onToggle());
    expect(hook.result.current.panel.isOpen).toBe(true);
    act(() => hook.result.current.editorFeature.open("explain"));
    expect(hook.result.current.panel.form.change).toBe("answer");
    selection?.removeAllRanges();
    act(() => hook.result.current.editorFeature.open("instruct"));
    expect(hook.result.current.panel.form.change).toBe("replace");
  });
});

describe("late history responses never cross contexts", () => {
  function pendingApi() {
    let resolve: (value: unknown) => void = () => undefined;
    let reject: (failure: Error) => void = () => undefined;
    const promise = new Promise<unknown>((accept, fail) => {
      resolve = accept;
      reject = fail;
    });
    return { promise, resolve, reject };
  }
  function openHistory() {
    api.mockResolvedValue(history);
    return renderHook(
      ({ selected, open }) => useAssistantHistory(selected, open),
      { initialProps: { selected: context, open: true } },
    );
  }

  it("ignores rejected loads after closure and rejected selections after a context switch", async () => {
    const load = pendingApi();
    api.mockReturnValueOnce(load.promise);
    const hook = renderHook(({ open }) => useAssistantHistory(context, open), {
      initialProps: { open: true },
    });
    hook.rerender({ open: false });
    await act(async () => {
      load.reject(new Error("aborted loading"));
    });
    expect(hook.result.current.error).toBe("");
    const second = openHistory();
    await waitFor(() =>
      expect(second.result.current.conversations).toHaveLength(1),
    );
    const delayed = pendingApi();
    api.mockReturnValueOnce(delayed.promise);
    let pending = Promise.resolve();
    const previousRefresh = second.result.current.refresh;
    act(() => {
      pending = second.result.current.select("c");
    });
    second.rerender({ selected: { ...context, id: "other" }, open: true });
    await act(async () => {
      delayed.reject(new Error("old selection"));
      await pending;
      await previousRefresh("c");
    });
    expect(second.result.current.error).toBe("");
  });

  it("ignores both resolved and rejected stale refreshes", async () => {
    for (const rejected of [false, true]) {
      const hook = openHistory();
      await waitFor(() =>
        expect(hook.result.current.conversations).toHaveLength(1),
      );
      const delayed = pendingApi();
      api.mockResolvedValueOnce(messages).mockReturnValueOnce(delayed.promise);
      let pending = Promise.resolve();
      act(() => {
        pending = hook.result.current.refresh("c");
      });
      await waitFor(() =>
        expect(
          api.mock.results.some((entry) => entry.value === delayed.promise),
        ).toBe(true),
      );
      hook.rerender({ selected: { ...context, id: "other" }, open: true });
      await act(async () => {
        if (rejected) delayed.reject(new Error("old refresh"));
        else delayed.resolve(history);
        await pending;
      });
      expect(hook.result.current.error).toBe("");
      hook.unmount();
    }
  });

  it("deletion cannot clear a newly selected conversation, and old deletions cannot affect a new context", async () => {
    const hook = openHistory();
    await waitFor(() =>
      expect(hook.result.current.conversations).toHaveLength(1),
    );
    api.mockResolvedValueOnce(messages);
    await act(async () => {
      await hook.result.current.select("c");
    });
    const deletion = pendingApi();
    api.mockReturnValueOnce(deletion.promise).mockResolvedValueOnce(messages);
    let pending = Promise.resolve();
    act(() => {
      pending = hook.result.current.remove();
    });
    await act(async () => {
      await hook.result.current.select("next");
      deletion.resolve({ ok: true });
      await pending;
    });
    expect(hook.result.current.conversationId).toBe("next");
    for (const rejected of [false, true]) {
      const old = pendingApi();
      api.mockReturnValueOnce(old.promise);
      act(() => {
        pending = hook.result.current.remove();
      });
      hook.rerender({
        selected: { ...context, id: rejected ? "third" : "second" },
        open: true,
      });
      await act(async () => {
        if (rejected) old.reject(new Error("old deletion"));
        else old.resolve({ ok: true });
        await pending;
      });
      expect(hook.result.current.error).toBe("");
      api.mockResolvedValueOnce(messages);
      await act(async () => {
        await hook.result.current.select("c");
      });
    }
    const oldPreference = pendingApi();
    api.mockReturnValueOnce(oldPreference.promise);
    act(() => {
      pending = hook.result.current.configure({
        autoApply: true,
        targetLanguage: "en",
      });
    });
    hook.rerender({ selected: context, open: true });
    await act(async () => {
      oldPreference.reject(new Error("old preference"));
      await pending;
    });
    expect(hook.result.current.error).toBe("");
  });

  it("keeps abort errors and validation/cancellation failures out of a new run context", async () => {
    const hook = openRun();
    const request = assistantRequest();
    const run = pendingApi();
    api.mockReturnValueOnce(run.promise).mockResolvedValue({ ok: true });
    let pending = Promise.resolve();
    act(() => {
      pending = hook.result.current.send({ request, target, autoApply: false });
    });
    await act(async () => {
      await hook.result.current.cancel();
      run.reject(new Error("aborted browser fetch"));
      await pending;
    });
    expect(hook.result.current.error).toBe("cancelled");
    const cancelled = pendingApi();
    const generated = pendingApi();
    api
      .mockReturnValueOnce(generated.promise)
      .mockReturnValueOnce(cancelled.promise);
    act(() => {
      pending = hook.result.current.send({ request, target, autoApply: false });
    });
    let cancel = Promise.resolve();
    act(() => {
      cancel = hook.result.current.cancel();
    });
    hook.rerender({ selected: { ...context, id: "other" } });
    await act(async () => {
      cancelled.reject(new Error("old cancel"));
      generated.resolve(output(request));
      await pending;
      await cancel;
    });
    expect(hook.result.current.error).toBe("");
  });

  it("saves a completed language edit and captures an empty reader selection safely", async () => {
    api.mockResolvedValue(history);
    const editor = handle();
    const hook = renderHook(() =>
      useTextAssistant({
        context,
        title: "Page",
        handle: editor,
        content: "Full document",
        canEdit: true,
        canSend: true,
        maximumLength: 100,
      }),
    );
    act(() => hook.result.current.panel.onToggle());
    await waitFor(() =>
      expect(hook.result.current.panel.form.targetLanguage).toBe("en"),
    );
    api.mockResolvedValue({ ok: true });
    act(() =>
      hook.result.current.panel.onFormChange(
        { ...hook.result.current.panel.form, targetLanguage: "fr" },
        true,
      ),
    );
    await waitFor(() =>
      expect(hook.result.current.panel.history.preferences.targetLanguage).toBe(
        "fr",
      ),
    );
    window.getSelection()?.removeAllRanges();
  });
});

it("uses the ticket's existing UTF-16 limit when applying text", async () => {
  const hook = openRun();
  const selected: TextAssistantContext = {
    kind: "ticket",
    id: "ticket",
    version: "",
  };
  hook.rerender({ selected });
  const request = assistantRequest({ context: selected });
  api.mockResolvedValueOnce(output(request)).mockResolvedValue({ ok: true });
  await act(async () => {
    await hook.result.current.send({ request, target, autoApply: true });
  });
  expect(hook.editor.current.applyAssistantText).toHaveBeenCalledWith(
    expect.objectContaining({ lengthUnit: "codeUnit" }),
  );
});
