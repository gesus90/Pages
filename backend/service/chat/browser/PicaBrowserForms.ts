import { redactCredentials } from "@/backend/security/AgentTextSafety";

import { PicaAdminError } from "../admin/PicaAdminContracts";
import { click, labelOf, locateElement } from "./PicaBrowserActions";
import { settlePage } from "./PicaBrowserObservation";
import {
  activeIsSecretScript,
  fieldKindScript,
  isSecretScript,
} from "./PicaBrowserPageScript";

import type { z } from "zod";
import type {
  PICA_BROWSER_SCHEMAS,
  PicaBrowserFormField,
} from "./PicaBrowserContracts";
import type { PicaBrowserElement } from "./PicaBrowserActions";
import type { PicaBrowserSession } from "./PicaBrowserSession";

type TypeInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_type>;
type FormInput = z.infer<typeof PICA_BROWSER_SCHEMAS.browser_form>;

/** A file to put into an upload field. */
export interface PicaBrowserUploadFile {
  readonly name: string;
  readonly mimeType: string;
  readonly buffer: Buffer;
}

function requireCredentialFree(text: string): void {
  // Credentials belong to the administrator's own typing in the takeover, never to a tool call.
  if (redactCredentials(text) !== text)
    throw new PicaAdminError("CREDENTIAL_DENIED");
}

async function requireOpenField(element: PicaBrowserElement): Promise<void> {
  if (await element.evaluate(isSecretScript))
    throw new PicaAdminError("CREDENTIAL_DENIED");
}

/**
 * Types text into a field or into the focused element.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 * @throws {PicaAdminError} `CREDENTIAL_DENIED` for a secret field or text that looks like a credential.
 */
export async function typeText(
  session: PicaBrowserSession,
  input: TypeInput,
): Promise<string> {
  requireCredentialFree(input.text);
  const page = session.activePage();
  if (input.ref) {
    const element = await locateElement(session, input.ref);
    await requireOpenField(element);
    if (input.clear) {
      await element.fill(input.text, { timeout: 6000 });
    } else {
      await element.focus();
      await page.keyboard.press("ControlOrMeta+End");
      await page.keyboard.type(input.text);
    }
  } else {
    if (await page.evaluate(activeIsSecretScript))
      throw new PicaAdminError("CREDENTIAL_DENIED");
    if (input.clear) {
      await page.keyboard.press("ControlOrMeta+A");
      await page.keyboard.press("Delete");
    }
    await page.keyboard.type(input.text);
  }
  if (input.submit) await page.keyboard.press("Enter");
  await settlePage(page);
  const target = input.ref
    ? labelOf(session, input.ref)
    : "the focused element";
  return `Typed "${redactCredentials(input.text).slice(0, 60)}" into ${target}`;
}

async function fillField(
  session: PicaBrowserSession,
  field: PicaBrowserFormField,
): Promise<void> {
  const element = await locateElement(session, field.ref);
  const kind = await element.evaluate(fieldKindScript);
  if (kind === "file") throw new PicaAdminError("USE_UPLOAD");
  if (kind === "checkbox" || kind === "radio") {
    await element.setChecked(field.checked ?? true, { timeout: 5000 });
    return;
  }
  if (kind === "select") {
    const option = field.option ?? field.text;
    if (option === undefined) throw new PicaAdminError("OPTION_REQUIRED");
    await element
      .selectOption({ label: option }, { timeout: 5000 })
      .catch(() => element.selectOption({ value: option }, { timeout: 5000 }));
    return;
  }
  if (field.text === undefined) throw new PicaAdminError("TEXT_REQUIRED");
  requireCredentialFree(field.text);
  await requireOpenField(element);
  await element.fill(field.text, { timeout: 6000 });
}

/**
 * Fills several form fields in order and optionally submits the form.
 *
 * @param session - The browser.
 * @param input - The validated tool input.
 * @returns A short description for the action log.
 */
export async function fillForm(
  session: PicaBrowserSession,
  input: FormInput,
): Promise<string> {
  for (const field of input.fields) await fillField(session, field);
  const page = session.activePage();
  if (input.submit === "enter") {
    await page.keyboard.press("Enter");
    await settlePage(page);
  } else if (input.submit) {
    await click(session, { browserId: session.id, ref: input.submit });
  }
  return `Filled ${input.fields.length} field(s)${input.submit ? " and submitted" : ""}`;
}

/**
 * Puts a file into an upload field, or into the chooser a button opens.
 *
 * @param session - The browser.
 * @param ref - The reference of the file field or of the button that opens the chooser.
 * @param file - The file chosen by Pages from the handover folder or from a download.
 * @returns A short description for the action log.
 */
export async function uploadFile(
  session: PicaBrowserSession,
  ref: string,
  file: PicaBrowserUploadFile,
): Promise<string> {
  const page = session.activePage();
  const element = await locateElement(session, ref);
  const kind = await element.evaluate(fieldKindScript);
  const payload = {
    name: file.name,
    mimeType: file.mimeType,
    buffer: file.buffer,
  };
  if (kind === "file") {
    await element.setInputFiles(payload, { timeout: 6000 });
  } else {
    const [chooser] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 6000 }),
      element.click({ timeout: 6000 }),
    ]);
    await chooser.setFiles(payload);
  }
  await settlePage(page);
  return `Uploaded "${file.name}" to ${labelOf(session, ref)}`;
}
