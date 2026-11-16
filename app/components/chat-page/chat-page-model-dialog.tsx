import { Check, Search } from "lucide-react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";

import { targetFields } from "./agent-control-api";
import { useAgentControl } from "./use-agent-control";
import { useModelChoice } from "./use-model-choice";

import type {
  AgentChatControlTarget,
  AgentChatModelChoice,
  AgentChatModelOverview,
} from "@/definition/AgentChatControl";
import type { ModelChoiceState } from "./use-model-choice";

/**
 * The translated name of a reasoning level, such as "hoch"; an unknown
 * level keeps its ID.
 * @param t - The translation function.
 * @param effort - The level.
 */
export function effortLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  effort: string,
): string {
  return t(`chatPage.modelChoice.effort.${effort}`, { defaultValue: effort });
}

/** The models of the choice by connection, in the order the catalog lists them. */
function byConnection(
  choices: readonly AgentChatModelChoice[],
): [string, AgentChatModelChoice[]][] {
  const groups = new Map<string, AgentChatModelChoice[]>();
  for (const choice of choices) {
    const list = groups.get(choice.connectionName) ?? [];
    list.push(choice);
    groups.set(choice.connectionName, list);
  }
  return [...groups.entries()];
}

function ModelList({
  choice,
  overview,
}: {
  readonly choice: ModelChoiceState;
  readonly overview: AgentChatModelOverview;
}): React.ReactElement {
  const { t } = useTranslation();
  if (choice.visible.length === 0)
    return (
      <p className="px-2 py-3 text-sm text-muted-foreground">
        {t("chatPage.modelChoice.none")}
      </p>
    );
  return (
    <div className="flex flex-col gap-2">
      {byConnection(choice.visible).map(([connection, models]) => (
        <section key={connection}>
          <h3 className="px-2 py-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {connection}
          </h3>
          <ul>
            {models.map((model) => {
              const isPicked = choice.picked === model;
              const isStandard =
                model.connectionId === overview.standard.connectionId &&
                model.model === overview.standard.model;
              return (
                <li key={`${model.connectionId}:${model.model}`}>
                  <button
                    type="button"
                    aria-pressed={isPicked}
                    className={cn(
                      "flex min-h-9 w-full items-center gap-2 rounded-lg px-2 text-left text-sm hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-primary",
                      isPicked && "bg-primary-subtle font-semibold",
                    )}
                    disabled={!overview.canControl}
                    onClick={() => choice.choose(model)}
                  >
                    <Check
                      aria-hidden="true"
                      className={cn("size-3.5", !isPicked && "invisible")}
                    />
                    <span className="flex-1 truncate">{model.name}</span>
                    {isStandard ? (
                      <span className="text-xs text-muted-foreground">
                        {t("chatPage.modelChoice.standard")}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function EffortChoice({
  choice,
  isDisabled,
}: {
  readonly choice: ModelChoiceState;
  readonly isDisabled: boolean;
}): React.ReactElement | null {
  const { t } = useTranslation();
  const efforts = choice.picked?.reasoningEfforts ?? [];
  if (efforts.length === 0) return null;
  const current = choice.pick?.reasoningEffort ?? null;
  const options: (string | null)[] = [null, ...efforts];
  return (
    <fieldset className="mt-3">
      <legend className="text-xs text-muted-foreground">
        {t("chatPage.modelChoice.effortLabel")}
      </legend>
      <div className="mt-1 flex flex-wrap gap-1 rounded-lg border border-border p-1">
        {options.map((effort) => (
          <button
            key={effort ?? "default"}
            type="button"
            aria-pressed={current === effort}
            disabled={isDisabled}
            className={cn(
              "min-h-9 rounded-md px-3 text-sm",
              current === effort
                ? "bg-primary text-primary-foreground"
                : "hover:bg-surface-hover",
            )}
            onClick={() => choice.chooseEffort(effort)}
          >
            {effort === null
              ? t("chatPage.modelChoice.effortDefault")
              : effortLabel(t, effort)}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ModelSearchBody({
  agentName,
  choice,
  overview,
  canControl,
}: {
  readonly agentName: string;
  readonly choice: ModelChoiceState;
  readonly overview: AgentChatModelOverview;
  readonly canControl: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <>
      <label className="relative mt-4 block">
        <span className="sr-only">{t("chatPage.modelChoice.search")}</span>
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          className="h-10 w-full rounded-xl border border-border bg-surface pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary"
          onChange={(event) => choice.setQuery(event.target.value)}
          placeholder={t("chatPage.modelChoice.search")}
          type="search"
          value={choice.query}
        />
      </label>
      <div className="mt-3 max-h-[40dvh] overflow-y-auto">
        <ModelList choice={choice} overview={overview} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {t("chatPage.modelChoice.onlyText", { agent: agentName })}
      </p>
      <EffortChoice choice={choice} isDisabled={!canControl} />
    </>
  );
}

interface ModelDialogFooterProps {
  readonly canControl: boolean;
  readonly hasOverride: boolean;
  readonly canSwitch: boolean;
  readonly isPending: boolean;
  readonly onReset: () => void;
  readonly onClose: () => void;
  readonly onSwitch: () => void;
}

function ModelDialogFooter({
  canControl,
  hasOverride,
  canSwitch,
  isPending,
  onReset,
  onClose,
  onSwitch,
}: ModelDialogFooterProps): React.ReactElement {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex flex-wrap justify-end gap-2">
      <Button
        variant="outline"
        disabled={!canControl || !hasOverride}
        isPending={isPending}
        onClick={onReset}
      >
        {t("chatPage.modelChoice.reset")}
      </Button>
      <Button variant="outline" onClick={onClose}>
        {t("chatPage.modelChoice.cancel")}
      </Button>
      <Button
        disabled={!canControl || !canSwitch}
        isPending={isPending}
        onClick={onSwitch}
      >
        {t("chatPage.modelChoice.switch")}
      </Button>
    </div>
  );
}

interface ChatPageModelDialogProps {
  /** The chat and agent the dialog is open for; `null` while it is closed. */
  readonly target: AgentChatControlTarget | null;
  readonly agentName: string;
  readonly chatName: string;
  readonly onClose: () => void;
}

/**
 * The choice "Modell in diesem Chat …" of an agent: the text
 * models of the connections the agent may use, the reasoning level of the
 * chosen model, "Auf Standard zurücksetzen" and "Wechseln".
 *
 * @remarks
 * Switching ends the session of the agent in this chat on purpose: the
 * running answer ends first, then the session starts anew with the new model
 * and its summary. A member without the right sees the choice disabled.
 */
export function ChatPageModelDialog({
  target,
  agentName,
  chatName,
  onClose,
}: ChatPageModelDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const choice = useModelChoice(target);
  const request = useAgentControl();
  const { overview, pick } = choice;
  const canControl = overview?.canControl === true;

  async function submit(fields: Record<string, string>): Promise<void> {
    if (target === null) return;
    const response = await request.send({ ...fields, ...targetFields(target) });
    if (response?.ok === true) onClose();
  }

  function handleSwitch(): void {
    if (pick === null) return;
    void submit({
      intent: "set-model",
      connectionId: pick.connectionId,
      model: pick.model,
      reasoningEffort: pick.reasoningEffort ?? "",
    });
  }

  return (
    <Dialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("chatPage.modelChoice.title", {
            agent: agentName,
            chat: chatName,
          })}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {overview
            ? t("chatPage.modelChoice.standardOf", {
                model: overview.standard.name,
              })
            : t("chatPage.modelChoice.loading")}
        </DialogDescription>
        {overview ? (
          <ModelSearchBody
            agentName={agentName}
            canControl={canControl}
            choice={choice}
            overview={overview}
          />
        ) : null}
        {overview && !canControl ? (
          <p className="mt-3 text-sm text-muted-foreground" role="note">
            {t("chatPage.agentMenu.noRight")}
          </p>
        ) : null}
        {request.failure === null ? null : (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {t(`chatPage.control.failure.${request.failure}`)}
          </p>
        )}
        <ModelDialogFooter
          canControl={canControl}
          canSwitch={pick !== null}
          hasOverride={overview !== null && overview.override !== null}
          isPending={request.isPending}
          onClose={onClose}
          onReset={() => void submit({ intent: "reset-model" })}
          onSwitch={handleSwitch}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          {t("chatPage.modelChoice.hint", {
            agent: agentName,
            model: choice.picked?.name ?? "",
          })}
        </p>
      </DialogContent>
    </Dialog>
  );
}
