import { Node } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";

import { AttachmentImageView } from "@/app/components/editor/extensions/attachment-image-view";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";

/** Options of the image node. */
export interface AttachmentImageOptions {
  /**
   * Tells whether an image address may be shown. Others stay in the text but
   * appear as a placeholder, as in the renderer, so no foreign address is
   * loaded.
   */
  readonly isDisplayable: (src: string) => boolean;
}

/** An image inside the text (`![alt](src "title")`). */
export const AttachmentImageNode = Node.create<AttachmentImageOptions>({
  addAttributes() {
    return {
      alt: { default: "" },
      src: { default: "" },
      title: { default: null },
    };
  },
  addNodeView() {
    return ReactNodeViewRenderer(AttachmentImageView);
  },
  addOptions() {
    return { isDisplayable: () => false };
  },
  atom: true,
  draggable: true,
  group: "inline",
  inline: true,
  name: EDITOR_NODE.image,
  parseHTML() {
    return [{ tag: "img[src]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["img", HTMLAttributes];
  },
});
