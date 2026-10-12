import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { Button, buttonVariants } from "@/app/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/components/ui/dialog";
import { PairingCommand } from "./pairing-command";

/** Gives the exact terminal command for the instance without starting a pairing in the browser. */
export function PairingGuide({
  open,
  onOpenChange,
  origin,
  version,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly origin: string;
  readonly version: string;
}): React.ReactElement {
  const { t } = useTranslation();
  const command = `node pages-mcp-v${version}.js pair --url ${origin}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogTitle className="text-lg font-semibold">
          {t("settings.connections.guide.title")}
        </DialogTitle>
        <DialogDescription className="mt-2 text-sm text-muted-foreground">
          {t("settings.connections.guide.description")}
        </DialogDescription>
        <ol className="mt-5 list-decimal space-y-4 pl-5 text-sm">
          <li>
            {t("settings.connections.guide.step1")}
            <PairingCommand command={command} />
            <p className="mt-2 text-xs text-muted-foreground">
              {t("settings.connections.guide.addressHint")}
            </p>
          </li>
          <li>
            {t("settings.connections.guide.step2", { origin })}
            <Link
              className={`${buttonVariants({ variant: "link" })} mt-2 block min-h-11`}
              to="/pair"
            >
              {t("settings.connections.guide.enterCode")}
            </Link>
          </li>
          <li>{t("settings.connections.guide.step3")}</li>
        </ol>
        <div className="mt-6 flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("settings.connections.guide.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
