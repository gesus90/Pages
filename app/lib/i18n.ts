import i18next from "i18next";
import { initReactI18next } from "react-i18next";

import germanTranslation from "@/language/locales/de/translation.json";
import englishTranslation from "@/language/locales/en/translation.json";

import type { Language } from "@/language/Language";
import type { i18n } from "i18next";

/** Creates a synchronous i18next instance for one rendered document. */
export function createI18n(language: Language): i18n {
  const instance = i18next.createInstance();

  void instance.use(initReactI18next).init({
    fallbackLng: "en",
    initAsync: false,
    interpolation: {
      escapeValue: false,
    },
    lng: language,
    resources: {
      de: { translation: germanTranslation },
      en: { translation: englishTranslation },
    },
  });

  return instance;
}
