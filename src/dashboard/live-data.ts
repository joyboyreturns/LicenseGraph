/** Refresh dashboard snapshots without overlapping requests or publishing after navigation. */
export function watchDashboard<T>(options: {
  read: (signal: AbortSignal) => Promise<T>;
  update: (data: T) => void;
  error: (message: string | null) => void;
  delay?: number;
}): () => void {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previous: string | undefined;
  let failures = 0;
  const poll = async () => {
    try {
      const data = await options.read(controller.signal);
      if (controller.signal.aborted) return;
      const fingerprint = JSON.stringify(data);
      if (fingerprint !== previous) {
        options.update(data);
        previous = fingerprint;
      }
      failures = 0;
      options.error(null);
    } catch (e) {
      if (controller.signal.aborted) return;
      failures++;
      options.error(e instanceof Error ? e.message : "Could not refresh the dashboard.");
    }
    if (!controller.signal.aborted) {
      timer = setTimeout(poll, Math.min(30_000, (options.delay ?? 3000) * 2 ** Math.min(failures, 3)));
    }
  };
  void poll();
  return () => {
    controller.abort();
    clearTimeout(timer);
  };
}
