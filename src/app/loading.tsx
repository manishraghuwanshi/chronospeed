import { Container } from "@/components/ui/container";

/**
 * Root loading UI, used while a route segment streams. Deliberately minimal: a
 * single skeleton row. Feature-specific skeletons belong to the phases that build
 * those features.
 */
export default function Loading() {
  return (
    <Container className="flex flex-1 flex-col gap-6 py-20">
      <div className="h-8 w-56 animate-pulse rounded-sm bg-surface-muted" />
      <div className="h-4 w-full max-w-prose animate-pulse rounded-sm bg-surface-muted" />
      <div className="h-4 w-2/3 max-w-prose animate-pulse rounded-sm bg-surface-muted" />
      <span className="sr-only">Loading</span>
    </Container>
  );
}