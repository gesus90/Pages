import { Edit3 } from "lucide-react";
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";

import { ImageViewer } from "@/app/components/ui/image-viewer";
import { useImageViewer } from "@/app/components/ui/image-viewer/use-image-viewer";
import { WikiMarkdown } from "@/app/components/wiki/wiki-markdown";
import { cn } from "@/app/lib/cn";
import {
  isTicketDisplayableImage,
  ticketAttachmentPath,
} from "@/app/lib/ticket-upload";

import { useTicketDescription } from "./use-ticket-description";

import type { BlockEditorFeatures } from "@/app/components/editor/block-editor-types";
import type { WorkItemDetail } from "@/definition/Task";
import type { TicketUploadsState } from "./use-ticket-uploads";

// The block editor is large; boards and ticket pages load it only once a
// person starts editing a description.
const DescriptionEditor = lazy(() => import("./description-editor"));

interface TicketDescriptionProps {
  readonly ticket: Pick<
    WorkItemDetail,
    "id" | "key" | "description" | "updatedAt"
  >;
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

/**
 * Tells whether a click hit something that acts on its own, such as a link
 * or an image, and so is not a click into the text.
 */
function isControlClick(event: React.MouseEvent): boolean {
  return (
    event.target instanceof Element &&
    event.target.closest("a, button") !== null
  );
}

interface DescriptionViewProps {
  readonly description: string;
  readonly canEdit: boolean;
  readonly onEdit: () => void;
}

/**
 * The rendered text; a click into it starts editing, a click on an image
 * opens the viewer for the images of this description.
 */
function DescriptionText({
  description,
  canEdit,
  onEdit,
}: DescriptionViewProps): React.ReactElement {
  const viewer = useImageViewer();

  return (
    <>
      <div
        className={cn(
          "rounded-lg px-1 py-1",
          canEdit && "cursor-text hover:bg-muted/40",
        )}
        onClick={(event) => {
          if (canEdit && !isControlClick(event)) {
            onEdit();
          }
        }}
      >
        <WikiMarkdown
          isDisplayableImage={isTicketDisplayableImage}
          source={description}
          onOpenImage={viewer.open}
        />
      </div>
      {/* Beside the text, not inside it: a click in the viewer is no click into the text. */}
      {viewer.session ? (
        <ImageViewer
          images={viewer.session.images}
          index={viewer.session.index}
          onClose={viewer.close}
          onCloseAutoFocus={viewer.restoreFocus}
          onIndexChange={viewer.select}
        />
      ) : null}
    </>
  );
}

/** The description, or what stands in for it while it is empty. */
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
    <DescriptionText
      canEdit={canEdit}
      description={description}
      onEdit={onEdit}
    />
  );
}

/**
 * The description of a ticket as in Jira (A8.2-E05): the rendered text, a
 * click turns it into the block editor of A8.1 with a toolbar, and saving
 * or cancelling is explicit. Drafts stay available across page changes.
 */
export function TicketDescription({
  ticket,
  canEdit,
  uploads,
  variant = "page",
}: TicketDescriptionProps): React.ReactElement {
  const { t } = useTranslation();
  const state = useTicketDescription(ticket);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {t("tasks.tabs.description")}
        </h2>
        {state.status === "saved" || state.status === "saving" ? (
          <span className="ml-auto text-xs text-muted-foreground" role="status">
            {t(`tasks.description.status.${state.status}`)}
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
            features={createFeatures(uploads)}
            label={t("tasks.description.editorLabel", { key: ticket.key })}
            state={state}
            variant={variant}
          />
        </Suspense>
      ) : (
        <DescriptionView
          canEdit={canEdit}
          description={state.draft}
          onEdit={state.startEditing}
        />
      )}
    </section>
  );
}
