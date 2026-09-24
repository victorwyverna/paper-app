export async function cleanupResources(
  tasks: (() => Promise<void>)[]
): Promise<void> {
  const errors: unknown[] = [];
  for (const task of tasks) {
    try {
      await task();
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length)
    throw new AggregateError(errors, 'Test resource cleanup failed');
}
