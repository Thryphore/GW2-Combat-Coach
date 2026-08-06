import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

interface Props {
  content: ReactNode;
  children: ReactNode;
  /** Extra classes on the trigger wrapper. */
  className?: string;
  style?: CSSProperties;
  /** Prefer opening above the trigger when there is room. */
  preferAbove?: boolean;
}

interface TipPos {
  top: number;
  left: number;
  maxWidth: number;
}

const VIEW_PAD = 8;
const GAP = 6;
const MAX_WIDTH = 360;

/**
 * Dense hover/focus tooltip rendered in a portal so parent overflow cannot clip it.
 */
export function HoverTooltip({ content, children, className, style: triggerStyle, preferAbove = true }: Props) {
  const tipId = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<TipPos | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tipRef.current) return;

    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const tip = tipRef.current?.getBoundingClientRect();
      if (!trigger || !tip) return;

      const maxWidth = Math.min(MAX_WIDTH, window.innerWidth - VIEW_PAD * 2);
      let left = trigger.left + trigger.width / 2 - tip.width / 2;
      left = Math.max(VIEW_PAD, Math.min(left, window.innerWidth - tip.width - VIEW_PAD));

      const above = trigger.top - tip.height - GAP;
      const below = trigger.bottom + GAP;
      const fitsAbove = above >= VIEW_PAD;
      const fitsBelow = below + tip.height <= window.innerHeight - VIEW_PAD;
      const top =
        preferAbove && fitsAbove
          ? above
          : fitsBelow
            ? below
            : fitsAbove
              ? above
              : Math.max(VIEW_PAD, Math.min(below, window.innerHeight - tip.height - VIEW_PAD));

      setPos({ top, left, maxWidth });
    };

    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, preferAbove, content]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const style: CSSProperties | undefined = pos
    ? {
        top: pos.top,
        left: pos.left,
        maxWidth: pos.maxWidth,
      }
    : {
        // Measure off-screen before the first layout pass.
        top: -9999,
        left: -9999,
        maxWidth: MAX_WIDTH,
        visibility: 'hidden',
      };

  return (
    <span
      ref={triggerRef}
      className={className ?? 'inline-flex'}
      style={triggerStyle}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      aria-describedby={open ? tipId : undefined}
    >
      {children}
      {open &&
        createPortal(
          <div
            ref={tipRef}
            id={tipId}
            role="tooltip"
            style={style}
            className="pointer-events-none fixed z-50 rounded-xl border border-ink-700/90 bg-ink-900/95 px-3 py-2.5 text-left text-ink-200 shadow-xl shadow-black/40 ring-1 ring-white/5 backdrop-blur-md"
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
