import { useTranslation } from "react-i18next";

import type { UsersErrorCode } from "@/app/lib/user-actions/user-action-support.server";

interface FormErrorProps {
  readonly error: UsersErrorCode | null;
}

/** Renders the failure of a user form, or nothing without one. */
export function FormError({
  error,
}: FormErrorProps): React.ReactElement | null {
  const { t } = useTranslation();

  if (!error) {
    return null;
  }

  return (
    <p className="pages-selectable text-sm text-destructive" role="alert">
      {t(`users.error.${error}`)}
    </p>
  );
}
