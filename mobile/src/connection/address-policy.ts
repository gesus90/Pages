import type { ServerAddressOptions } from "@/api/server-address";

/**
 * The address rules of this build.
 *
 * @remarks
 * Plain HTTP is accepted only in development builds, so a developer can reach a
 * Pages server on the local network; every release build requires HTTPS.
 */
export const SERVER_ADDRESS_OPTIONS: ServerAddressOptions = {
  allowInsecureHttp: __DEV__,
};
