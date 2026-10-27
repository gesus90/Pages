import { registerHooks } from "node:module";

const RELATIVE_JAVASCRIPT_SPECIFIER = /^\.\.?\/.*\.js$/;

/**
 * Lets Node run the stdio check against `src/` directly. Modules in `src/`
 * import each other with `.js` specifiers for the root type check, but only
 * `.ts` files exist, and Node's type stripping does not map one onto the other.
 */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!RELATIVE_JAVASCRIPT_SPECIFIER.test(specifier)) {
      return nextResolve(specifier, context);
    }
    return nextResolve(`${specifier.slice(0, -".js".length)}.ts`, context);
  },
});
