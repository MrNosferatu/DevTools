// Diagnostic shim for ./build.sh --submit.
//
// web-ext catches every error from submitAddon and rethrows it as
// `new WebExtError(clientError.message)`, which drops `error.cause` — so a
// failed request surfaces only as undici's generic "fetch failed" with no URL,
// no errno, and no TLS/DNS detail. This wraps global fetch to print the request
// and the full cause chain before the error is swallowed, then rethrows it
// untouched so web-ext behaves exactly as it would otherwise.
const original = globalThis.fetch;
globalThis.fetch = async (...args) => {
  try {
    return await original(...args);
  } catch (error) {
    const url = args[0]?.url ?? String(args[0]);
    console.error(`\n[amo] request failed: ${args[1]?.method ?? 'GET'} ${url}`);
    for (let cause = error.cause, depth = 0; cause && depth < 6; cause = cause.cause, depth++) {
      console.error(`[amo]   cause: ${[cause.code, cause.message].filter(Boolean).join(' ') || cause}`);
    }
    console.error('');
    throw error;
  }
};
