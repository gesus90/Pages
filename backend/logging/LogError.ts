import { redactLogText } from "./LogRedaction";

interface SafeError {
  readonly type: string;
  readonly message: string;
  readonly code: string | null;
  readonly stack: string;
  readonly cause?: SafeError;
  readonly truncated?: boolean;
}

function ownProperty(error: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(error, key);
  if (
    key === "stack" &&
    descriptor?.get &&
    Function.prototype.toString.call(descriptor.get).includes("[native code]")
  ) {
    const stack: unknown = descriptor.get.call(error);
    return stack;
  }
  return descriptor?.value;
}

function serialize(
  error: unknown,
  seen: Set<object>,
  depth: number,
): SafeError {
  if (typeof error !== "object" || error === null) {
    return {
      type: "NonError",
      message: "Non-Error rejection (payload omitted)",
      code: null,
      stack: "",
    };
  }
  if (seen.has(error) || depth >= 5) {
    return {
      type: "TruncatedError",
      message: "Circular or deep cause omitted",
      code: null,
      stack: "",
      truncated: true,
    };
  }
  seen.add(error);
  const rawStack = ownProperty(error, "stack");
  // Provider/SQL diagnostics can echo full user input. Only stack frames survive.
  const stack =
    typeof rawStack === "string"
      ? rawStack
          .slice(0, 16_384)
          .split("\n")
          .filter((line) => /^\s+at /u.test(line))
          .slice(0, 24)
          .join("\n")
      : "";
  const cause = ownProperty(error, "cause");
  return {
    type: errorType(error),
    message:
      "Error reported; free-form diagnostic text omitted to protect user content",
    code: safeIdentifier(ownProperty(error, "code")),
    stack: redactLogText(stack).slice(0, 1_200),
    ...(cause === undefined
      ? {}
      : { cause: serialize(cause, seen, depth + 1) }),
    ...(typeof rawStack === "string" &&
    (rawStack.length > 16_384 || stack.length > 1_200)
      ? { truncated: true }
      : {}),
  };
}

function safeIdentifier(candidate: unknown): string | null {
  return typeof candidate === "string" &&
    /^[a-zA-Z][a-zA-Z0-9_.-]{0,79}$/u.test(candidate)
    ? redactLogText(candidate)
    : null;
}

function errorType(error: object): string {
  let current: object | null = error;
  for (let depth = 0; current !== null && depth < 4; depth += 1) {
    const name = safeIdentifier(ownProperty(current, "name"));
    if (name !== null) return name;
    current = Reflect.getPrototypeOf(current);
  }
  return "ErrorObject";
}

/** Serializes hostile/circular errors; only the native lazy Error.stack getter may run. */
export function serializeLogError(error: unknown): SafeError {
  try {
    return serialize(error, new Set(), 0);
  } catch {
    return {
      type: "SerializationError",
      message: "Error serialization failed; payload omitted",
      code: null,
      stack: "",
      truncated: true,
    };
  }
}
