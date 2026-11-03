/** Query keys whose values are credentials or one-time codes. */
const SECRET_KEY =
  /(?:^|[_.-])(?:token|code|secret|passw(?:or)?d|key|apikey|session(?:id)?|sid|auth(?:orization)?|sig|signature|ticket|jwt|otp)(?:$|[_.-])/iu;

/**
 * Hides secret-looking query values of an address before it reaches a model.
 *
 * @param address - The address of a page or tab.
 * @returns The address with such values replaced by `…`; anything that is no URL stays as it is.
 *
 * @remarks
 * Redirect targets of sign-ins carry one-time codes in the query. The
 * administrator's own live view shows the real address; the model gets this one.
 */
export function addressForModel(address: string): string {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return address;
  }
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()])
    if (SECRET_KEY.test(key)) url.searchParams.set(key, "…");
  // A fragment can carry a token too (implicit flows).
  url.hash = url.hash ? "#…" : "";
  return url.href;
}
