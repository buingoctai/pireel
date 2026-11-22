import { studioProviders } from '@pireel/studio-engine/providers';

/** Asset library routes that work locally without a host */
function isLocalAssetRoute(url: string): boolean {
  return url.startsWith('/api/me/materials') ||
         url.startsWith('/api/me/uploads') ||
         url.startsWith('/local-assets/');
}

/** Check if a URL matches the chat endpoint (compare by pathname, ignoring query/origin differences) */
function isChatEndpoint(url: string, chatEndpoint: string | undefined, currentOrigin: string | undefined): boolean {
  if (!chatEndpoint) return false;

  // Exact match for simple cases
  if (url === chatEndpoint) return true;

  try {
    // Parse both URLs to compare by pathname, handling relative/absolute/query forms
    const urlObj = new URL(url, currentOrigin);
    const chatObj = new URL(chatEndpoint, currentOrigin);

    // Match if same origin and pathname (query string doesn't matter)
    return urlObj.origin === chatObj.origin && urlObj.pathname === chatObj.pathname;
  } catch {
    // If URL parsing fails, fall back to string comparison
    return url === chatEndpoint;
  }
}

/** Platform HTTP calls are supplied by the embedding host; local media remains ordinary fetch. */
export const editorRequest: typeof fetch = (input, init) => {
  const services = studioProviders();
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const origin = typeof location === 'undefined' ? undefined : location.origin;
  let localApi = url.startsWith('/api/');
  if (origin) {
    try { const parsed = new URL(url, origin); localApi ||= parsed.origin === origin && parsed.pathname.startsWith('/api/'); } catch { /* fetch reports malformed resource URLs */ }
  }

  // Asset library routes can use fetch directly in local dev
  if (isLocalAssetRoute(url)) return fetch(input, init);

  const isChatUrl = isChatEndpoint(url, services.chatEndpoint, origin);

  if (localApi || isChatUrl) {
    if (services.request) return services.request(input, init);
    if (isChatUrl) return fetch(input, init);
    return Promise.reject(new Error('AI service is not configured. Set GEMINI_API_KEY in .env.local or connect an AI provider in the editor host.'));
  }
  return fetch(input, init);
};
