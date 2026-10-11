export function nextMonotonicTimestamp(previous: Date): Date {
  return new Date(Math.max(Date.now(), previous.getTime() + 1));
}
