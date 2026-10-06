// Fixed loopback aliases split browser HTTP/1.1 connection pools by DEV role.
// This chooses a transport host only; Firebase Auth claims still grant access.
export function devFirestoreTransportHost(host, pathname) {
  if (host !== '127.0.0.1' && host !== 'localhost') return host;
  const role = /^\/(?:__dev|rooms\/[^/]+)\/(president|public|judge\/[123])(?:\/|$)/.exec(pathname)?.[1];
  return role ? 'patterns-' + role.replace('/', '-') + '.localhost' : host;
}
