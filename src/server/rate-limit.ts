/** A small sliding-window limiter. Used to keep model-backed endpoints inside the free model's allowance. */
export function createRateLimiter(maxPerWindow: number, windowMs: number, now: () => number = Date.now) {
  let hits: number[] = [];
  return {
    /** True if the call may go ahead (and counts it). */
    take(): boolean {
      const t = now();
      hits = hits.filter((h) => t - h < windowMs);
      if (hits.length >= maxPerWindow) return false;
      hits.push(t);
      return true;
    },
  };
}
