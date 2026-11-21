// Web: anonymous visit counts through the operator's self-hosted Umami (no cookies). The tracker is served from this
// site's own /u/ path (nginx passes it to Umami). Nothing about an account, a call or a phone number is sent: the page
// address is reduced to its route before it leaves the browser.

/** Where analytics runs. Any other host (local development, a self-hosted copy) loads nothing. */
const ANALYTICS = { host: 'callenvoy.pragnyalabs.com', script: '/u/p.js', websiteId: '2f487c54-23db-46fc-9fb5-def0b474b01a' };

type Payload = { url?: string; referrer?: string; title?: string; [k: string]: unknown };
declare global {
  interface Window {
    umami?: { track: (event: string) => void };
    __ceClean?: (type: string, payload: Payload) => Payload | false;
  }
}

/** A page address with everything identifying removed: no query, no fragment, ids replaced by a placeholder. */
export function routeOnly(address: string): string {
  let path = address;
  try {
    path = new URL(address, 'https://x').pathname;
  } catch {
    path = address.split(/[?#]/)[0];
  }
  return path.replace(/^\/calls\/[^/]+/, '/calls/:id');
}

/** Loads the tracker once, before the first render. */
export function installAnalytics() {
  if (typeof document === 'undefined' || location.hostname !== ANALYTICS.host || document.getElementById('ce-analytics')) return;
  // Runs on every hit before it is sent: keep the route, drop the rest. An external referrer keeps only its origin.
  window.__ceClean = (_type, payload) => {
    if (payload.url) payload.url = routeOnly(payload.url);
    if (payload.referrer) {
      try {
        const r = new URL(payload.referrer, location.origin);
        payload.referrer = r.origin === location.origin ? routeOnly(r.pathname) : r.origin;
      } catch {
        payload.referrer = '';
      }
    }
    payload.title = 'CallEnvoy'; // a call page's title names the business that was called
    return payload;
  };
  const s = document.createElement('script');
  s.id = 'ce-analytics';
  s.defer = true;
  s.src = ANALYTICS.script;
  s.dataset.websiteId = ANALYTICS.websiteId;
  s.dataset.beforeSend = '__ceClean';
  s.dataset.excludeSearch = 'true';
  s.dataset.excludeHash = 'true';
  document.head.appendChild(s);
}

/** Counts a named action on a public page. Does nothing when analytics is not loaded. */
export function track(event: string) {
  try {
    window.umami?.track(event);
  } catch {
    // counting must never break the page
  }
}
