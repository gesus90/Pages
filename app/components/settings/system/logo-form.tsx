import { useTranslation } from "react-i18next";
import { Form, useNavigation, useSubmit } from "react-router";

import { useActionOutcome } from "@/app/components/settings/use-action-outcome";
import { Button } from "@/app/components/ui/button";
import { MAXIMUM_LOGO_BYTES } from "@/definition/Instance";

import type { FormEvent } from "react";

interface LogoFormProps {
  /** Address of the stored logo, or `null` without one. */
  readonly logoUrl: string | null;
}

const ACCEPTED_LOGO_TYPES = "image/png,image/jpeg,image/webp,image/svg+xml";
const MAXIMUM_LOGO_MEGABYTES = MAXIMUM_LOGO_BYTES / (1024 * 1024);

function LogoRemoval(): React.ReactElement {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const isRemoving = navigation.formData?.get("intent") === "remove-logo";

  return (
    <Form method="post">
      <input type="hidden" name="intent" value="remove-logo" />
      <Button type="submit" variant="outline" disabled={isRemoving}>
        {t("settings.system.instance.removeLogo")}
      </Button>
    </Form>
  );
}

/** Uploads, shows, and removes the company logo. */
export function LogoForm({ logoUrl }: LogoFormProps): React.ReactElement {
  const { t } = useTranslation();
  const outcome = useActionOutcome("update-logo");
  const removal = useActionOutcome("remove-logo");
  const navigation = useNavigation();
  const submit = useSubmit();
  const isUploading = navigation.formData?.get("intent") === "update-logo";

  function handleUpload(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void submit(new FormData(event.currentTarget), {
      encType: "multipart/form-data",
      method: "post",
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground" id="company-logo-label">
        {t("settings.system.instance.logo")}
      </p>
      <div className="flex min-h-16 items-center rounded-xl bg-muted/40 px-4 py-3">
        {logoUrl ? (
          <img
            alt={t("settings.system.instance.logoPreview")}
            className="max-h-12 max-w-full object-contain"
            src={logoUrl}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("settings.system.instance.noLogo")}
          </p>
        )}
      </div>
      <form encType="multipart/form-data" method="post" onSubmit={handleUpload}>
        <input type="hidden" name="intent" value="update-logo" />
        <div className="flex flex-wrap items-center gap-2">
          <input
            accept={ACCEPTED_LOGO_TYPES}
            aria-describedby="company-logo-hint"
            aria-labelledby="company-logo-label"
            className="min-w-0 flex-1 text-sm text-foreground file:mr-3 file:rounded-lg file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground"
            name="logo"
            type="file"
          />
          <Button type="submit" disabled={isUploading}>
            {t("settings.system.instance.upload")}
          </Button>
        </div>
      </form>
      <p
        className="text-xs leading-relaxed text-muted-foreground"
        id="company-logo-hint"
      >
        {t("settings.system.instance.logoHint", {
          size: MAXIMUM_LOGO_MEGABYTES,
        })}
      </p>
      {logoUrl ? <LogoRemoval /> : null}
      {outcome?.ok === true ? (
        <p className="text-sm text-success" role="status">
          {t("settings.system.instance.logoSaved")}
        </p>
      ) : null}
      {outcome?.ok === false ? (
        <p className="text-sm text-destructive" role="alert">
          {t(`settings.system.instance.logoError.${outcome.error}`, {
            size: MAXIMUM_LOGO_MEGABYTES,
          })}
        </p>
      ) : null}
      {removal?.ok === true ? (
        <p className="text-sm text-success" role="status">
          {t("settings.system.instance.logoRemoved")}
        </p>
      ) : null}
      {removal?.ok === false ? (
        <p className="text-sm text-destructive" role="alert">
          {t("settings.system.instance.logoError.general")}
        </p>
      ) : null}
    </div>
  );
}
