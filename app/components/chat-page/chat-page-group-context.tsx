import { NotebookText } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { cn } from "@/app/lib/cn";

import type {
  ConversationGroupContextStatus,
  ConversationGroupContextView,
} from "@/definition/ConversationObserver";
import type { VirtualGroup } from "@/definition/VirtualChat";

/** How each status reads as a badge, by semantic token. */
const STATUS_CLASSES: Readonly<Record<ConversationGroupContextStatus, string>> =
  {
    current: "bg-success-subtle text-success",
    behind: "bg-warning-subtle text-warning",
    unavailable: "bg-muted text-muted-foreground",
    rebuilding: "bg-warning-subtle text-warning",
  };

interface ContextAnswer {
  readonly ok: boolean;
  readonly groupContext?: ConversationGroupContextView;
}

function isContextAnswer(value: unknown): value is ContextAnswer {
  return typeof value === "object" && value !== null && "ok" in value;
}

/** The context the server answered for this group, or `null`. */
function readView(
  answer: unknown,
  groupId: string,
): ConversationGroupContextView | null {
  if (!isContextAnswer(answer) || !answer.groupContext) return null;
  return answer.groupContext.conversationId === groupId
    ? answer.groupContext
    : null;
}

function ContextList({
  title,
  entries,
}: {
  readonly title: string;
  readonly entries: readonly string[];
}): React.ReactElement | null {
  if (entries.length === 0) return null;
  return (
    <section className="mt-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground">
        {entries.map((entry, index) => (
          <li key={`${String(index)}-${entry}`}>{entry}</li>
        ))}
      </ul>
    </section>
  );
}

function ContextState({
  view,
}: {
  readonly view: ConversationGroupContextView;
}): React.ReactElement {
  const { t, i18n } = useTranslation();
  const stand =
    view.updatedAt === null
      ? t("chatPage.groupContext.noStand")
      : t("chatPage.groupContext.stand", {
          sequence: view.throughSequence,
          moment: new Date(view.updatedAt).toLocaleString(i18n.language),
        });
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
      <span
        className={cn(
          "rounded-full px-2.5 py-0.5 text-xs font-semibold",
          STATUS_CLASSES[view.status],
        )}
      >
        {t(`chatPage.groupContext.status.${view.status}`)}
      </span>
      <span>{stand}</span>
      {view.pendingMessages > 0 ? (
        <span>
          {t("chatPage.groupContext.pending", { count: view.pendingMessages })}
        </span>
      ) : null}
    </div>
  );
}

function ContextBody({
  view,
  isLoading,
}: {
  readonly view: ConversationGroupContextView | null;
  readonly isLoading: boolean;
}): React.ReactElement {
  const { t } = useTranslation();
  if (view === null)
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        {isLoading
          ? t("chatPage.groupContext.loading")
          : t("chatPage.groupContext.failed")}
      </p>
    );
  return (
    <>
      <ContextState view={view} />
      {view.summary === "" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {t("chatPage.groupContext.empty")}
        </p>
      ) : (
        <p className="mt-4 text-sm whitespace-pre-wrap text-foreground">
          {view.summary}
        </p>
      )}
      <ContextList
        title={t("chatPage.groupContext.decisions")}
        entries={view.decisions}
      />
      <ContextList
        title={t("chatPage.groupContext.openItems")}
        entries={view.openItems}
      />
      <ContextList
        title={t("chatPage.groupContext.responsibilities")}
        entries={view.responsibilities}
      />
      {view.hasExcerpts ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {t("chatPage.groupContext.excerpts")}
        </p>
      ) : null}
      {view.errorCode !== null && view.status !== "current" ? (
        <p className="mt-2 text-xs text-muted-foreground">
          {t("chatPage.groupContext.reason", { code: view.errorCode })}
        </p>
      ) : null}
    </>
  );
}

/**
 * The compact „Gruppenkontext“ of a group (PAGE-296): the stored summary
 * with decisions, open points and responsibilities, how far it reaches and
 * whether it is current, behind or unavailable.
 *
 * @remarks
 * The server answers only a member of the group. The context is read when
 * the dialog opens; it is derived and never replaces the messages.
 */
export function ChatPageGroupContext({
  group,
}: {
  readonly group: VirtualGroup;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const loader = useFetcher();
  const view = readView(loader.data, group.id);

  function handleOpen(): void {
    setIsOpen(true);
    const formData = new FormData();
    formData.set("intent", "group-context");
    formData.set("conversationId", group.id);
    void loader.submit(formData, { method: "post" });
  }

  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={handleOpen}
        size="sm"
        type="button"
        variant="outline"
      >
        <NotebookText aria-hidden="true" className="size-3.5" />
        {t("chatPage.groupContext.open")}
      </Button>
      <Dialog onOpenChange={setIsOpen} open={isOpen}>
        <DialogContent size="md">
          <DialogTitle className="text-lg font-semibold">
            {t("chatPage.groupContext.title", { name: group.name })}
          </DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {t("chatPage.groupContext.description")}
          </DialogDescription>
          <ContextBody view={view} isLoading={loader.state !== "idle"} />
        </DialogContent>
      </Dialog>
    </>
  );
}
