/**
 * The approved product-image placeholder.
 *
 * Phase 3 explicitly excludes "product image delivery beyond approved placeholders"
 * (`docs/phase-roadmap.md` §6), and the storage bucket is private today — the
 * signed-URL-vs-CDN decision (`docs/architecture.md` O-5) is unresolved. So no product
 * photograph is fetched, and no `storage_key` is ever turned into a URL here.
 *
 * The component renders a drawn mark instead of an `<img>`, which has three useful
 * consequences: there is no request to a bucket that would 403, there is no layout shift
 * when a real image arrives later, and nothing in the DOM implies an address that a
 * visitor could probe. The real `storageKey` is deliberately **not** rendered as a
 * `data-` attribute or a comment — a key identifies a private object, and a placeholder
 * should not be the thing that publishes it.
 *
 * It takes no `src`, so a later phase must change this component deliberately rather
 * than by passing a URL into it.
 */
export function PlaceholderImage({
  label,
  className = "",
}: {
  /** Accessible description, usually the product name. */
  label: string;
  className?: string;
}) {
  return (
    <div
      className={`relative isolate flex items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-muted ${className}`}
    >
      {/* Decorative: the accessible name is the visually hidden text below. */}
      <svg
        aria-hidden
        viewBox="0 0 120 120"
        className="h-2/3 w-2/3 text-muted-foreground/45"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      >
        {/* Case */}
        <circle cx="60" cy="64" r="30" />
        {/* Bezel */}
        <circle cx="60" cy="64" r="25" strokeOpacity="0.55" />
        {/* Crown */}
        <path d="M90 58h5a3 3 0 0 1 0 10h-5" />
        {/* Lugs */}
        <path d="M48 34h24" />
        {/* Hands, set to a fixed time so the mark reads as a watch rather than a dial */}
        <path d="M60 64V49" />
        <path d="M60 64l11 7" strokeOpacity="0.8" />
        {/* Hour pips */}
        <path d="M60 39v4M60 85v4M35 64h4M81 64h4" strokeOpacity="0.7" />
      </svg>

      <span className="sr-only">{label}</span>

      {/* Sighted users get an honest signal that this is not the product photograph. */}
      <span
        aria-hidden
        className="absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-[0.6rem] tracking-[0.2em] text-muted-foreground/70 uppercase"
      >
        Image pending
      </span>
    </div>
  );
}