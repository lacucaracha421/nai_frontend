import { useEffect, useState } from "react";

/** Wall-clock ticks catch up after Android suspends timers; resume also reloads quota. */
export function watchQuotaClock(onTick: (now: number) => void, refresh: () => Promise<void>) {
  const tick = () => onTick(Date.now());
  const resume = () => {
    if (document.visibilityState === "hidden") return;
    tick();
    void refresh();
  };
  resume();
  const clock = window.setInterval(tick, 1000);
  const poll = window.setInterval(() => {
    if (document.visibilityState !== "hidden") void refresh();
  }, 60_000);
  window.addEventListener("focus", resume);
  document.addEventListener("visibilitychange", resume);
  return () => {
    window.clearInterval(clock);
    window.clearInterval(poll);
    window.removeEventListener("focus", resume);
    document.removeEventListener("visibilitychange", resume);
  };
}

export function useQuotaClock(connected: boolean, refresh: () => Promise<void>) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (connected) return watchQuotaClock(setNow, refresh);
  }, [connected, refresh]);
  return now;
}
