// Phase 3 — the one new error type for the network surface: a structured,
// non-2xx (and otherwise unhandled) response from the Keyforge API. Kept
// separate from src/crypto/errors.js's TokenVerificationError hierarchy —
// that hierarchy is about a token failing *local* verification; this one is
// about the *server* rejecting a request outright. Different failure domain,
// different vocabulary (mirrors ARCHITECTURE.md §9's "don't invent a
// parallel vocabulary" guidance by reusing the server's own `code` values
// verbatim rather than re-deriving new ones).

export class KeyforgeApiError extends Error {
  /**
   * @param {number} status - HTTP status code, or 0 if there was no response at all
   * @param {string} code - server's `error.code`, or a synthetic one (e.g. `MALFORMED_RESPONSE`)
   * @param {string} [message]
   * @param {ErrorOptions} [options]
   */
  constructor(status, code, message, options) {
    super(message ?? `Keyforge API request failed (${code})`, options);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}
