import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { AuthHeading } from "@/app/components/auth/auth-heading";
import { buttonVariants } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

/** Renders the card shown when the setup already finished. */
export function SetupCompleted(): React.ReactElement {
  const { t } = useTranslation();

  return (
    <>
      <AuthHeading
        title={t("setup.completed.title")}
        subtitle={t("setup.completed.subtitle")}
      />
      <Link
        className={cn(buttonVariants({ variant: "auth" }), "mt-8")}
        to="/login"
      >
        {t("setup.completed.signIn")}
      </Link>
    </>
  );
}
