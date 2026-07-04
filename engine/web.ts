// Browser-safe entry (`@aiviatic/kindling/web`) for the website: ONLY import-pure modules —
// types, enums, message/pin constants. No `node:` imports may be reachable from here, so a
// browser bundle that needs `ErrorCode`/`recoveryGuidance`/`pins` doesn't drag in the whole
// engine (or its node built-ins). Keep this surface small; the full engine stays at `.`.
export * from './contract';
export { pins } from './pins';
export { stepMessages, errorMessages, recoveryGuidance } from './messages';
