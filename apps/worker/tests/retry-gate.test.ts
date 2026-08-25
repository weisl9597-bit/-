import { describe, expect, it, vi } from 'vitest';
import { attemptWithRetryGate, type RetryGateState } from '../src/retry-gate';

describe('worker retry gate', () => {
  it('keeps the worker alive and retries after a transient failure', async () => {
    const state: RetryGateState = { completed: false, nextAttemptAt: 0 };
    const task = vi.fn()
      .mockRejectedValueOnce(new Error('P1001'))
      .mockResolvedValueOnce(3);
    const onFailure = vi.fn();
    const onSuccess = vi.fn();

    await attemptWithRetryGate({
      state,
      now: 1_000,
      retryDelayMs: 15_000,
      task,
      onFailure,
      onSuccess,
    });

    expect(state).toEqual({ completed: false, nextAttemptAt: 16_000 });
    expect(onFailure).toHaveBeenCalledOnce();

    await attemptWithRetryGate({
      state,
      now: 15_999,
      retryDelayMs: 15_000,
      task,
      onFailure,
      onSuccess,
    });
    expect(task).toHaveBeenCalledTimes(1);

    await attemptWithRetryGate({
      state,
      now: 16_000,
      retryDelayMs: 15_000,
      task,
      onFailure,
      onSuccess,
    });
    expect(state.completed).toBe(true);
    expect(onSuccess).toHaveBeenCalledWith(3);

    await attemptWithRetryGate({
      state,
      now: 60_000,
      retryDelayMs: 15_000,
      task,
      onFailure,
      onSuccess,
    });
    expect(task).toHaveBeenCalledTimes(2);
  });
});
