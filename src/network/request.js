// Phase 3 — small shared plumbing for the three network operations
// (activate/refresh/deactivate): identical POST-JSON request shape and
// identical `{ error: { code, message } }` envelope parsing, per
// docs/client-sdk-integration.md's error format. No HTTP client dependency:
// `fetchImpl` defaults to the global `fetch` (Node engine is already >=24).

import { KeyforgeApiError } from './errors.js';

/**
 * @param {string} baseUrl
 * @param {string} path
 * @param {object} payload
 * @param {typeof fetch} fetchImpl
 */
export function postJson(baseUrl, path, payload, fetchImpl) {
  return fetchImpl(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Parses a success (2xx) response body, converting a missing/malformed JSON
 * body into a KeyforgeApiError rather than letting a raw SyntaxError escape
 * — a malicious/broken server sending e.g. `201` with an empty or non-JSON
 * body should fail the same recognizable way as any other bad response.
 * @param {Response} response
 */
export async function parseSuccessBody(response) {
  try {
    return await response.json();
  } catch (err) {
    throw new KeyforgeApiError(
      response.status,
      'MALFORMED_RESPONSE',
      'Response body is not valid JSON',
      {
        cause: err,
      },
    );
  }
}

/**
 * Builds a KeyforgeApiError from a non-success Response, tolerating a
 * missing/malformed error body rather than throwing while handling an
 * already-exceptional path.
 * @param {Response} response
 */
export async function apiErrorFromResponse(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    // no/invalid JSON body — fall through to the synthetic code below
  }
  const code = body?.error?.code ?? 'MALFORMED_RESPONSE';
  const message = body?.error?.message;
  return new KeyforgeApiError(response.status, code, message);
}
