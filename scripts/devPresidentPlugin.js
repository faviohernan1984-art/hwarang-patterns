import { presidentToken, validateAdminEnvironment } from './localAdmin.js';

const page = '<!doctype html><html lang="es"><meta charset="utf-8"><title>President DEV</title><body><h1>President DEV · Room A</h1><button id="login">Entrar como President DEV</button><p id="status"></p><script type="module" src="/src/devPresident.js"></script></body></html>';

export function allowedDevRequest(req, requireOrigin = false) {
  const remote = req.socket?.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
  if (!/^(localhost|127\.0\.0\.1)(:[1-9][0-9]{0,4})?$/.test(req.headers.host ?? '')) return false;
  return !requireOrigin || req.headers.origin === 'http://' + req.headers.host;
}

export function devPresidentPlugin(env) {
  validateAdminEnvironment(env);
  return {
    name: 'patterns-dev-president', apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const route = req.url?.split('?')[0];
        if (route !== '/__dev/president' && route !== '/__dev/president/token') return next();
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!allowedDevRequest(req, route.endsWith('/token'))) {
          res.statusCode = 403;
          return res.end('DEV login is loopback and same-origin only');
        }
        if (route === '/__dev/president' && req.method === 'GET') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.end(page);
        }
        if (route === '/__dev/president/token' && req.method === 'POST') {
          try {
            const token = await presidentToken();
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ token }));
          } catch {
            res.statusCode = 503;
            return res.end('DEV identity/Room unavailable; run provisioning and check emulators');
          }
        }
        res.statusCode = 405;
        return res.end('Method not allowed');
      });
    },
  };
}
