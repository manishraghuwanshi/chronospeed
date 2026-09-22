import type { Metadata } from "next";

/**
 * Storefront route group: everything a customer sees while browsing.
 *
 * The group exists from Phase 1 so Phase 2 (listings, product pages) and Phase 3
 * (media) can add routes without a restructure. The home page lives here, which is
 * why there is no `src/app/page.tsx` any more — one route, one owner.
 *
 * `(account)`, `(auth)` and `checkout/` are introduced by the phases that need them
 * (4 and 7 respectively); empty route groups are not created in advance.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default function StorefrontLayout({ children }: LayoutProps<"/">) {
  return <>{children}</>;
}