import { useEffect, useMemo, useSyncExternalStore } from "react";
import { db } from "./firebase.js";
import { createDemoMatchCredits, validDemoSessionId } from "./demoMatchCredits.js";
import { demoMatchCreditsRemote } from "./demoMatchCreditsFirebase.js";

export function useDemoMatchCredits(roomId, sessionId) {
  const normalizedSessionId = validDemoSessionId(sessionId);
  const credits = useMemo(() => createDemoMatchCredits({
    storage: window.localStorage,
    projectId: db.app.options.projectId,
    roomId,
    sessionId: normalizedSessionId,
    remote: demoMatchCreditsRemote(db, roomId, normalizedSessionId || "inactive"),
  }), [roomId, normalizedSessionId]);
  const count = useSyncExternalStore(credits.subscribe, credits.getCount);

  useEffect(() => {
    if (!credits.active) return undefined;
    const disconnect = credits.connect();
    const refresh = () => credits.refresh();
    const onStorage = event => {
      if (event.key === null || event.key?.startsWith(credits.prefix)) refresh();
    };
    window.addEventListener("online", refresh);
    window.addEventListener("storage", onStorage);
    const retry = setInterval(refresh, 10000);
    return () => {
      clearInterval(retry);
      window.removeEventListener("online", refresh);
      window.removeEventListener("storage", onStorage);
      disconnect();
    };
  }, [credits]);

  return { credits, count };
}

