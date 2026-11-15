import { useEffect, useState } from "react";

import { DocumentReadError, readDocument } from "./read-document";

import type { DocumentFormat } from "./document-kinds";
import type { ReadDocument } from "./document-model";
import type { DocumentFailure } from "./read-document";

/** Documents read during this visit, by address, so a card and its panel share one download. */
const readings = new Map<string, Promise<ReadDocument>>();
/** How many read documents stay in memory. */
const KEPT_READINGS = 6;

/** The state of a document a card or panel shows. */
export type DocumentState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly document: ReadDocument }
  | { readonly status: "failed"; readonly reason: DocumentFailure };

/** What is read: the address of the original, its format and its name. */
export interface DocumentSource {
  readonly url: string;
  readonly format: DocumentFormat;
  readonly name: string;
}

async function load(source: DocumentSource): Promise<ReadDocument> {
  const response = await fetch(source.url);
  if (!response.ok) throw new DocumentReadError("unreadable");
  return readDocument(new Uint8Array(await response.arrayBuffer()), source);
}

/**
 * Reads a document once per visit; a failed reading is forgotten, so the
 * next opening tries again.
 *
 * @param source - The document.
 */
export function readOnce(source: DocumentSource): Promise<ReadDocument> {
  const known = readings.get(source.url);
  if (known) return known;
  const reading = load(source);
  readings.set(source.url, reading);
  reading.catch(() => readings.delete(source.url));
  if (readings.size > KEPT_READINGS) {
    const [oldest] = readings.keys();
    if (oldest !== undefined) readings.delete(oldest);
  }
  return reading;
}

/** Forgets every read document, for tests. */
export function resetDocumentReadings(): void {
  readings.clear();
}

/**
 * The readable view of a document (PAGE-385). The original loads only once
 * the card is expanded or opened, and only once per visit.
 *
 * @param source - The document.
 * @param isWanted - Whether the view is shown; nothing loads before.
 */
export function useDocument(
  source: DocumentSource,
  isWanted: boolean,
): DocumentState {
  const [state, setState] = useState<DocumentState>({ status: "loading" });
  const { url, format, name } = source;

  useEffect(() => {
    if (!isWanted) return undefined;
    let isCurrent = true;
    readOnce({ url, format, name }).then(
      (document) => {
        if (isCurrent) setState({ status: "ready", document });
      },
      (error: unknown) => {
        if (!isCurrent) return;
        setState({
          status: "failed",
          reason:
            error instanceof DocumentReadError ? error.reason : "unreadable",
        });
      },
    );
    return () => {
      isCurrent = false;
    };
  }, [isWanted, url, format, name]);

  return state;
}

/**
 * The addresses of the embedded images of a document, created as `blob:`
 * addresses for as long as the view is shown.
 *
 * @param images - The images by their ID.
 * @returns The addresses by image ID; empty until they exist.
 */
export function useDocumentImages(
  images: ReadonlyMap<string, Blob> | undefined,
): ReadonlyMap<string, string> {
  const [addresses, setAddresses] = useState<ReadonlyMap<string, string>>(
    new Map(),
  );

  useEffect(() => {
    if (!images || images.size === 0) return undefined;
    const created = new Map<string, string>();
    for (const [id, blob] of images) created.set(id, URL.createObjectURL(blob));
    setAddresses(created);
    return () => {
      for (const address of created.values()) URL.revokeObjectURL(address);
    };
  }, [images]);

  return addresses;
}
