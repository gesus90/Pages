import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { Select } from "@/app/components/ui/select";
import { readAgentObject } from "@/backend/agents/AgentPayload";
import {
  assistantApi,
  assistantErrorCode,
  AssistantClientError,
} from "@/app/lib/text-assistant-client";

import type { AgentProfileChoice } from "@/definition/AgentProfile";
import type { AssistantFormState } from "./assistant-form";

/** Validates the small, credential-free selection response without exposing other metadata. */
export function readAssistantProfileChoices(
  input: unknown,
): AgentProfileChoice[] {
  if (!Array.isArray(input)) throw new AssistantClientError("invalidOutput");
  return input.map((entry: unknown) => {
    const profile = readAgentObject(entry);
    if (
      typeof profile.id !== "string" ||
      typeof profile.name !== "string" ||
      typeof profile.model !== "string" ||
      (profile.reasoningEffort !== null &&
        typeof profile.reasoningEffort !== "string")
    )
      throw new AssistantClientError("invalidOutput");
    return {
      id: profile.id,
      name: profile.name,
      model: profile.model,
      reasoningEffort: profile.reasoningEffort,
    };
  });
}

/** Opening the assistant reads authorized choices; selecting never invokes a provider. */
export function AssistantProfileField(props: {
  readonly state: AssistantFormState;
  readonly isRunning: boolean;
  readonly onChange: (state: AssistantFormState) => void;
}): React.ReactElement {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<readonly AgentProfileChoice[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const purpose = props.state.action === "chat" ? "chat" : "text";
  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setProfiles([]);
    setError("");
    async function load(): Promise<void> {
      try {
        const response = await assistantApi(
          { intent: "profiles", purpose },
          controller.signal,
        );
        if (!controller.signal.aborted)
          setProfiles(readAssistantProfileChoices(response.profiles));
      } catch (failure: unknown) {
        if (!controller.signal.aborted) setError(assistantErrorCode(failure));
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [purpose]);
  const { state, onChange } = props;
  useEffect(() => {
    if (!state.profileId && profiles.length === 1)
      onChange({ ...state, profileId: profiles[0].id });
  }, [profiles, state, onChange]);
  const selected = state.profileId ?? "";
  const unavailable =
    selected && !profiles.some((profile) => profile.id === selected);
  const options = [
    { value: "", label: t("assistant.chooseProfile") },
    ...profiles.map((profile) => ({
      value: profile.id,
      label: `${profile.name} · ${profile.model}${profile.reasoningEffort ? ` · ${profile.reasoningEffort}` : ""}`,
    })),
    ...(unavailable
      ? [
          {
            value: selected,
            label: t("assistant.settings.unavailable"),
            disabled: true,
          },
        ]
      : []),
  ];
  return (
    <div className="space-y-2">
      <label htmlFor="assistant-profile" className="block text-sm">
        {t("assistant.profile")}
      </label>
      <Select
        id="assistant-profile"
        ariaLabel={t("assistant.profile")}
        value={selected}
        options={options}
        disabled={props.isRunning || isLoading}
        onValueChange={(profileId) =>
          onChange({ ...state, profileId: profileId || null })
        }
      />
      {!isLoading && profiles.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {t(error ? `assistant.error.${error}` : "assistant.noProfiles")}
        </p>
      ) : null}
    </div>
  );
}
