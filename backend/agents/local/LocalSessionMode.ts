/** Internal bootstrap context; it cannot be enabled by a provider environment. */
let ownerDirectory: string | null = null;

/** Marks the independently started native session owner before services are created. */
export function enterLocalSessionOwner(directory: string): void {
  if (ownerDirectory !== null)
    throw new Error("Local owner already initialized");
  ownerDirectory = directory;
}

/** Whether this process owns a native session rather than the web application. */
export function isLocalSessionOwner(): boolean {
  return ownerDirectory !== null;
}

/** Returns the owner's private runtime directory, if this is an owner process. */
export function localSessionOwnerDirectory(): string | null {
  return ownerDirectory;
}
