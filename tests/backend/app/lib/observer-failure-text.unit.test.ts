import { createInstance } from "i18next";
import { expect, it } from "vitest";

import { observerFailureText } from "@/app/lib/observer-failure-text";

it("uses a translated failure code and names unknown codes in the fallback", async () => {
  const translations = createInstance();
  await translations.init({
    lng: "en",
    resources: {
      en: {
        translation: {
          conversationObserver: {
            code: { timeout: "Timed out" },
            unknownCode: "Unknown: {{code}}",
          },
        },
      },
    },
  });
  expect(observerFailureText(translations.t, { code: "timeout" })).toBe(
    "Timed out",
  );
  expect(observerFailureText(translations.t, { code: "new-code" })).toBe(
    "Unknown: new-code",
  );
});
