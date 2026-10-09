/** What a chosen reference puts into the text. */
export type EditorInsertion =
  | { readonly kind: "link"; readonly text: string; readonly href: string }
  | { readonly kind: "text"; readonly text: string };

/** An entry of the reference menu (`[[` and `@`). */
export interface EditorReference {
  readonly key: string;
  readonly label: string;
  /** Short kind of the entry, such as "Seite" or "Person". */
  readonly hint: string;
  readonly insertion: EditorInsertion;
}

/** A file that was uploaded for the document. */
export interface EditorUpload {
  readonly name: string;
  readonly href: string;
  /** Whether the file is shown as an image inside the text. */
  readonly isImage: boolean;
}

/** A page created from inside the editor (`/page`). */
export interface EditorPageLink {
  readonly title: string;
  readonly href: string;
  readonly icon: string | null;
}

/**
 * The text assistant supplied by the hosting document. Without it the
 * editor shows its entries as not yet available and sends nothing anywhere.
 */
export interface EditorTextAssistant {
  /** Opens the assistant for the current selection or block. */
  readonly open: (
    action?:
      | "translate"
      | "proofread"
      | "generate"
      | "summarize"
      | "explain"
      | "instruct",
  ) => void;
}

/** Selection and draft pinned before the assistant takes focus. */
export interface AssistantEditorTarget {
  readonly from: number;
  readonly to: number;
  readonly selectionMarkdown: string;
  readonly documentMarkdown: string;
}

/** What the surrounding application lets the editor do. */
export interface BlockEditorFeatures {
  /** Tells whether an image address may be shown. */
  readonly isDisplayableImage: (src: string) => boolean;
  /** Finds pages, tickets and people for `[[` and `@`. */
  readonly findReferences?: (
    query: string,
  ) => Promise<readonly EditorReference[]>;
  /** Uploads chosen, dropped or pasted files. */
  readonly uploadFiles?: (
    files: readonly File[],
  ) => Promise<readonly EditorUpload[]>;
  /** Creates a subpage; `null` when the person cancelled. */
  readonly createPage?: () => Promise<EditorPageLink | null>;
  /** Builds the address of a block from its anchor. */
  readonly blockLink?: (anchor: string) => string;
  /** Starts a comment on the selected text. */
  readonly comment?: () => void;
  readonly textAssistant?: EditorTextAssistant;
}

/** Controls of a mounted editor for its surrounding component. */
export interface BlockEditorHandle {
  /** The markdown of the document as it is now. */
  readonly getMarkdown: () => string;
  /** Replaces the whole document, for example with another saved version. */
  readonly replaceMarkdown: (markdown: string) => void;
  /** Puts the caret at the start of the document. */
  readonly focusStart: () => void;
  /** The element that holds the editable text. */
  readonly element: HTMLElement;
  /** Captures selection without changing the editor or saving anything. */
  readonly captureAssistantTarget?: () => AssistantEditorTarget;
  /** Applies one complete text suggestion as one isolated undo step. */
  readonly applyAssistantText?: (change: {
    readonly target: AssistantEditorTarget;
    readonly text: string;
    readonly scope: "none" | "selection" | "document";
    readonly kind: "replace" | "insert";
    readonly maximumLength: number;
    /** Wiki counts Unicode characters; ticket descriptions count UTF-16 units. */
    readonly lengthUnit?: "codePoint" | "codeUnit";
  }) => boolean;
}
