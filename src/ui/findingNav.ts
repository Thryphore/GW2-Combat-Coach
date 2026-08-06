/** Stable DOM id for a finding card. */
export function findingAnchorId(findingId: string): string {
  return `finding-${findingId.replace(/[^a-zA-Z0-9_-]+/g, '-')}`;
}

/** Picks the first available finding id that matches an exact or prefix candidate. */
export function resolveFindingTarget(
  availableIds: Iterable<string>,
  candidates: string[],
): string | undefined {
  const ids = [...availableIds];
  for (const candidate of candidates) {
    const exact = ids.find((id) => id === candidate);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const prefixed = ids.find((id) => id.startsWith(`${candidate}/`));
    if (prefixed) return prefixed;
  }
  return undefined;
}

/** Opens collapsed ancestors, scrolls the finding into view, and briefly highlights it. */
export function scrollToFinding(findingId: string): boolean {
  const el = document.getElementById(findingAnchorId(findingId));
  if (!el) return false;

  let current: HTMLElement | null = el;
  while (current) {
    if (current.getAttribute('aria-hidden') === 'true') {
      const section = current.closest('section');
      const toggle = section?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]');
      toggle?.click();
    }
    current = current.parentElement;
  }

  window.setTimeout(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-brand-400', 'ring-offset-2', 'ring-offset-ink-950');
    window.setTimeout(() => {
      el.classList.remove('ring-2', 'ring-brand-400', 'ring-offset-2', 'ring-offset-ink-950');
    }, 1600);
  }, 80);

  return true;
}
