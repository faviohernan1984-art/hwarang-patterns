import { authorizeRoomRoute } from './roomAccess.js';

// Navigation only: this never grants authority or selects a post-login destination.
export function institutionalLoginAction({ environment, route, identity, hasSession, loading, error }) {
  if (environment !== 'production' || loading || !route?.valid || route.roomId !== 'A'
    || !['home', 'public', 'judge'].includes(route.role)
    || (route.role === 'judge' && (!Number.isInteger(route.judgeId) || route.judgeId < 1 || route.judgeId > 5))) return null;
  if (!hasSession && !error) return 'redirect';
  if (error || !authorizeRoomRoute(identity, route).allowed) return 'switch';
  return null;
}
