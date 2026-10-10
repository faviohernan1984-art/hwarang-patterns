import { devToken, devIdentity, DEV_IDENTITIES, validateAdminEnvironment } from './localAdmin.js';
import { demoAccess, demoToken } from './localDemoIdentities.js';
import { createLocalDemo } from './createLocalDemo.js';
import { roomAccessLinks, roomBasePath } from '../src/roomRoutes.js';
import { demoCredential, authorizationDenied } from './localDemoAuthorization.js';

function loginPage(key, identity = devIdentity(key), roomId = 'A', tokenPath = '/__dev/' + key + '/token') {
  return '<!doctype html><html lang="es"><meta charset="utf-8"><title>Patterns DEV</title><body><h1>' + key + ' DEV - Room ' + roomId + '</h1><button id="login" disabled data-key="' + key + '" data-room-id="' + roomId + '" data-token-path="' + tokenPath + '" data-role="' + identity.claims.role + '" data-judge-id="' + (identity.claims.judgeId ?? '') + '">Entrar como ' + key + ' DEV</button><p id="status">Cargando acceso DEV...</p><script type="module" src="/src/devPresident.js"></script></body></html>';
}

export function allowedDevRequest(req, requireOrigin = false) {
  const remote = req.socket?.remoteAddress;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
  if (!/^(localhost|127\.0\.0\.1)(:[1-9][0-9]{0,4})?$/.test(req.headers.host ?? '')) return false;
  return !requireOrigin || req.headers.origin === 'http://' + req.headers.host;
}

export function devPresidentPlugin(env, { demoAccessFn = demoAccess, demoTokenFn = demoToken, createDemoFn = createLocalDemo } = {}) {
  validateAdminEnvironment(env);
  return {
    name: 'patterns-dev-president', apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const route = req.url?.split('?')[0];
        const access = /^\/api\/demo-access\/(demo-patterns-[a-f0-9]{24})\/(president|public|judge\/[1-5])$/.exec(route ?? '');
        if (route === '/api/create-demo' || route?.startsWith('/api/demo-access/')) {
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('Content-Type', 'application/json');
          const reply = (status, body) => { res.statusCode = status; return res.end(JSON.stringify(body)); };
          if (!allowedDevRequest(req, true)) return reply(403, { ok: false, code: 'LOCAL_ACCESS_REQUIRED' });
          if (req.method !== 'POST') return reply(405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          if (route !== '/api/create-demo' && !access) return reply(400, { ok: false, code: 'INVALID_ACCESS' });
          let requestedRoomId = null;
          if (!access) {
            try {
              if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw new Error('INVALID_CONTENT_TYPE');
              let body = '';
              for await (const chunk of req) {
                body += chunk;
                if (body.length > 1024) throw new Error('REQUEST_TOO_LARGE');
              }
              const input = JSON.parse(body);
              if (!input || Array.isArray(input) || typeof input !== 'object' || Object.keys(input).some(key => key !== 'roomId')
                || (input.roomId != null && (typeof input.roomId !== 'string' || !/^demo-patterns-[a-f0-9]{24}$/.test(input.roomId)))) throw new Error('INVALID_ROOM_ID');
              requestedRoomId = input.roomId ?? null;
            } catch { return reply(400, { ok: false, code: 'INVALID_REQUEST' }); }
          }
          try {
            const credential = demoCredential(req);
            if ((access || requestedRoomId) && !credential) throw authorizationDenied();
            if (access) return reply(200, { ok: true, token: await demoTokenFn(access[1], access[2], credential) });
            const result = await createDemoFn(requestedRoomId, { dispose: false, credential });
            const judgeCount = Object.values(result.identities).filter(identity => identity.claims.role === 'judge').length;
            return reply(result.created ? 201 : 200, { ok: true, roomId: result.roomId, demoSessionId: result.demoSessionId,
              created: result.created, path: roomBasePath(result.roomId), access: roomAccessLinks(result.roomId, judgeCount),
              ...(result.created && result.credentials ? { credentials: result.credentials } : {}) });
          } catch (error) {
            if (error.code === 'DEMO_AUTHORIZATION_DENIED') return reply(403, { ok: false, code: 'DEMO_AUTHORIZATION_DENIED' });
            console.error('LOCAL_DEMO_API_ERROR');
            const retry = /retry: node scripts\/createLocalDemo.js (demo-patterns-[a-f0-9]{24})/.exec(error.message);
            return reply(503, { ok: false, code: 'DEMO_UNAVAILABLE', ...(retry ? { roomId: retry[1] } : {}) });
          }
        }
        if (!route?.startsWith('/__dev/')) return next();
        const isToken = route.endsWith('/token');
        const demo = /^\/__dev\/demo\/(demo-patterns-[a-f0-9]{24})\/(president|public|judge\/[1-5])(\/token)?$/.exec(route);
        const key = demo ? demo[2] : route.slice('/__dev/'.length).replace(/\/token$/, '');
        if (!demo && !Object.hasOwn(DEV_IDENTITIES, key)) {
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
          if (!demo) {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.end(loginPage(key));
          }
          try {
            const identity = await demoAccessFn(demo[1], key);
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            return res.end(loginPage(key, identity, demo[1], route + '/token'));
          } catch {
            res.statusCode = 503;
            return res.end('DEMO identity unavailable; retry local provisioning for this room');
          }
        }
        if (isToken && req.method === 'POST') {
          try {
            const credential = demoCredential(req);
            if (demo && !credential) throw authorizationDenied();
            const token = demo ? await demoTokenFn(demo[1], key, credential) : await devToken(key);
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ token }));
          } catch (error) {
            if (error.code === 'DEMO_AUTHORIZATION_DENIED') {
              res.statusCode = 403;
              return res.end('DEMO_AUTHORIZATION_DENIED');
            }
            res.statusCode = 503;
            return res.end(demo ? 'DEMO identity unavailable; retry local provisioning for this room'
              : error.code === 'auth/user-not-found'
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
