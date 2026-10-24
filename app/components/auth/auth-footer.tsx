import { useTranslation } from "react-i18next";

import { PAGES_VERSION } from "@/definition/Version";

/** Renders the version and tagline at the bottom of the login and setup pages. */
export function AuthFooter(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <footer className="absolute inset-x-0 bottom-0 px-6 py-6 text-xs sm:px-10">
      <p className="w-fit rounded-sm bg-(--auth-footer-surface) font-semibold text-foreground">
        Pages v{PAGES_VERSION}
      </p>
      <p className="mt-0.5 w-fit rounded-sm bg-(--auth-footer-surface) text-muted-foreground">
        {t("login.footer.tagline")}
      </p>
    </footer>
  );
}
