/**
 * Tells whether a connection holds an open transaction after a statement.
 *
 * @param statement - The statement that just ran.
 * @param wasOpen - Whether a transaction was open before it.
 * @returns Whether one is open now.
 */
export function holdsTransaction(statement: string, wasOpen: boolean): boolean {
  if (/^\s*BEGIN\b/iu.test(statement)) return true;
  return wasOpen && !/^\s*(?:COMMIT|ROLLBACK)\b/iu.test(statement);
}
