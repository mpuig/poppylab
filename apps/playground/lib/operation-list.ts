/**
 * The page's operations after an answer from the server. Each operation the
 * answer carries takes the place of the one with its ID. One the page hasn't
 * seen is added last, where the server keeps it too: a Company can answer an
 * approval with new terms under another ID, and those must not wait for a
 * reload behind a card that can no longer be approved.
 */
export function withOperations<T extends { operation_id: string }>(
  shown: T[],
  ...answered: Array<T | undefined>
): T[] {
  let next = shown;
  for (const operation of answered) {
    if (!operation) continue;
    next = next.some((item) => item.operation_id === operation.operation_id)
      ? next.map((item) =>
          item.operation_id === operation.operation_id ? operation : item,
        )
      : [...next, operation];
  }
  return next;
}
