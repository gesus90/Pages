import { useTranslation } from "react-i18next";
import { Form, useLoaderData, useSubmit } from "react-router";

import { PageContent } from "@/app/components/ui/card";
import { Select } from "@/app/components/ui/select";
import { authenticatedUserContext } from "@/app/lib/auth.server";
import { getApplicationServices } from "@/app/lib/services.server";
import { isLanguage, LANGUAGE } from "@/language/Language";

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import type { Language } from "@/language/Language";

interface SettingsLoaderData {
  readonly language: Language;
}

/** Loads the personal settings of the authenticated visitor. */
export async function loader({
  context,
}: LoaderFunctionArgs): Promise<SettingsLoaderData> {
  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Error("Authenticated middleware did not provide a user.");
  }

  const services = await getApplicationServices();
  const settings = await services.settingsService.getUserSettings(user.id);

  return { language: settings.language };
}

/** Persists a change to the authenticated visitor's personal settings. */
export async function action({
  request,
  context,
}: ActionFunctionArgs): Promise<null> {
  if (request.method !== "POST") {
    throw new Response("Method Not Allowed", {
      headers: { Allow: "POST" },
      status: 405,
    });
  }

  const user = context.get(authenticatedUserContext);

  if (!user) {
    throw new Response("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const language = formData.get("language");

  if (!isLanguage(language)) {
    throw new Response("Bad Request", { status: 400 });
  }

  const services = await getApplicationServices();
  await services.settingsService.updateLanguage(user.id, language);

  return null;
}

/** Renders the compact, minimal Pages settings screen. */
export default function SettingsRoute(): React.ReactElement {
  const { t } = useTranslation();
  const { language } = useLoaderData<typeof loader>();
  const submit = useSubmit();

  function handleLanguageChange(nextLanguage: string): void {
    const formData = new FormData();
    formData.set("language", nextLanguage);
    void submit(formData, { method: "post" });
  }

  return (
    <PageContent>
      <div className="mx-auto max-w-2xl">
        <h1 className="select-none text-2xl font-semibold tracking-tight text-foreground xl:text-xl">
          {t("settings.title")}
        </h1>

        <div className="mt-8 pt-6">
          <h2 className="select-none text-sm font-semibold text-foreground">
            {t("settings.language.label")}
          </h2>
          <Form className="mt-3" method="post">
            <input name="language" type="hidden" value={language} />
            <Select
              id="settings-language"
              ariaLabel={t("settings.language.label")}
              value={language}
              onValueChange={handleLanguageChange}
              className="max-w-64"
              options={[
                { value: LANGUAGE.GERMAN, label: t("settings.language.de") },
                {
                  value: LANGUAGE.ENGLISH,
                  label: t("settings.language.en"),
                },
              ]}
            />
          </Form>
        </div>
      </div>
    </PageContent>
  );
}
