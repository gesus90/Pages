import { useTranslation } from "react-i18next";

import {
  readReferences,
  toEditorReference,
} from "@/app/lib/wiki-editor-references";
import { wikiPagePath } from "@/app/lib/wiki-tree";
import { isWikiAttachmentPath } from "@/app/lib/wiki-upload";

import type {
  BlockEditorFeatures,
  EditorPageLink,
  EditorReference,
} from "@/app/components/editor/block-editor-types";
import type { WikiUploadsState } from "@/app/components/wiki/use-wiki-uploads";

interface WikiEditorFeatureOptions {
  readonly pageId: string;
  readonly uploads: WikiUploadsState;
  /** Asks for a title and creates a subpage of this page (`/page`). */
  readonly requestSubpage: () => Promise<EditorPageLink | null>;
  /** Starts a comment on the selected passage. */
  readonly onComment: () => void;
}

async function fetchReferences(
  query: string,
  hintOf: (kind: "page" | "ticket" | "person") => string,
): Promise<EditorReference[]> {
  try {
    const response = await fetch(
      `/wiki-api/references?q=${encodeURIComponent(query)}`,
    );

    if (!response.ok) {
      return [];
    }

    const body: unknown = await response.json();

    return readReferences(body).map((reference) =>
      toEditorReference(reference, hintOf),
    );
  } catch (error: unknown) {
    console.warn("Pages could not load references for the editor.", error);

    return [];
  }
}

/**
 * The features of the block editor on a wiki page: references to pages,
 * tickets and people, uploads to the page, subpages, block links, comments
 * on passages, and images only from attachments of this instance.
 *
 * @returns The features for `BlockEditor`.
 */
export function useWikiEditorFeatures({
  pageId,
  uploads,
  requestSubpage,
  onComment,
}: WikiEditorFeatureOptions): BlockEditorFeatures {
  const { t } = useTranslation();

  return {
    blockLink: (anchor) =>
      `${window.location.origin}${wikiPagePath(pageId)}#block-${anchor}`,
    comment: onComment,
    createPage: requestSubpage,
    findReferences: (query) =>
      fetchReferences(query, (kind) => t(`wiki.editor.reference.${kind}`)),
    isDisplayableImage: isWikiAttachmentPath,
    uploadFiles: async (files) =>
      (await uploads.upload(files)).map((attachment) => ({
        href: `/wiki/attachments/${attachment.id}`,
        isImage: attachment.isEmbeddable,
        name: attachment.fileName,
      })),
  };
}
