"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Poll an async function every `ms` (pauses while the tab is hidden). */
export function usePoll<T>(fn: () => Promise<T>, ms: number, deps: unknown[] = []) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const run = useCallback(async () => {
    try {
      setData(await fnRef.current());
      setError(undefined);
    } catch (e) {
      if (process.env.NODE_ENV !== "production") console.warn("poll failed:", (e as Error).message);
      setError(e as Error);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let first = true;
    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      if (!alive) return;
      // always load once; afterwards skip polling while the tab is in the background
      if (first || typeof document === "undefined" || document.visibilityState !== "hidden") await run();
      first = false;
      timer = setTimeout(loop, ms);
    };
    loop();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, run, ...deps]);

  return { data, error, refresh: run };
}

/** Current unix time, ticking every second. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
