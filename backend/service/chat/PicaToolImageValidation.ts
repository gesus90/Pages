/** Checks encoded image bounds and actual PNG or JPEG signatures. */
export function isValidPicaToolImage(image: {
  readonly mimeType: string;
  readonly data: string;
}): boolean {
  if (
    image.data.length < 4 ||
    image.data.length > 8_000_000 ||
    image.data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      image.data,
    )
  )
    return false;
  const bytes = Buffer.from(image.data, "base64");
  const png =
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    bytes.length >= 3 &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255;
  return (
    (image.mimeType === "image/png" && png) ||
    (image.mimeType === "image/jpeg" && jpeg)
  );
}
