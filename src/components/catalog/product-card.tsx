import Image from "next/image";
import Link from "next/link";

import { PlaceholderImage } from "@/components/catalog/placeholder-image";
import { formatInr } from "@/lib/money";
import { isDiscounted, type CatalogProductListItem } from "@/lib/types/catalog";

/**
 * One product card in a catalogue grid.
 *
 * A Server Component with no state: the card is a link and a small amount of text, so
 * there is nothing to hydrate. The whole card is wrapped in the anchor rather than
 * layering a stretched link over it, which keeps exactly one focusable target and one
 * accessible name per product.
 *
 * Prices are formatted with `formatInr` from the stored whole-INR integers — the number
 * in the database is the amount (`12999` renders as ₹12,999) and is never divided. The
 * `compareAtPrice` is shown only when `isDiscounted` says it represents a real saving.
 *
 * Availability is rendered from the server-computed value; the card never infers stock
 * from anything client-side.
 */
export function ProductCard({ product }: { product: CatalogProductListItem }) {
  const discounted = isDiscounted(product.price, product.compareAtPrice);
  const { availability } = product;

  return (
    <li className="group relative flex flex-col overflow-hidden rounded-md border border-border bg-surface-raised transition-colors hover:border-accent/60">
      <Link href={`/products/${product.slug}`} className="flex flex-1 flex-col">
        {product.thumbnailUrl ? (
          <div className="relative aspect-square w-full overflow-hidden border-b border-border">
            <Image
              src={product.thumbnailUrl}
              alt={`${product.name} by ${product.brand.name}`}
              fill
              sizes="(min-width: 1280px) 25vw, (min-width: 640px) 50vw, 100vw"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          </div>
        ) : (
          <PlaceholderImage
            label={`${product.name} by ${product.brand.name}`}
            className="aspect-square w-full rounded-none border-0 border-b border-border"
          />
        )}

        <div className="flex flex-1 flex-col gap-2 p-4">
          <p className="font-mono text-[0.65rem] tracking-[0.2em] text-muted-foreground uppercase">
            {product.brand.name}
          </p>

          <h3 className="text-sm leading-6 font-medium text-foreground group-hover:text-accent">
            {product.name}
          </h3>

          {product.categories.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              {product.categories.map((category) => category.name).join(" · ")}
            </p>
          ) : null}

          <div className="mt-auto flex flex-wrap items-baseline gap-x-2 gap-y-1 pt-2">
            <span className="font-mono text-base text-foreground">
              {formatInr(product.price)}
            </span>

            {discounted && product.compareAtPrice !== null ? (
              <span className="font-mono text-xs text-muted-foreground line-through">
                {formatInr(product.compareAtPrice)}
              </span>
            ) : null}
          </div>

          <p className="text-xs">
            {availability.isInStock ? (
              <span className="text-muted-foreground">
                {availability.availableQuantity <= 5
                  ? `Only ${availability.availableQuantity} left`
                  : "In stock"}
              </span>
            ) : (
              <span className="text-muted-foreground">Out of stock</span>
            )}
          </p>
        </div>
      </Link>

      {product.isFeatured ? (
        <span className="absolute top-3 right-3 rounded-xs border border-accent/40 bg-surface-raised/90 px-2 py-0.5 font-mono text-[0.6rem] tracking-[0.15em] text-accent uppercase">
          Featured
        </span>
      ) : null}

      {discounted ? (
        <span className="sr-only">
          Reduced from {formatInr(product.compareAtPrice ?? product.price)}
        </span>
      ) : null}
    </li>
  );
}