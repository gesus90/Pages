import { Bot, X } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useKeyboardInset } from "@/app/components/editor/use-keyboard-inset";
import { Button } from "@/app/components/ui/button";
import { Select } from "@/app/components/ui/select";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { formatShortcut } from "@/app/lib/editor/editor-shortcuts";

import { AssistantForm } from "./assistant-form";

import type { AssistantFormState } from "./assistant-form";
import type { AssistantHistoryState } from "./use-assistant-history";
import type { AssistantRunState } from "./use-assistant-run";

/** Shared sidebar contract; the hosting editor owns all text changes. */
export interface AssistantPanelProps {
  readonly isOpen: boolean;
  readonly title: string;
  readonly canWrite: boolean;
  readonly canSend: boolean;
  readonly form: AssistantFormState;
  readonly history: AssistantHistoryState;
  readonly run: AssistantRunState;
  readonly onToggle: () => void;
  readonly onFormChange: (
    state: AssistantFormState,
    savePreferences?: boolean,
  ) => void;
  readonly onSend: () => void;
}

interface AssistantPositionStyle extends React.CSSProperties {
  readonly "--assistant-keyboard-inset": string;
}

function AssistantPreview({
  run,
  canWrite,
}: {
  readonly run: AssistantRunState;
  readonly canWrite: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  if (!run.proposal || run.proposal.result.change === "answer") return null;
  return (
    <section
      className="space-y-3 rounded-xl border border-primary/30 p-3"
      aria-label={t("assistant.preview")}
    >
      <h3 className="font-medium">{t("assistant.preview")}</h3>
      <p className="text-xs text-muted-foreground">
        {t(`assistant.scope.${run.proposal.request.scope}`)}
      </p>
      <details>
        <summary className="cursor-pointer text-sm">
          {t("assistant.before")}
        </summary>
        <pre className="mt-2 max-h-48 overflow-auto text-xs whitespace-pre-wrap">
          {run.proposal.request.source}
        </pre>
      </details>
      <WikiMarkdown
        source={run.proposal.result.text}
        isDisplayableImage={() => false}
      />
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={run.isRunning || !canWrite}
          onClick={() => void run.apply()}
        >
          {t("assistant.apply")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={run.isRunning}
          onClick={run.discard}
        >
          {t("assistant.discard")}
        </Button>
      </div>
    </section>
  );
}

function AssistantHistory({
  history,
  isRunning,
}: {
  readonly history: AssistantHistoryState;
  readonly isRunning: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={isRunning}
          onClick={() => void history.select(null)}
        >
          {t("assistant.newConversation")}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={isRunning || history.conversationId === null}
          onClick={() => void history.remove()}
        >
          {t("assistant.deleteConversation")}
        </Button>
      </div>
      <Select
        value={history.conversationId ?? ""}
        disabled={isRunning}
        ariaLabel={t("assistant.history")}
        options={[
          { value: "", label: t("assistant.newConversation") },
          ...history.conversations.map((entry, index) => ({
            value: entry.id,
            label: t("assistant.conversation", { number: index + 1 }),
          })),
        ]}
        onValueChange={(id) => void history.select(id || null)}
      />
      <ol className="space-y-3" aria-label={t("assistant.history")}>
        {history.messages.map((message) => (
          <li key={message.id} className="rounded-xl bg-muted/40 p-3 text-sm">
            <p className="mb-2 text-xs font-semibold">
              {t(`assistant.message.${message.role}`)}
            </p>
            <WikiMarkdown
              source={message.text}
              isDisplayableImage={() => false}
            />
            {message.change !== "answer" ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("assistant.message.suggestion")}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A permanently reachable agent button toggles a responsive sidebar for either editor. */
export function AssistantPanel(props: AssistantPanelProps): React.ReactElement {
  const { t } = useTranslation();
  const keyboardInset = useKeyboardInset();
  const positionStyle: AssistantPositionStyle = {
    "--assistant-keyboard-inset": `${keyboardInset}px`,
  };
  const { run, history } = props;
  const error = run.error || history.error;
  return (
    <>
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.isOpen}
        aria-controls="text-assistant-panel"
        aria-label={t("assistant.toggle")}
        aria-keyshortcuts="Control+Alt+Shift+J Meta+Alt+Shift+J"
        title={`${t("assistant.toggle")} (${formatShortcut("assistantChat", false)} / ${formatShortcut("assistantChat", true)})`}
        style={positionStyle}
        className="fixed right-4 bottom-[calc(var(--assistant-keyboard-inset)+env(safe-area-inset-bottom)+4rem)] z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg focus-visible:outline-2 focus-visible:outline-offset-2 md:bottom-[calc(env(safe-area-inset-bottom)+1rem)]"
      >
        <Bot aria-hidden="true" className="size-6" />
      </button>
      {props.isOpen ? (
        <aside
          id="text-assistant-panel"
          aria-label={t("assistant.title")}
          style={positionStyle}
          className="fixed top-16 right-0 bottom-[calc(var(--assistant-keyboard-inset)+env(safe-area-inset-bottom)+8rem)] z-40 flex w-full max-w-sm flex-col border border-border bg-surface shadow-xl md:bottom-[calc(env(safe-area-inset-bottom)+5rem)]"
        >
          <div className="flex items-center justify-between border-b border-border p-4">
            <div className="min-w-0">
              <h2 className="font-semibold">{t("assistant.title")}</h2>
              <p className="truncate text-xs text-muted-foreground">
                {props.title}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={props.onToggle}
              aria-label={t("assistant.close")}
            >
              <X aria-hidden="true" className="size-4" />
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
            <AssistantHistory history={history} isRunning={run.isRunning} />
            {run.isRunning ? (
              <p role="status" className="text-sm">
                {t("assistant.running")}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {t(`assistant.error.${error}`)}
              </p>
            ) : null}
            {run.isApplied ? (
              <p role="status" className="text-sm">
                {t("assistant.applied")}
              </p>
            ) : null}
            <AssistantPreview canWrite={props.canWrite} run={run} />
            <AssistantForm
              state={props.form}
              canWrite={props.canWrite}
              canSend={props.canSend}
              isRunning={run.isRunning}
              onChange={props.onFormChange}
              onSend={props.onSend}
              onCancel={() => void run.cancel()}
            />
          </div>
        </aside>
      ) : null}
    </>
  );
}
