import { useEffect, useState } from "react";
import { createInstance } from "i18next";
import { I18nextProvider, initReactI18next } from "react-i18next";

import { de } from "./locales/de";
import { en } from "./locales/en";

import type { ReactNode } from "react";
import type { i18n as I18nInstance } from "i18next";
import type { Language } from "./language";

interface I18nProviderProps {
  readonly language: Language;
  readonly children: ReactNode;
}

function createI18n(language: Language): I18nInstance {
  const instance = createInstance();

  // Both languages are bundled, so the initialization finishes synchronously.
  void instance.use(initReactI18next).init({
    initAsync: false,
    lng: language,
    fallbackLng: "en",
    resources: { de: { translation: de }, en: { translation: en } },
    interpolation: { escapeValue: false },
  });

  return instance;
}

/**
 * Provides the translations of the chosen language to the app.
 *
 * @remarks
 * The instance belongs to the provider, so tests and previews never share one.
 */
export function I18nProvider({
  language,
  children,
}: I18nProviderProps): React.ReactElement {
  const [instance] = useState(() => createI18n(language));

  useEffect(() => {
    void instance.changeLanguage(language);
  }, [instance, language]);

  return <I18nextProvider i18n={instance}>{children}</I18nextProvider>;
}
