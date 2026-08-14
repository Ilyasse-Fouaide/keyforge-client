// Test-only fakes for the `fetchImpl` seam activate/refresh/deactivate
// inject (default: global fetch). No real network, no mocking library —
// matches this project's dependency-light philosophy (ARCHITECTURE.md §3).

/**
 * A minimal fetch-Response-shaped object: only `.status` and `.json()` are
 * ever used by src/network/request.js.
 * @param {number} status
 * @param {object} body
 */
export function jsonResponse(status, body) {
  return { status, json: async () => body };
}

/**
 * Simulates a genuinely empty body (e.g. a 204) — `.json()` throws, same as
 * real fetch's Response#json() on an empty stream.
 * @param {number} status
 */
export function emptyResponse(status) {
  return {
    status,
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    },
  };
}

/**
 * A fetchImpl that always rejects, simulating DNS/connection failure —
 * exactly what refresh()'s connectivity check is meant to catch.
 */
export function unreachableFetch() {
  return async () => {
    throw new TypeError('fetch failed');
  };
}

/**
 * A fetchImpl returning queued responses in call order, recording every
 * call's (url, init) for assertions.
 * @param {Array<object>} responses
 * @returns {typeof fetch & { calls: Array<{url: string, init: object}> }}
 */
export function queueFetch(responses) {
  const calls = [];
  let i = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    if (i >= responses.length) {
      throw new Error('queueFetch: no more responses queued');
    }
    return responses[i++];
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
