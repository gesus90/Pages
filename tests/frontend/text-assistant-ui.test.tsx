// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { flushSync } from "react-dom";
import { createRoutesStub } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";

import { AssistantPanel } from "@/app/components/assistant/assistant-panel";
import { TextAgentSettings } from "@/app/components/settings/agents/text-agent-settings";
import { createI18n } from "@/app/lib/i18n";
import { assistantRequest } from "../helpers/text-assistant";
import type { AssistantPanelProps } from "@/app/components/assistant/assistant-panel";

function panelProps(): AssistantPanelProps {
  const request = assistantRequest();
  return {
    isOpen: true,
    title: "Page",
    canWrite: true,
    canSend: true,
    form: {
      action: "chat",
      scope: "none",
      change: "answer",
      instruction: "",
      targetLanguage: "en",
      autoApply: false,
    },
    history: {
      conversations: [
        { id: "c", lastMessageAt: "now" },
        { id: "c2", lastMessageAt: "now" },
      ],
      conversationId: "c",
      messages: [
        {
          id: "1",
          role: "user",
          text: "Question",
          createdAt: "now",
          change: "answer",
        },
        {
          id: "2",
          role: "assistant",
          text: "**Response**\n\n<script>evil()</script>\n\n[bad](javascript:alert(1))\n\n![image](https://outside.invalid/tracker)",
          createdAt: "now",
          change: "insert",
        },
      ],
      preferences: { autoApply: false, targetLanguage: "en" },
      error: "",
      select: vi.fn().mockResolvedValue(undefined),
      refresh: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      configure: vi.fn().mockResolvedValue(undefined),
    },
    run: {
      isRunning: false,
      isApplied: false,
      proposal: {
        request,
        target: {
          from: 0,
          to: 1,
          selectionMarkdown: "Original",
          documentMarkdown: "Original",
        },
        result: {
          requestId: request.requestId,
          conversationId: "c",
          context: request.context,
          text: "**Changed**\n\n![blocked](https://outside.invalid/tracker)",
          change: "replace",
        },
      },
      error: "",
      send: vi.fn().mockResolvedValue(undefined),
      apply: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn(),
      cancel: vi.fn().mockResolvedValue(undefined),
    },
    onToggle: vi.fn(),
    onFormChange: vi.fn(),
    onSend: vi.fn(),
  };
}

async function choose(name: string, option: string): Promise<void> {
  const user = userEvent.setup();
  await user.click(screen.getByRole("combobox", { name }));
  await user.click(await screen.findByRole("option", { name: option }));
}
function renderPanel(props: AssistantPanelProps) {
  return render(
    <I18nextProvider i18n={createI18n("de")}>
      <AssistantPanel {...props} />
    </I18nextProvider>,
  );
}

