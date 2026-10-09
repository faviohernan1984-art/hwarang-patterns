import { doc, onSnapshot, runTransaction } from "firebase/firestore";
import { mergeEvaluationIds } from "./demoMatchCredits.js";

export function demoSessionRef(db, roomId, sessionId) {
  return doc(db, "rooms", roomId, "demoSessions", sessionId);
}

export function demoMatchCreditsRemote(db, roomId, sessionId) {
  const ref = demoSessionRef(db, roomId, sessionId);
  return {
    subscribe(onConfirmed) {
      return onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
        // Cached/pending snapshots never acknowledge an unconfirmed write.
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
          onConfirmed(snapshot.exists() ? snapshot.data().consumedEvaluationIds || [] : []);
        }
      }, () => { /* Local credits remain usable while Firebase is unavailable. */ });
    },
    merge(ids) {
      return runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref);
        const consumedEvaluationIds = mergeEvaluationIds(
          snapshot.exists() ? snapshot.data().consumedEvaluationIds || [] : [], ids
        );
        transaction.set(ref, {
          sessionId,
          consumedEvaluationIds,
          confirmedCount: consumedEvaluationIds.length,
        });
        return consumedEvaluationIds;
      });
    },
  };
}

