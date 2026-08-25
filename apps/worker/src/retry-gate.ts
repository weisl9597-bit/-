export type RetryGateState = {
  completed: boolean;
  nextAttemptAt: number;
};

export async function attemptWithRetryGate<T>(input: {
  state: RetryGateState;
  now: number;
  retryDelayMs: number;
  task: () => Promise<T>;
  onSuccess?: (result: T) => void;
  onFailure: (error: unknown) => void;
}): Promise<void> {
  if (input.state.completed || input.now < input.state.nextAttemptAt) return;

  input.state.nextAttemptAt = input.now + input.retryDelayMs;
  try {
    const result = await input.task();
    input.state.completed = true;
    input.onSuccess?.(result);
  } catch (error) {
    input.onFailure(error);
  }
}