describe("assistant sidebar and explicit action controls", () => {
  it.each(["de", "en"] as const)(
    "%s cancels without submitting again when the running button becomes send",
    async (language) => {
      const props = panelProps();
      const i18n = createI18n(language);

      function CancellationStory(): React.ReactElement {
        const [isRunning, setIsRunning] = useState(true);

        function cancel(): Promise<void> {
          flushSync(() => setIsRunning(false));
          return props.run.cancel();
        }

        return (
          <AssistantPanel
            {...props}
            run={{ ...props.run, isRunning, cancel }}
          />
        );
      }

      render(
        <I18nextProvider i18n={i18n}>
          <CancellationStory />
        </I18nextProvider>,
      );
      const user = userEvent.setup();
      await user.click(
        screen.getByRole("button", { name: i18n.t("assistant.cancel") }),
      );

      expect(props.run.cancel).toHaveBeenCalledTimes(1);
      expect(props.onSend).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole("button", { name: i18n.t("assistant.send") }),
      );
      expect(props.onSend).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the icon and sidebar above a mobile keyboard as its visible height changes", () => {
    const viewport = Object.assign(new EventTarget(), {
      height: window.innerHeight - 180,
      offsetTop: 0,
    });
    vi.stubGlobal("visualViewport", viewport);
    const view = renderPanel(panelProps());
    try {
      const icon = screen.getByRole("button", {
        name: "Textassistent öffnen/schließen",
      });
      const sidebar = screen.getByRole("complementary");
      expect(icon.style.getPropertyValue("--assistant-keyboard-inset")).toBe(
        "180px",
      );
      expect(sidebar.style.getPropertyValue("--assistant-keyboard-inset")).toBe(
        "180px",
      );
      act(() => {
        viewport.height = window.innerHeight - 300;
        viewport.dispatchEvent(new Event("resize"));
      });
      expect(icon.style.getPropertyValue("--assistant-keyboard-inset")).toBe(
        "300px",
      );
      expect(sidebar.style.getPropertyValue("--assistant-keyboard-inset")).toBe(
        "300px",
      );
    } finally {
      view.unmount();
      vi.unstubAllGlobals();
    }
  });

  it.each(["de", "en"] as const)(
    "%s disables applying an existing proposal after losing write permission",
    async (language) => {
      const props = panelProps();
      const i18n = createI18n(language);
      const view = render(
        <I18nextProvider i18n={i18n}>
          <AssistantPanel {...props} />
        </I18nextProvider>,
      );
      expect(
        screen.getByRole("button", { name: i18n.t("assistant.apply") }),
      ).toBeEnabled();
      view.rerender(
        <I18nextProvider i18n={i18n}>
          <AssistantPanel {...props} canWrite={false} />
        </I18nextProvider>,
      );
      const apply = screen.getByRole("button", {
        name: i18n.t("assistant.apply"),
      });
      expect(apply).toBeDisabled();
      await userEvent.click(apply);
      expect(props.run.apply).not.toHaveBeenCalled();
      expect(
        screen.getByRole("button", { name: i18n.t("assistant.discard") }),
      ).toBeEnabled();
    },
  );

  it("keeps the icon reachable, renders safe previews/history and dispatches only explicit clicks", async () => {
    const props = panelProps();
    const view = renderPanel(props);
    expect(
      screen.getByRole("button", { name: "Textassistent öffnen/schließen" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('a[href^="javascript:"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Übernehmen" }));
    expect(props.run.apply).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Verwerfen" }));
    expect(props.run.discard).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Neue Unterhaltung" }));
    expect(props.history.select).toHaveBeenCalledWith(null);
    await choose("Eigener Verlauf", "Unterhaltung 2");
    expect(props.history.select).toHaveBeenCalledWith("c2");
    await choose("Eigener Verlauf", "Neue Unterhaltung");
    expect(props.history.select).toHaveBeenCalledWith(null);
    fireEvent.click(
      screen.getByRole("button", { name: "Eigene Unterhaltung löschen" }),
    );
    expect(props.history.remove).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Senden" }));
    expect(props.onSend).toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Assistent schließen" }),
    );
    expect(props.onToggle).toHaveBeenCalled();
    view.rerender(
      <I18nextProvider i18n={createI18n("de")}>
        <AssistantPanel {...props} isOpen={false} />
      </I18nextProvider>,
    );
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Textassistent öffnen/schließen" }),
    );
    expect(props.onToggle).toHaveBeenCalledTimes(2);
  });

  it("chooses action/scope/write intent/language and persists preferences on explicit commits", async () => {
    const props = panelProps();
    function Story() {
      const [form, setForm] = useState(props.form);
      return (
        <AssistantPanel
          {...props}
          form={form}
          onFormChange={(next, save) => {
            props.onFormChange(next, save);
            setForm(next);
          }}
        />
      );
    }
    render(
      <I18nextProvider i18n={createI18n("de")}>
        <Story />
      </I18nextProvider>,
    );
    await choose("Gesendeter Kontext", "Fixierte Auswahl");
    await choose("Gewünschte Wirkung", "Gewählten Text ersetzen");
    await choose("Aktion", "Übersetzen");
    fireEvent.change(
      screen.getByLabelText("Zielsprache (Sprachcode, z. B. en)"),
      { target: { value: "fr" } },
    );
    fireEvent.blur(screen.getByLabelText("Zielsprache (Sprachcode, z. B. en)"));
    expect(props.onFormChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ targetLanguage: "fr" }),
      true,
    );
    fireEvent.change(screen.getByLabelText("Anweisung oder Frage"), {
      target: { value: "Preserve tone" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    expect(props.onFormChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        autoApply: true,
        instruction: "Preserve tone",
      }),
      true,
    );
    await choose("Aktion", "Generieren / ergänzen");
    expect(props.onFormChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ change: "insert" }),
      undefined,
    );
    await choose("Aktion", "Zusammenfassen");
    expect(props.onFormChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ change: "answer" }),
      undefined,
    );
  });

  it("shows cancellation/failures/applied states and respects write/save availability", () => {
    const props = panelProps();
    const view = renderPanel({
      ...props,
      canWrite: false,
      canSend: false,
      run: {
        ...props.run,
        isRunning: true,
        error: "cancelled",
        isApplied: true,
      },
      history: { ...props.history, conversationId: null },
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Anfrage abgebrochen");
    expect(screen.getAllByRole("status")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Eigene Unterhaltung löschen" }),
    ).toBeDisabled();
    expect(screen.getByRole("checkbox")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Anfrage abbrechen" }));
    expect(props.run.cancel).toHaveBeenCalled();
    view.rerender(
      <I18nextProvider i18n={createI18n("de")}>
        <AssistantPanel
          {...props}
          canWrite={false}
          canSend={false}
          form={{ ...props.form, action: "proofread", change: "replace" }}
          run={{ ...props.run, proposal: null }}
          history={{ ...props.history, error: "roleMissing" }}
        />
      </I18nextProvider>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "noch nicht zugewiesen",
    );
    expect(screen.getByRole("button", { name: "Senden" })).toBeDisabled();
    expect(screen.queryByLabelText("Textvorschlag")).toBeNull();
    view.rerender(
      <I18nextProvider i18n={createI18n("de")}>
        <AssistantPanel
          {...props}
          run={{
            ...props.run,
            proposal: props.run.proposal
              ? {
                  ...props.run.proposal,
                  result: { ...props.run.proposal.result, change: "answer" },
                }
              : null,
          }}
        />
      </I18nextProvider>,
    );
    expect(screen.queryByRole("button", { name: "Übernehmen" })).toBeNull();
  });
});

describe("independent chat retention settings", () => {
  it("saves retention without changing assignments, and shows pending/error/success states", async () => {
    let finish: (response: Response) => void = () => undefined;
    let submitted: FormData | undefined;
    const Stub = createRoutesStub([
      {
        path: "/settings/agents",
        Component: () => (
          <TextAgentSettings settings={{ role: null, retentionDays: 30 }} />
        ),
        action: async ({ request }) => {
          submitted = await request.formData();
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        },
      },
    ]);
    render(
      <I18nextProvider i18n={createI18n("de")}>
        <Stub initialEntries={["/settings/agents"]} />
      </I18nextProvider>,
    );
    const retention = screen.getByLabelText(
      "Chat-Aufbewahrung nach der letzten Nachricht (1–365 Tage)",
    );
    expect(retention).toHaveAttribute("max", "365");
    fireEvent.change(retention, { target: { value: "7" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Text-Einstellungen speichern" }),
    );
    await waitFor(() => expect(retention).toBeDisabled());
    await waitFor(() =>
      expect(submitted?.get("intent")).toBe("configure-retention"),
    );
    expect(submitted?.get("connectionId")).toBeNull();
    await act(async () =>
      finish(Response.json({ ok: false, error: "invalidInput" })),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Eingaben");
    fireEvent.click(
      screen.getByRole("button", { name: "Text-Einstellungen speichern" }),
    );
    await waitFor(() => expect(retention).toBeDisabled());
    await act(async () => finish(Response.json({ ok: true })));
    expect(await screen.findByRole("status")).toHaveTextContent("gespeichert");
  });
});
