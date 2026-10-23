import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFetcher } from "react-router";

import { showSuccessToast } from "@/app/components/ui/toast";
import {
  buildPicaMobileAddress,
  parsePicaMobilePort,
} from "@/definition/PicaMobile";

import type { FormEvent } from "react";
import type {
  PicaMobilePortError,
  PicaMobilePortResult,
  PicaMobileSettingsView,
} from "@/definition/PicaMobile";

/** State and actions of the Pica Mobile port form. */
export interface PicaMobilePortForm {
  readonly text: string;
  readonly address: string;
  readonly pending: boolean;
  readonly canSave: boolean;
  /** What is wrong with the typed or submitted port; `null` when nothing is. */
  readonly error: PicaMobilePortError | null;
  readonly changeText: (text: string) => void;
  readonly submit: (event: FormEvent<HTMLFormElement>) => void;
}

/** Reads what went wrong with the last submission; a refused request counts as a general failure. */
function readSubmitFailure(
  answer: { picaMobile?: PicaMobilePortResult; error?: string } | undefined,
): PicaMobilePortError | null {
  if (answer?.picaMobile && !answer.picaMobile.ok) {
    return answer.picaMobile.error;
  }

  return answer?.error ? "general" : null;
}

/** Validates the typed port, previews its address and saves it through the route action. */
export function usePicaMobilePort(
  settings: PicaMobileSettingsView,
): PicaMobilePortForm {
  const { t } = useTranslation();
  const fetcher = useFetcher<{
    picaMobile?: PicaMobilePortResult;
    error?: string;
  }>();
  const [text, setText] = useState(settings.port?.toString() ?? "");
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  const isSaving = useRef(false);
  const port = parsePicaMobilePort(text);
  const pending = fetcher.state !== "idle";
  const submitFailure = readSubmitFailure(fetcher.data);

  useEffect(() => {
    if (fetcher.state !== "idle") {
      isSaving.current = true;
      return;
    }

    if (!isSaving.current) {
      return;
    }

    isSaving.current = false;

    if (fetcher.data?.picaMobile?.ok) {
      showSuccessToast(t("settings.connections.picaMobile.saved"));
    }
  }, [fetcher.state, fetcher.data, t]);

  function readError(): PicaMobilePortError | null {
    if (text.trim() !== "" && port === null) {
      return "invalidPort";
    }

    return submittedText === text ? submitFailure : null;
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (port === null) {
      return;
    }

    const form = new FormData();

    form.set("intent", "update-pica-mobile-port");
    form.set("port", String(port));
    setSubmittedText(text);
    void fetcher.submit(form, { method: "post" });
  }

  return {
    text,
    address:
      port !== null && settings.host !== null
        ? buildPicaMobileAddress(settings.host, port)
        : "",
    pending,
    canSave: port !== null && (port !== settings.port || !settings.isListening),
    error: readError(),
    changeText: setText,
    submit,
  };
}
