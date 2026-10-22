import { Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/app/components/ui/dropdown-menu";

import type { RemoteInstallView } from "@/definition/RemoteSetup";

/** The menu line: its text says why it is off, and the server refuses a start in these states as well. */
function menuTextKey(install: RemoteInstallView | undefined): string {
  if (install?.state === "confirmed") return "remote.setup.menu.installed";
  if (install?.state === "running") return "remote.setup.menu.running";
  return "remote.setup.menu.runner";
}

/**
 * The „Setup“ group directly under „Konsole öffnen“: „Runner einrichten“, or
 * the same line disabled as „Bereits installiert“ once the installation is confirmed.
 *
 * @remarks
 * The state comes from the finding Pages stored after the last connect, bound
 * to host, port, user and host key. Disabling the line is a courtesy only: the
 * server refuses a start for a confirmed installation on its own.
 */
export function RemoteSetupMenuItem(props: {
  readonly install: RemoteInstallView | undefined;
  readonly onSetup: () => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const isOff =
    props.install?.state === "confirmed" || props.install?.state === "running";
  return (
    <>
      <DropdownMenuLabel className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground">
        {t("remote.setup.menu.heading")}
      </DropdownMenuLabel>
      <DropdownMenuItem disabled={isOff} onSelect={props.onSetup}>
        <Wrench className="mr-2 size-4" aria-hidden="true" />
        {t(menuTextKey(props.install))}
      </DropdownMenuItem>
    </>
  );
}
