export function sourceAwareOperationsEnabled(): boolean {
  return process.env.SOURCE_AWARE_OPERATIONS_ENABLED === 'true';
}

