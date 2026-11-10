import { LANGUAGE } from "@/language/Language";
import englishTranslation from "@/language/locales/en/translation.json";
import germanTranslation from "@/language/locales/de/translation.json";

import type {
  AgentInstructionTemplateInput,
  DefaultAgentTemplate,
} from "@/definition/AgentInstructionTemplate";
import type { Language } from "@/language/Language";

/**
 * The texts of a default template of `AGENT.md` in one language (PAGE-283).
 *
 * @param template - Coder, Designer or Manager.
 * @param language - The language of the person who reads the templates first.
 * @returns Name, short description and content from the language files.
 */
export function defaultAgentTemplateTexts(
  template: DefaultAgentTemplate,
  language: Language,
): AgentInstructionTemplateInput {
  const translation =
    language === LANGUAGE.ENGLISH ? englishTranslation : germanTranslation;
  const texts = translation.agentEmployees.templates[template];
  return {
    name: texts.label,
    description: texts.description,
    content: texts.content,
  };
}
