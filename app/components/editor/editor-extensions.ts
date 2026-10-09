import { Code } from "@tiptap/extension-code";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { Placeholder } from "@tiptap/extensions";
import { StarterKit } from "@tiptap/starter-kit";

import { AttachmentImageNode } from "@/app/components/editor/extensions/attachment-image-node";
import { CalloutNode } from "@/app/components/editor/extensions/callout-node";
import { ContentsNode } from "@/app/components/editor/extensions/contents-node";
import { MarkdownAttributes } from "@/app/components/editor/extensions/markdown-attributes";
import { RawMarkdownNode } from "@/app/components/editor/extensions/raw-markdown-node";
import {
  ToggleNode,
  ToggleSummaryNode,
} from "@/app/components/editor/extensions/toggle-node";
import { transformMarkdownUrl } from "@/app/lib/markdown-links";
import { EDITOR_NODE } from "@/app/lib/editor/editor-schema";

import type { Extensions } from "@tiptap/core";

/** What the schema extensions need from the surrounding application. */
export interface EditorSchemaOptions {
  /** Text of empty blocks that hints at the slash menu. */
  readonly placeholder: string;
  /** Accessible name of the checkbox of a task. */
  readonly checkboxLabel: (checked: boolean) => string;
  /** Tells whether an image address may be shown in the editor. */
  readonly isDisplayableImage: (src: string) => boolean;
}

/** Schema options for tests and tools that never render the editor. */
export const HEADLESS_SCHEMA_OPTIONS: EditorSchemaOptions = {
  checkboxLabel: () => "",
  isDisplayableImage: () => false,
  placeholder: "",
};

/**
 * Builds the extensions that define what a document can hold.
 *
 * @param options - Texts and rules of the application.
 * @returns The extensions of the markdown block schema.
 *
 * @remarks
 * Everything here maps to markdown: there is no underline, table cells hold
 * one paragraph like GFM cells, cells cannot be merged, and code may carry
 * emphasis as markdown allows.
 */
export function createSchemaExtensions(
  options: EditorSchemaOptions,
): Extensions {
  return [
    StarterKit.configure({
      code: false,
      dropcursor: { class: "pages-editor-dropcursor", width: 3 },
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        autolink: true,
        defaultProtocol: "https",
        HTMLAttributes: {
          class: null,
          rel: "noopener noreferrer nofollow",
          target: null,
        },
        isAllowedUri: (url: string) => transformMarkdownUrl(url) !== "",
        linkOnPaste: true,
        openOnClick: false,
      },
      trailingNode: false,
      underline: false,
      undoRedo: { depth: 200 },
    }),
    // Markdown allows emphasis around code (`**\`x\`**`), so code does not
    // exclude the other marks as it does by default.
    Code.extend({ excludes: "" }),
    TaskList,
    TaskItem.configure({
      a11y: { checkboxLabel: (_, checked) => options.checkboxLabel(checked) },
      nested: true,
    }),
    Table.configure({ allowTableNodeSelection: true, resizable: false }),
    TableRow,
    TableHeader.extend({ content: EDITOR_NODE.paragraph }),
    TableCell.extend({ content: EDITOR_NODE.paragraph }),
    CalloutNode,
    ToggleNode,
    ToggleSummaryNode,
    RawMarkdownNode,
    ContentsNode,
    AttachmentImageNode.configure({
      isDisplayable: options.isDisplayableImage,
    }),
    MarkdownAttributes,
    Placeholder.configure({
      includeChildren: true,
      placeholder: options.placeholder,
      showOnlyCurrent: true,
    }),
  ];
}
