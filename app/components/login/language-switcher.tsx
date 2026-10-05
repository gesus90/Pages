import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSubmit } from "react-router";

import { Select } from "@/app/components/ui/select";
import { LANGUAGE } from "@/language/Language";

import type { Language } from "@/language/Language";

interface LanguageSwitcherProps {
  readonly language: Language;
}

/** Renders a compact language switcher that persists its choice for anonymous visitors. */
export function LanguageSwitcher({
  language: initialLanguage,
}: LanguageSwitcherProps): React.ReactElement {
  const { t } = useTranslation();
  const submit = useSubmit();
  const [language, setLanguage] = useState<Language>(initialLanguage);

  function handleChange(nextLanguage: Language): void {
    setLanguage(nextLanguage);

    const formData = new FormData();
    formData.set("redirectTo", "/login");
    formData.set("language", nextLanguage);
    void submit(formData, { action: "/set-language", method: "post" });
  }

  return (
    <Select
      id="login-language"
      ariaLabel={t("settings.language.label")}
      value={language}
      onValueChange={handleChange}
      className="h-9 min-w-20 cursor-pointer"
      options={[
        { value: LANGUAGE.GERMAN, label: "DE" },
        { value: LANGUAGE.ENGLISH, label: "EN" },
      ]}
    />
  );
}
