import { Globe } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { SettingsCard } from "@/app/components/settings/settings-layout";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";

const EMBED_DOMAINS_ADDRESS = "/settings-api/embed-domains";

type EmbedDomainsError = "invalid" | "failed";

interface EmbedDomains {
  /** `null` until the list arrived. */
  readonly domains: readonly string[] | null;
  readonly error: EmbedDomainsError | null;
  readonly isSaving: boolean;
  /** Releases a domain or takes the release back; resolves to the success. */
  setReleased(domain: string, isReleased: boolean): Promise<boolean>;
}

/** The released domains out of an answer of the server, when it has them. */
function readDomains(body: unknown): readonly string[] | null {
  if (typeof body !== "object" || body === null || !("domains" in body))
    return null;
  const { domains } = body;
  if (!Array.isArray(domains)) return null;
  return domains.filter((domain) => typeof domain === "string");
}

async function requestDomains(init?: RequestInit): Promise<{
  readonly status: number;
  readonly domains: readonly string[] | null;
}> {
  const response = await fetch(EMBED_DOMAINS_ADDRESS, {
    ...init,
    credentials: "same-origin",
  });
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, domains: readDomains(body) };
}

/** Loads the domains released for every conversation and changes them. */
function useEmbedDomains(): EmbedDomains {
  const [domains, setDomains] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<EmbedDomainsError | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isCurrent = true;
    async function load(): Promise<void> {
      try {
        const answer = await requestDomains();
        if (!isCurrent) return;
        if (answer.domains === null) setError("failed");
        else setDomains(answer.domains);
      } catch (caughtError: unknown) {
        console.error("Loading the embed domains failed", caughtError);
        if (isCurrent) setError("failed");
      }
    }
    void load();
    return (): void => {
      isCurrent = false;
    };
  }, []);

  async function setReleased(
    domain: string,
    isReleased: boolean,
  ): Promise<boolean> {
    const formData = new FormData();
    formData.set("domain", domain);
    formData.set("isReleased", String(isReleased));
    setIsSaving(true);
    setError(null);
    try {
      const answer = await requestDomains({ method: "POST", body: formData });
      if (answer.domains !== null) setDomains(answer.domains);
      if (answer.status === 200) return true;
      setError(answer.status === 400 ? "invalid" : "failed");
      return false;
    } catch (caughtError: unknown) {
      console.error("Saving the embed domain failed", caughtError);
      setError("failed");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  return { domains, error, isSaving, setReleased };
}

function DomainList({
  state,
}: {
  readonly state: EmbedDomains;
}): React.ReactElement {
  const { t } = useTranslation();
  if (state.domains === null)
    return (
      <p className="text-sm text-muted-foreground">
        {state.error === null ? t("settings.embedDomains.loading") : null}
      </p>
    );
  if (state.domains.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {t("settings.embedDomains.empty")}
      </p>
    );
  return (
    <ul
      aria-label={t("settings.embedDomains.list")}
      className="flex flex-col gap-1.5"
    >
      {state.domains.map((domain) => (
        <li
          className="flex items-center gap-3 rounded-lg bg-muted py-1.5 pr-1.5 pl-3"
          key={domain}
        >
          <span className="min-w-0 flex-1 truncate text-sm text-foreground">
            {domain}
          </span>
          <Button
            aria-label={t("settings.embedDomains.removeDomain", { domain })}
            disabled={state.isSaving}
            onClick={() => void state.setReleased(domain, false)}
            size="sm"
            type="button"
            variant="outline"
          >
            {t("settings.embedDomains.remove")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The domains an administrator released for embedding in every conversation
 * (PAGE-298), with a field that releases another host name.
 *
 * @remarks
 * Members release further domains per conversation in the chat itself.
 * Pages and local previews can always be embedded and are not listed.
 */
export function EmbedDomainsCard(): React.ReactElement {
  const { t } = useTranslation();
  const state = useEmbedDomains();
  const [hostName, setHostName] = useState("");

  async function release(): Promise<void> {
    const domain = hostName.trim();
    if (domain === "") return;
    if (await state.setReleased(domain, true)) setHostName("");
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void release();
  }

  return (
    <SettingsCard
      className="min-w-0"
      description={t("settings.embedDomains.description")}
      icon={<Globe aria-hidden="true" className="size-4" />}
      title={t("settings.embedDomains.title")}
    >
      <DomainList state={state} />
      <form
        className="mt-4 flex flex-wrap items-end gap-2"
        noValidate
        onSubmit={handleSubmit}
      >
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-sm text-muted-foreground">
            {t("settings.embedDomains.hostName")}
          </span>
          <Input
            autoCapitalize="none"
            autoComplete="off"
            onChange={(event) => setHostName(event.target.value)}
            placeholder={t("settings.embedDomains.placeholder")}
            spellCheck={false}
            type="text"
            value={hostName}
          />
        </label>
        <Button
          disabled={state.isSaving || hostName.trim() === ""}
          type="submit"
        >
          {t("settings.embedDomains.release")}
        </Button>
      </form>
      {state.error === null ? null : (
        <p className="mt-2 text-sm text-destructive" role="alert">
          {t(`settings.embedDomains.error.${state.error}`)}
        </p>
      )}
    </SettingsCard>
  );
}
