import { Eye, EyeOff } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PasswordVisibilityToggleProps {
  readonly isPasswordVisible: boolean;
  readonly onToggle: () => void;
}

/** Renders the button that shows or hides the typed password. */
export function PasswordVisibilityToggle({
  isPasswordVisible,
  onToggle,
}: PasswordVisibilityToggleProps): React.ReactElement {
  const { t } = useTranslation();

  return (
    <button
      className="absolute top-1/2 right-3 inline-flex size-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-xl text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
      type="button"
      aria-label={
        isPasswordVisible ? t("login.hidePassword") : t("login.showPassword")
      }
      aria-pressed={isPasswordVisible}
      onClick={onToggle}
    >
      {isPasswordVisible ? (
        <EyeOff className="size-5" aria-hidden="true" />
      ) : (
        <Eye className="size-5" aria-hidden="true" />
      )}
    </button>
  );
}
