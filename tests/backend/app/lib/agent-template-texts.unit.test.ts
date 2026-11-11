import { expect, it } from "vitest";

import { defaultAgentTemplateTexts } from "@/app/lib/agent-template-texts.server";
import { DEFAULT_AGENT_TEMPLATES } from "@/definition/AgentInstructionTemplate";
import { LANGUAGE } from "@/language/Language";
import english from "@/language/locales/en/translation.json";
import german from "@/language/locales/de/translation.json";

it("returns the selected default template in the requested language", () => {
  for (const template of DEFAULT_AGENT_TEMPLATES) {
    for (const [language, translations] of [
      [LANGUAGE.ENGLISH, english],
      [LANGUAGE.GERMAN, german],
    ] as const) {
      const expected = translations.agentEmployees.templates[template];
      expect(defaultAgentTemplateTexts(template, language)).toEqual({
        name: expected.label,
        description: expected.description,
        content: expected.content,
      });
    }
  }
});
