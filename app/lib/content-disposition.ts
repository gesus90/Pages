/**
 * Builds a `Content-Disposition` header value for a download or an inline file.
 *
 * @param disposition - `attachment` to download, `inline` to show.
 * @param fileName - Name of the file as shown to the person.
 * @returns A header value with an ASCII fallback name and the full name in the
 * form RFC 5987 defines, so umlauts and other characters survive.
 */
export function contentDisposition(
  disposition: "attachment" | "inline",
  fileName: string,
): string {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
