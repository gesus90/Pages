import { useTranslation } from "react-i18next";

import { Input } from "@/app/components/ui/input";

import type { PicaMobilePortForm } from "./use-pica-mobile-port";

/** The WebSocket port input with the reason a typed or submitted port is refused. */
export function PicaMobilePortField({
  form,
}: {
  readonly form: PicaMobilePortForm;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="sm:max-w-44 lg:max-w-none">
      <label
        htmlFor="pica-mobile-port"
        className="mb-1.5 block text-sm font-medium"
      >
        {t("settings.connections.picaMobile.port.label")}
      </label>
      <Input
        id="pica-mobile-port"
        name="port"
        inputMode="numeric"
        autoComplete="off"
        value={form.text}
        onChange={(event) => form.changeText(event.target.value)}
        disabled={form.pending}
        aria-invalid={form.error !== null}
        aria-describedby="pica-mobile-port-message"
        className="aria-invalid:ring-2 aria-invalid:ring-destructive"
      />
      <p
        id="pica-mobile-port-message"
        role="alert"
        className="pages-selectable mt-1.5 text-xs text-destructive empty:hidden"
      >
        {form.error === null
          ? null
          : t(`settings.connections.picaMobile.error.${form.error}`, {
              port: form.text.trim(),
            })}
      </p>
    </div>
  );
}
