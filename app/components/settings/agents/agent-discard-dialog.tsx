import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";

/** Requires an explicit decision before abandoning an unsaved agent draft. */
export function AgentDiscardDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (value: boolean) => void;
  readonly onDiscard: () => void;
  readonly title?: string;
  readonly description?: string;
}): React.ReactElement {
  const { t } = useTranslation();
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {props.title ?? t("settings.agents.definition.discardTitle")}
        </DialogTitle>
        <DialogDescription className="mt-1.5 text-sm text-muted-foreground">
          {props.description ??
            t("settings.agents.definition.discardDescription")}
        </DialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => props.onOpenChange(false)}
          >
            {t("settings.agents.cancel")}
          </Button>
          <Button type="button" variant="destructive" onClick={props.onDiscard}>
            {t("settings.agents.definition.discard")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
