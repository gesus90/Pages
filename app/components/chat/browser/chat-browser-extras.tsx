import { Download, Save, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { picaBrowserDownloadUrl } from "@/app/lib/pica-browser-client";
import { picaBrowserSessionName } from "@/definition/PicaBrowser";

import type { ChatBrowsers } from "./use-chat-browser";
import type { PicaBrowserView } from "@/definition/PicaBrowser";

interface ChatBrowserExtrasProps {
  readonly browser: PicaBrowserView;
  readonly controller: ChatBrowsers;
}

/** The form that saves the signed-in session of a browser under a name. */
function SaveSessionForm({
  browser,
  controller,
}: ChatBrowserExtrasProps): React.ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const isNameValid = picaBrowserSessionName.safeParse(name).success;

  function save(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!isNameValid) return;
    void controller.command(browser.browserId, {
      command: "saveSession",
      name,
    });
    setName("");
  }

  return (
    <form onSubmit={save} className="flex items-center gap-1.5">
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        aria-label={t("chat.browser.sessionName")}
        placeholder={t("chat.browser.sessionName")}
        maxLength={60}
        size="sm"
      />
      <Button type="submit" size="xs" variant="outline" disabled={!isNameValid}>
        <Save aria-hidden="true" className="size-3.5" />
        {t("chat.browser.saveSession")}
      </Button>
    </form>
  );
}

/** The saved sessions of the person, each with a button that deletes it. */
function SavedSessions({
  browser,
  controller,
}: ChatBrowserExtrasProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (controller.savedSessions.length === 0) return null;
  return (
    <ul aria-label={t("chat.browser.savedSessions")} className="space-y-0.5">
      {controller.savedSessions.map((saved) => (
        <li
          key={saved.name}
          className="flex items-center justify-between gap-2"
        >
          <span className="min-w-0 truncate" title={saved.origins.join(", ")}>
            {saved.name}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t("chat.browser.deleteSession", { name: saved.name })}
            onClick={() =>
              void controller.command(browser.browserId, {
                command: "deleteSession",
                name: saved.name,
              })
            }
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** The files the browser downloaded; they stay on the server until the administrator fetches them. */
function BrowserDownloads({
  browser,
}: Pick<ChatBrowserExtrasProps, "browser">): React.ReactElement | null {
  const { t } = useTranslation();
  if (browser.downloads.length === 0) return null;
  return (
    <ul aria-label={t("chat.browser.downloads")} className="space-y-0.5">
      {browser.downloads.map((file) => (
        <li key={file.id}>
          <a
            href={picaBrowserDownloadUrl(browser.browserId, file.id)}
            download={file.fileName}
            className="inline-flex items-center gap-1 text-primary-text hover:underline"
          >
            <Download aria-hidden="true" className="size-3.5" />
            {file.fileName}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Approval of changes to local services, saved sessions and downloads of one browser. */
export function ChatBrowserExtras({
  browser,
  controller,
}: ChatBrowserExtrasProps): React.ReactElement | null {
  const { t } = useTranslation();
  if (browser.state === "stopped") return null;
  return (
    <details className="space-y-2 text-xs">
      <summary className="cursor-pointer font-medium text-muted-foreground">
        {t("chat.browser.options")}
      </summary>
      <label className="mt-2 flex items-start gap-2">
        <input
          type="checkbox"
          checked={browser.areLocalWritesApproved}
          onChange={(event) =>
            void controller.command(browser.browserId, {
              command: "approveLocalWrites",
              approved: event.target.checked,
            })
          }
          className="mt-0.5"
        />
        <span>{t("chat.browser.approveWrites")}</span>
      </label>
      <SaveSessionForm browser={browser} controller={controller} />
      <SavedSessions browser={browser} controller={controller} />
      <BrowserDownloads browser={browser} />
    </details>
  );
}
