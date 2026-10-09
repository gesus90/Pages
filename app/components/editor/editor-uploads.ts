import { Fragment, Slice } from "@tiptap/pm/model";

import { EDITOR_MARK, EDITOR_NODE } from "@/app/lib/editor/editor-schema";

import type { Node as ProseMirrorNode, Schema } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import type { EditorUpload } from "@/app/components/editor/block-editor-types";

function toParagraph(schema: Schema, upload: EditorUpload): ProseMirrorNode {
  const content = upload.isImage
    ? schema.node(EDITOR_NODE.image, { alt: upload.name, src: upload.href })
    : schema.text(upload.name, [
        schema.mark(EDITOR_MARK.link, { href: upload.href }),
      ]);

  return schema.node(EDITOR_NODE.paragraph, null, content);
}

/**
 * Uploads files and puts them into the document at the selection, one
 * paragraph each: images appear inside the text, other files as a link to
 * their download.
 *
 * @param view - The editor view.
 * @param files - The chosen, dropped or pasted files.
 * @param upload - Sends the files and reports what was stored.
 * @returns Whether anything was inserted.
 *
 * @remarks
 * A failed upload inserts nothing; the caller reports the failure.
 */
export async function insertUploads(
  view: EditorView,
  files: readonly File[],
  upload: (files: readonly File[]) => Promise<readonly EditorUpload[]>,
): Promise<boolean> {
  try {
    const uploads = await upload(files);

    if (uploads.length === 0 || view.isDestroyed) {
      return false;
    }

    const { schema } = view.state;
    const nodes = uploads.map((entry) => toParagraph(schema, entry));

    view.dispatch(
      view.state.tr
        .replaceSelection(new Slice(Fragment.fromArray(nodes), 0, 0))
        .scrollIntoView(),
    );

    return true;
  } catch (error: unknown) {
    console.error("The editor could not insert the uploaded files.", error);

    return false;
  }
}
