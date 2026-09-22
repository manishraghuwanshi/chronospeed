import type { ReactNode } from "react";

/**
 * Horizontal page gutter. One component so every page aligns to the same measure.
 * Deliberately tiny — Phase 1 establishes layout primitives, not a design system.
 */
export function Container({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 ${className}`}>{children}</div>;
}