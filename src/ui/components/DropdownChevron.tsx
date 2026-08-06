/** Disclosure triangle — rotates when a parent `.group` opens, or when `open` is set. */
export function DropdownChevron({ className = '', open }: { className?: string; open?: boolean }) {
  const rotate =
    open === undefined ? 'group-open:rotate-90' : open ? 'rotate-90' : 'rotate-0';

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={`inline-block h-3 w-3 shrink-0 transition-transform duration-150 ${rotate} ${className}`}
      fill="currentColor"
    >
      <path d="M4.2 2.1a.75.75 0 0 0 0 1.06L6.94 6 4.2 8.84a.75.75 0 1 0 1.06 1.06l3.3-3.3a.75.75 0 0 0 0-1.06l-3.3-3.3a.75.75 0 0 0-1.06 0Z" />
    </svg>
  );
}
