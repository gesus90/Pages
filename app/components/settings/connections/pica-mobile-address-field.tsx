import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";

/** The read-only address for the app, with the hint that explains it. */
export function PicaMobileAddressField({
  address,
  hasHost,
}: {
  readonly address: string;
  /** Whether the server knows a host a smartphone can reach. */
  readonly hasHost: boolean;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div>
      <label
        htmlFor="pica-mobile-address"
        className="mb-1.5 block text-sm font-medium"
      >
        {t("settings.connections.picaMobile.address.label")}
      </label>
      <Input
        id="pica-mobile-address"
        readOnly
        autoComplete="off"
        value={address}
        aria-describedby="pica-mobile-address-hint"
        className="pages-selectable bg-muted/50 font-mono shadow-none"
      />
      <p
        id="pica-mobile-address-hint"
        className="mt-1.5 text-xs text-muted-foreground"
      >
        {hasHost
          ? t("settings.connections.picaMobile.address.hint")
          : t("settings.connections.picaMobile.address.noHost")}
      </p>
    </div>
  );
}
