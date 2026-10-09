import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { Input } from "@/app/components/ui/input";
import { returnFocus } from "@/app/components/editor/editor-geometry";
import { startUndoStep } from "@/app/lib/editor/editor-commands";
import { EDITOR_MARK, readTextAttribute } from "@/app/lib/editor/editor-schema";
import { transformMarkdownUrl } from "@/app/lib/markdown-links";

import type { Editor } from "@tiptap/core";

interface EditorLinkDialogProps {
  readonly editor: Editor;
  readonly onClose: () => void;
}

function applyLink(editor: Editor, href: string, text: string): void {
  startUndoStep(editor);

  if (editor.state.selection.empty && !editor.isActive(EDITOR_MARK.link)) {
    editor
      .chain()
      .focus()
      .insertContent({
        marks: [{ attrs: { href }, type: EDITOR_MARK.link }],
        text: text.trim() === "" ? href : text,
        type: "text",
      })
      .run();

    return;
  }

  editor
    .chain()
    .focus()
    .extendMarkRange(EDITOR_MARK.link)
    .setLink({ href })
    .run();
}

/**
 * Adds, changes or removes a link at the selection (`Mod+K`). Only addresses
 * the renderer shows are accepted: http, https, mailto and paths of Pages.
 */
export function EditorLinkDialog({
  editor,
  onClose,
}: EditorLinkDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const current = readTextAttribute(
    editor.getAttributes(EDITOR_MARK.link),
    "href",
  );
  const needsText = editor.state.selection.empty && current === null;
  const [href, setHref] = useState(current ?? "");
  const [text, setText] = useState("");
  const [isInvalid, setIsInvalid] = useState(false);

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();

    if (href.trim() === "" || transformMarkdownUrl(href) === "") {
      setIsInvalid(true);

      return;
    }

    applyLink(editor, href.trim(), text);
    onClose();
  }

  function handleRemove(): void {
    startUndoStep(editor);
    editor.chain().focus().extendMarkRange(EDITOR_MARK.link).unsetLink().run();
    onClose();
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent onCloseAutoFocus={() => returnFocus(editor)}>
        <DialogTitle className="text-lg font-semibold">
          {t("editor.link.title")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("editor.link.description")}
        </DialogDescription>
        <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
          <label
            className="block text-sm font-medium"
            htmlFor="editor-link-href"
          >
            {t("editor.link.address")}
            <Input
              aria-invalid={isInvalid}
              autoFocus
              className="mt-1"
              id="editor-link-href"
              placeholder="https://"
              value={href}
              onChange={(event) => {
                setHref(event.target.value);
                setIsInvalid(false);
              }}
            />
          </label>
          {needsText ? (
            <label
              className="block text-sm font-medium"
              htmlFor="editor-link-text"
            >
              {t("editor.link.text")}
              <Input
                className="mt-1"
                id="editor-link-text"
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </label>
          ) : null}
          {isInvalid ? (
            <p className="text-sm text-destructive" role="alert">
              {t("editor.link.invalid")}
            </p>
          ) : null}
          <div className="flex justify-end gap-2">
            {current === null ? null : (
              <Button variant="destructive-soft" onClick={handleRemove}>
                {t("editor.link.remove")}
              </Button>
            )}
            <Button variant="ghost" onClick={onClose}>
              {t("editor.link.cancel")}
            </Button>
            <Button type="submit">{t("editor.link.apply")}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
