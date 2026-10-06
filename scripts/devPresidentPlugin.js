import { devToken, devIdentity, DEV_IDENTITIES, validateAdminEnvironment } from './localAdmin.js';

function loginPage(key) {
  const identity = devIdentity(key);
  return '<!doctype html><html lang="es"><meta charset="utf-8"><title>Patterns DEV</title><body><h1>' + key + ' DEV - Room A</h1><button id="login" disabled data-key="' + key + '" data-role="' + identity.claims.role + '" data-judge-id="' + (identity.claims.judgeId ?? '') + '">Entrar como ' + key + ' DEV</button><p id="status">Cargando acceso DEV...</p><script type="module" src="/src/devPresident.js"></script></body></html>';
}

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
        if (!route?.startsWith('/__dev/')) return next();
        const isToken = route.endsWith('/token');
        const key = route.slice('/__dev/'.length).replace(/\/token$/, '');
        if (!Object.hasOwn(DEV_IDENTITIES, key)) {
          res.statusCode = 404;
          return res.end('Unsupported DEV identity');
        }
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (!allowedDevRequest(req, isToken)) {
          res.statusCode = 403;
          return res.end('DEV login is loopback and same-origin only');
        }
        if (!isToken && req.method === 'GET') {
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          return res.end(loginPage(key));
        }
        if (isToken && req.method === 'POST') {
          try {
            const token = await devToken(key);
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ token }));
          } catch (error) {
            res.statusCode = 503;
            return res.end(error.code === 'auth/user-not-found'
              ? 'DEV identity missing in Auth Emulator; run npm run provision:local.'
              : 'DEV identity/Room unavailable; run provisioning and check emulators');
          }
        }
        res.statusCode = 405;
        return res.end('Method not allowed');
      });
    },
  };
}
