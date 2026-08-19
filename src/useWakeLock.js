import { useEffect, useRef } from "react";

export function useWakeLock(enabled = true) {
  const wakeLockRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let requestPending = false;

    async function requestWakeLock() {
      if (cancelled || requestPending || wakeLockRef.current) return;
      requestPending = true;

      try {
        if (!("wakeLock" in navigator)) return;

        if (cancelled || document.visibilityState !== "visible") return;

        const sentinel = await navigator.wakeLock.request("screen");

        if (cancelled) {
          await sentinel.release().catch(() => {});
          return;
        }

        wakeLockRef.current = sentinel;

        sentinel.addEventListener("release", () => {
          if (wakeLockRef.current === sentinel) {
            wakeLockRef.current = null;
          }

          if (document.visibilityState === "visible" && !cancelled) {
            requestWakeLock();
          }
        });
      } catch {
        // Wake Lock is optional; permission and platform failures are non-fatal.
      } finally {
        requestPending = false;
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && !cancelled) {
        requestWakeLock();
      }
    }

    function handleFocus() {
      if (!cancelled) requestWakeLock();
    }

    requestWakeLock();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;

      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);

      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
        wakeLockRef.current = null;
      }
    };
  }, [enabled]);
}
