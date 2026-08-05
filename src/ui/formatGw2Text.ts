/**
 * Strips ArenaNet tooltip markup (`<br>`, `<c=@…>…</c>`) into plain text
 * suitable for a dense HTML tooltip.
 */
export function formatGw2Text(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?c=@[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
