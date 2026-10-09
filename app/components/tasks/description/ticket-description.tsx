import { Edit3 } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
import { AssistantPanel } from "@/app/components/assistant/assistant-panel";
import { useTextAssistant } from "@/app/components/assistant/use-text-assistant";
import { useTranslation } from "react-i18next";

import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";
import {
  isTicketDisplayableImage,
  ticketAttachmentPath,
} from "@/app/lib/ticket-upload";

import { DescriptionLeaveDialog } from "./description-parts";
import { useDescriptionLeaveGuard } from "./use-description-leave-guard";
import { useTicketDescription } from "./use-ticket-description";

import type {
  BlockEditorFeatures,
  BlockEditorHandle,
} from "@/app/components/editor/block-editor-types";
import type { WorkItemDetail } from "@/definition/Task";
import type { TicketUploadsState } from "./use-ticket-uploads";

// The block editor is large; boards and ticket pages load it only once a
// person starts editing a description.
const DescriptionEditor = lazy(() => import("./description-editor"));

interface TicketDescriptionProps {
  readonly ticket: Pick<WorkItemDetail, "id" | "key" | "description">;
  /** Whether the person may change the description now. */
  readonly canEdit: boolean;
  readonly uploads: TicketUploadsState;
  /** `page` gives the editor the large area of the full view. */
  readonly variant?: "page" | "panel";
}

/** The editor features of a ticket description: uploads and ticket images. */
function createFeatures(uploads: TicketUploadsState): BlockEditorFeatures {
  return {
    isDisplayableImage: isTicketDisplayableImage,
    uploadFiles: async (files) =>
      (await uploads.upload(files)).map((attachment) => ({
        href: ticketAttachmentPath(attachment.id),
        isImage: attachment.isEmbeddable,
        name: attachment.fileName,
      })),
  };
}

/** Starts editing on a click into the text, but lets links work. */
function isLinkClick(event: React.MouseEvent): boolean {
  return event.target instanceof Element && event.target.closest("a") !== null;
}

interface DescriptionViewProps {
  readonly description: string;
  readonly canEdit: boolean;
  readonly onEdit: () => void;
}

/** The rendered description; a click into it starts editing. */
function DescriptionView({
  description,
  canEdit,
  onEdit,
}: DescriptionViewProps): React.ReactElement {
  const { t } = useTranslation();

  if (!description) {
    return canEdit ? (
      <button
        className="min-h-24 w-full rounded-lg border border-dashed border-border px-4 py-3 text-left text-sm text-muted-foreground hover:bg-muted/40"
        type="button"
        onClick={onEdit}
      >
        {t("tasks.description.add")}
      </button>
    ) : (
      <p className="text-sm italic text-muted-foreground/70">
        {t("tasks.description.empty")}
      </p>
    );
  }

  return (
    <div
      className={cn(
        "rounded-lg px-1 py-1",
        canEdit && "cursor-text hover:bg-muted/40",
      )}
      onClick={(event) => {
        if (canEdit && !isLinkClick(event)) {
          onEdit();
        }
      }}
    >
      <WikiMarkdown
        isDisplayableImage={isTicketDisplayableImage}
        source={description}
      />
    </div>
  );
}

/**
 * The description of a ticket as in Jira (A8.2-E05): the rendered text, a
 * click turns it into the block editor of A8.1 with a toolbar, and saving
 * or cancelling is explicit. Leaving with unsaved changes asks first.
 */
export function TicketDescription({
  ticket,
  canEdit,
  uploads,
  variant = "page",
}: TicketDescriptionProps): React.ReactElement {
  const { t } = useTranslation();
  const state = useTicketDescription(ticket);
  const guard = useDescriptionLeaveGuard(state);
  const handle = useRef<BlockEditorHandle | null>(null);
  const [element, setElement] = useState<HTMLElement | null>(null);
  const assistant = useTextAssistant({
    context: {
      kind: "ticket",
      id: ticket.id,
      version: state.isEditing ? state.base : ticket.description,
    },
    title: ticket.key,
    handle,
    content: state.isEditing ? state.draft : ticket.description,
    canEdit: canEdit && state.isEditing,
    canSend: state.status !== "saving",
    maximumLength: 65_536,
    selectionElement: element,
  });

  return (
    <section ref={setElement} className="flex flex-col gap-2 pb-20">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("tasks.tabs.description")}
        </h2>
        {state.status === "saved" ? (
          <span className="ml-auto text-xs text-muted-foreground" role="status">
            {t("tasks.description.status.saved")}
          </span>
        ) : null}
        {canEdit && !state.isEditing ? (
          <button
            aria-label={t("tasks.detail.editDescription")}
            className="inline-flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
            type="button"
            onClick={state.startEditing}
          >
            <Edit3 aria-hidden="true" className="size-4" />
          </button>
        ) : null}
      </div>
      {state.isEditing ? (
        <Suspense
          fallback={<WikiMarkdown className="px-1" source={state.draft} />}
        >
          <DescriptionEditor
            canEdit={canEdit}
            features={{
              ...createFeatures(uploads),
              textAssistant: assistant.editorFeature,
            }}
            assistantHandle={handle}
            label={t("tasks.description.editorLabel", { key: ticket.key })}
            state={state}
            variant={variant}
          />
        </Suspense>
      ) : (
        <DescriptionView
          canEdit={canEdit}
          description={ticket.description}
          onEdit={state.startEditing}
        />
      )}
      <DescriptionLeaveDialog guard={guard} />
      <AssistantPanel {...assistant.panel} />
    </section>
  );
}
