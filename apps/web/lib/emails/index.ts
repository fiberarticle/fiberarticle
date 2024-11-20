/**
 * Fiberarticle transactional emails.
 *
 * Templates are TypeScript modules rather than .html files on disk: the
 * production build ships as a Next standalone bundle, which traces imports
 * but not loose assets, so a module is the only form guaranteed to be there
 * at runtime.
 */
export { deviceFrom, formatWhen, appUrl } from "./shell";
export type { RenderedEmail } from "./shell";
export { welcomeEmail } from "./welcome";
export { verifyEmail } from "./verify-email";
export { passwordResetEmail } from "./password-reset";
export { passwordChangedEmail } from "./password-changed";
