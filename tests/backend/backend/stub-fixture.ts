/**
 * Types a partial test double as the dependency it stands in for.
 *
 * The test passes only the members the code under test reads. The argument is
 * a plain object rather than an object literal assertion, so the stub stays
 * explicit about being incomplete.
 *
 * @param partial - The members the test uses.
 * @returns The same object, typed as the dependency.
 */
export function partialStub<Value>(partial: object): Value {
  return partial as unknown as Value;
}
