import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useRegionFormatter } from "@/app/components/common/region-provider";
import { PairingDetails } from "./pairing-details";
import type { McpPairingView } from "@/definition/McpPairing";

/** Shows the code, trust warning and account before any approval controls. */
export function PairingRequestSummary({
  view,
}: {
  readonly view: McpPairingView;
}): React.ReactElement {
  const { t } = useTranslation();
  const { formatDateTime } = useRegionFormatter();
  return (
    <>
      <p className="flex gap-2 rounded-xl bg-warning-subtle px-4 py-2.5 text-sm text-warning">
        <AlertTriangle aria-hidden="true" className="size-5 shrink-0" />
        {t("mcpPairing.warning")}
      </p>
      <div>
        <div className="rounded-xl bg-muted/40 p-4">
          <p className="text-sm font-medium">{t("mcpPairing.code.label")}</p>
          <p
            aria-hidden="true"
            className="pages-selectable whitespace-nowrap text-2xl font-semibold tracking-widest"
          >
            {view.code}
          </p>
          <span className="sr-only">
            {t("mcpPairing.code.spoken", {
              letters: view.code.replace("-", ", ").split("").join(" "),
            })}
          </span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("mcpPairing.code.compare")}{" "}
          {t("mcpPairing.code.validUntil", {
            time: formatDateTime(new Date(view.expiresAt ?? 0).toISOString()),
          })}
        </p>
      </div>
      <PairingDetails view={view} />
    </>
  );
}
