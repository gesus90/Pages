import { Rocket } from "lucide-react";
import { useTranslation } from "react-i18next";

/** Renders the hint that the first start sets the instance up. */
export function LoginSetupHint(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="mt-8 border-t border-[#edf0f4] pt-6">
      <div className="flex items-start gap-4 text-left">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary">
          <Rocket className="size-5" aria-hidden="true" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-foreground">
            {t("login.setup.title")}
          </span>
          <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
            {t("login.setup.description")}
          </span>
        </span>
      </div>
    </div>
  );
}
