import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/app/components/ui/dialog";

import { useMcpDeviceRevoke } from "./use-mcp-device-revoke";

import type { McpDeviceView } from "@/definition/McpDevice";

/** Asks once before a paired machine loses its access. */
export function McpDeviceRevokeDialog({
  device,
}: {
  readonly device: McpDeviceView;
}): React.ReactElement {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const { isPending, hasFailed, revoke } = useMcpDeviceRevoke(device.id);

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="destructive-soft">
          {t("settings.connections.mcpDevices.revoke")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          {t("settings.connections.mcpDevices.revokeTitle", {
            name: device.name,
          })}
        </DialogTitle>
        <DialogDescription className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {t("settings.connections.mcpDevices.revokeDescription")}
        </DialogDescription>
        {hasFailed ? (
          <p
            role="alert"
            className="pages-selectable mt-3 text-sm text-destructive"
          >
            {t("settings.connections.mcpDevices.error")}
          </p>
        ) : null}
        <footer className="mt-6 flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost">
              {t("settings.connections.mcpDevices.cancel")}
            </Button>
          </DialogClose>
          <Button isPending={isPending} variant="destructive" onClick={revoke}>
            {t("settings.connections.mcpDevices.revoke")}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
