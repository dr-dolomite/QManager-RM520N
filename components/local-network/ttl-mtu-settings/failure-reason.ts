/** A mutation result's reason as a toast description, dropped when it only restates the title. */
export function failureReason(title: string, reason: string | null): string | undefined {
  const bare = (s: string) => s.trim().replace(/[.。]$/, "");
  return reason && bare(reason) !== bare(title) ? reason : undefined;
}
