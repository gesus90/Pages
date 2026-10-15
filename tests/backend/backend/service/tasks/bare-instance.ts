/**
 * Creates an object of a class without running its constructor.
 *
 * Collaborators whose constructor wires a whole subsystem are replaced this
 * way; the test then installs behavior on their prototype.
 *
 * @param prototype - Prototype of the class to stand in for.
 * @returns An object that inherits every method of the class.
 */
export function bareInstance<Instance extends object>(
  prototype: Instance,
): Instance {
  return Object.create(prototype);
}
