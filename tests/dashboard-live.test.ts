import { afterEach, describe, expect, it, vi } from "vitest";
import { watchDashboard } from "../src/dashboard/live-data";

afterEach(() => vi.useRealTimers());

describe("dashboard refresh", () => {
  it("follows later ledger changes without rebuilding unchanged snapshots", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValue({ events: ["verified"] });
    const update = vi.fn();
    const error = vi.fn();
    const stop = watchDashboard({ read, update, error });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    expect(update).toHaveBeenCalledTimes(1);
    read.mockResolvedValue({ events: ["verified", "approved", "captured"] });
    await vi.advanceTimersByTimeAsync(3000);
    expect(update).toHaveBeenLastCalledWith({ events: ["verified", "approved", "captured"] });
    expect(error).toHaveBeenLastCalledWith(null);
    stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("keeps the successful snapshot on errors, backs off and recovers", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce({ count: 1 }).mockRejectedValueOnce(new Error("Offline")).mockResolvedValue({ count: 2 });
    const update = vi.fn();
    const error = vi.fn();
    const stop = watchDashboard({ read, update, error });
    await vi.advanceTimersByTimeAsync(3000);
    expect(error).toHaveBeenLastCalledWith("Offline");
    expect(update).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5999);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenLastCalledWith({ count: 2 });
    expect(error).toHaveBeenLastCalledWith(null);
    stop();
  });

  it("never overlaps requests and ignores an old response after navigation", async () => {
    vi.useFakeTimers();
    let finish!: (data: object) => void;
    const read = vi.fn((signal: AbortSignal) => new Promise<object>((resolve) => { finish = resolve; expect(signal.aborted).toBe(false); }));
    const update = vi.fn();
    const error = vi.fn();
    const stop = watchDashboard({ read, update, error });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(read).toHaveBeenCalledTimes(1);
    stop();
    expect(read.mock.calls[0]![0].aborted).toBe(true);
    finish({ count: 1 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(update).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(read).toHaveBeenCalledTimes(1);
  });
});
