import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { FieldLabel } from "@/app/components/projects/integration-fields";
import { Input } from "@/app/components/ui/input";

interface GitHubTokenFieldProps {
  readonly hasStoredToken: boolean;
  readonly token: string;
  readonly onTokenChange: (token: string) => void;
}

interface TokenInputProps {
  readonly token: string;
  readonly onTokenChange: (token: string) => void;
}

function TokenInput({
  token,
  onTokenChange,
}: TokenInputProps): React.ReactElement {
  const { t } = useTranslation();
  const [isTokenVisible, setIsTokenVisible] = useState(false);

  function handleChange(event: React.ChangeEvent<HTMLInputElement>): void {
    onTokenChange(event.currentTarget.value);
  }

  function handleToggleVisibility(): void {
    setIsTokenVisible((previous) => !previous);
  }

  return (
    <div className="relative">
      <Input
        autoComplete="off"
        className="h-10 pr-11 text-sm xl:h-10 xl:text-sm"
        id="github-token"
        name="token"
        onChange={handleChange}
        placeholder="ghp_••••••••••••••••••••"
        type={isTokenVisible ? "text" : "password"}
        value={token}
      />
      <button
        aria-label={
          isTokenVisible
            ? t("projectDetail.interfaces.hideToken")
            : t("projectDetail.interfaces.showToken")
        }
        className="absolute top-1/2 right-2 inline-flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        onClick={handleToggleVisibility}
        type="button"
      >
        {isTokenVisible ? (
          <EyeOff className="size-4" aria-hidden="true" />
        ) : (
          <Eye className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

function StoredTokenNotice({
  onReplace,
}: {
  readonly onReplace: () => void;
}): React.ReactElement {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-2">
      <Input
        aria-hidden="true"
        autoComplete="off"
        className="pointer-events-none h-10 text-sm select-none xl:h-10 xl:text-sm"
        id="github-token"
        name="token"
        readOnly
        tabIndex={-1}
        type="password"
        value="•••••••••••••••"
      />
      <p className="text-xs font-semibold text-emerald-700">
        {t("projectDetail.integrations.tokenSet")}
      </p>
      <button
        className="cursor-pointer self-start rounded-lg bg-muted px-3 py-1.5 text-xs font-semibold text-foreground outline-none transition-colors hover:bg-sidebar-hover focus-visible:ring-2 focus-visible:ring-primary"
        onClick={onReplace}
        type="button"
      >
        {t("projectDetail.integrations.replaceToken")}
      </button>
    </div>
  );
}

/**
 * The token section of the GitHub panel.
 *
 * @remarks
 * A stored token is never sent to the client: the field shows a placeholder
 * until the visitor chooses to replace it, and an empty field keeps it.
 */
export function GitHubTokenField({
  hasStoredToken,
  token,
  onTokenChange,
}: GitHubTokenFieldProps): React.ReactElement {
  const { t } = useTranslation();
  const [isReplacing, setIsReplacing] = useState(false);

  function handleReplace(): void {
    setIsReplacing(true);
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">
        {t("projectDetail.interfaces.authentication")}
      </h3>
      <div className="flex flex-col gap-1.5">
        <FieldLabel htmlFor="github-token">
          {t("projectDetail.integrations.token")}
        </FieldLabel>
        {!hasStoredToken || isReplacing ? (
          <TokenInput onTokenChange={onTokenChange} token={token} />
        ) : (
          <StoredTokenNotice onReplace={handleReplace} />
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t("projectDetail.interfaces.tokenHelp")}
        </p>
      </div>
    </section>
  );
}
