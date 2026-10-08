import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { diffLines } from "@/app/lib/wiki-diff";

interface WikiConflictDialogProps {
  /** Text the person is working on. */
  readonly mine: string;
  /** Text somebody else saved. */
  readonly theirs: string;
  readonly onKeepMine: () => void;
  readonly onTakeTheirs: () => void;
}

const LINE_MARKERS = { added: "+ ", removed: "- ", same: "  " } as const;

const LINE_STYLES = {
  added: "bg-success/10 text-success",
  removed: "bg-destructive/10 text-destructive",
  same: "text-muted-foreground",
} as const;

/** Offers the three ways out of a save conflict. */
export function WikiConflictDialog({
  mine,
  theirs,
  onKeepMine,
  onTakeTheirs,
}: WikiConflictDialogProps): React.ReactElement {
  const { t } = useTranslation();
  const [isComparing, setIsComparing] = useState(false);

  return (
    <Dialog open>
      <DialogContent size="lg">
        <DialogTitle className="text-lg font-semibold">
          {t("wiki.conflict.title")}
        </DialogTitle>
        <DialogDescription className="mt-1 text-sm text-muted-foreground">
          {t("wiki.conflict.description")}
        </DialogDescription>
        {isComparing ? (
          <pre
            aria-label={t("wiki.conflict.differences")}
            className="mt-4 max-h-72 overflow-auto rounded-lg bg-muted p-3 text-xs"
          >
            {diffLines(theirs, mine).map((line, index) => (
              <div
                key={`${index}-${line.kind}`}
                className={LINE_STYLES[line.kind]}
              >
                {LINE_MARKERS[line.kind]}
                {line.text}
              </div>
            ))}
          </pre>
        ) : null}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setIsComparing(!isComparing)}
          >
            {t("wiki.conflict.compare")}
          </Button>
          <Button variant="outline" onClick={onTakeTheirs}>
            {t("wiki.conflict.takeTheirs")}
          </Button>
          <Button onClick={onKeepMine}>{t("wiki.conflict.keepMine")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
