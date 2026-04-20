const USER_TIMEZONE_HEADER = "X-User-Timezone";

export function getUserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    return "";
  }
}

function mergeHeaders(headersInit) {
  const headers = new Headers(headersInit || {});
  const userTimeZone = getUserTimeZone();
  if (userTimeZone && !headers.has(USER_TIMEZONE_HEADER)) {
    headers.set(USER_TIMEZONE_HEADER, userTimeZone);
  }
  return headers;
}

export function installTimezoneAwareFetch() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;
  if (window.fetch.__timezoneAwareFetch === true) return;

  const originalFetch = window.fetch.bind(window);
  const wrappedFetch = (input, init = undefined) => {
    if (input instanceof Request) {
      const request = new Request(input, {
        ...(init || {}),
        headers: mergeHeaders(init?.headers ?? input.headers),
      });
      return originalFetch(request);
    }
    return originalFetch(input, {
      ...(init || {}),
      headers: mergeHeaders(init?.headers),
    });
  };

  wrappedFetch.__timezoneAwareFetch = true;
  window.fetch = wrappedFetch;
}
