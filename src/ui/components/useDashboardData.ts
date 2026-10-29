"use client";

import { useEffect, useState } from "react";
import { watchDashboard } from "../../dashboard/live-data";
import { api } from "../lib/api";

/** Keep the last successful snapshot visible during temporary connection failures. */
export function useDashboardData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    setError(null);
    if (!path) return;
    return watchDashboard<T>({
      read: (signal) => api<T>(path, { signal }),
      update: setData,
      error: setError,
    });
  }, [path]);
  return { data, error };
}
