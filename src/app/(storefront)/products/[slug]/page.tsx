import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AddToCartForm } from "@/components/cart/add-to-cart-form";
import { PlaceholderImage } from "@/components/catalog/placeholder-image";
import { ProductCard } from "@/components/catalog/product-card";
import { Container } from "@/components/ui/container";
import { catalogHref } from "@/lib/catalog-url";
import { getRelatedProducts } from "@/lib/dal/catalog";
import { getCachedProductBySlug } from "@/lib/dal/catalog-cache";
import { logger } from "@/lib/logger";
import { formatInr } from "@/lib/money";
import { SITE_NAME } from "@/lib/site";
import {
  isDiscounted,
  type AppliedCatalogQuery,
  type CatalogProductDetail,
  type CatalogProductListItem,
  type WatchSpecification,
} from "@/lib/types/catalog";
import { DEFAULT_CATALOG_PAGE_SIZE, DEFAULT_CATALOG_SORT } from "@/lib/validation/catalog";

/**
 * A single product page.
 *
 * ## One answer for every kind of "not found"
 *
 * `getProductBySlug` returns `null` for an unknown slug, an unpublished product *and* a
 * product whose brand was deactivated, and this page renders the same 404 for all three
 * (`docs/security-plan.md` §12). A visitor cannot use the response to learn that a product
 * exists but is hidden, which is what distinguishing them would leak.
 *
 * ## Related products
 *
 * Read outside the cached wrapper, because the query depends on this product's categories
 * and brand, which are only known after the detail read. It is still one bounded query
 * (`getRelatedProducts` caps its own limit), and a failure degrades the section rather
 * than the page: the product itself is worth rendering even if recommendations are not.
 *
 * ## Images
 *
 * Product image storage keys remain private. The server-side DAL resolves available image
 * keys into short-lived signed URLs, and this page passes those URLs to Next Image.
 * Products without an available image URL continue to render the approved placeholder.
 */

export async function generateMetadata({
  params,
}: PageProps<"/products/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const product = await getCachedProductBySlug(slug);

  if (!product) {
    // The page renders the 404 UI; a generic title avoids advertising the requested slug.
    return { title: "Watch not found" };
  }

  return {
    title: product.name,
    description:
      product.shortDescription ??
      `${product.name} by ${product.brand.name}, available at ${SITE_NAME}.`,
    alternates: { canonical: `/products/${product.slug}` },
  };
}

export default async function ProductPage({ params }: PageProps<"/products/[slug]">) {
  const { slug } = await params;
  const product = await getCachedProductBySlug(slug);

  if (!product) {
    notFound();
  }

  const related = await relatedOrEmpty(product);
  const discounted = isDiscounted(product.price, product.compareAtPrice);

  return (
    <Container className="flex flex-1 flex-col gap-10 py-14 sm:py-20">
      <Breadcrumbs product={product} />

      <div className="grid gap-10 lg:grid-cols-2">
        <Gallery product={product} />

        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <Link
              href={catalogHref(FRESH_LISTING, { brand: product.brand.slug })}
              className="w-fit font-mono text-xs tracking-[0.2em] text-accent uppercase hover:underline"
            >
              {product.brand.name}
            </Link>

            <h1 className="text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-4xl">
              {product.name}
            </h1>

            <p className="font-mono text-xs text-muted-foreground">SKU {product.sku}</p>
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-mono text-2xl text-foreground">
                {formatInr(product.price)}
              </span>

              {discounted && product.compareAtPrice !== null ? (
                <span className="font-mono text-sm text-muted-foreground line-through">
                  {formatInr(product.compareAtPrice)}
                </span>
              ) : null}
            </div>

            <p className="text-sm text-muted-foreground">
              {discounted && product.compareAtPrice !== null ? (
                <span className="sr-only">
                  Reduced from {formatInr(product.compareAtPrice)}.{" "}
                </span>
              ) : null}
              {availabilityLabel(product)}
            </p>
          </div>

          {product.shortDescription ? (
            <p className="max-w-prose text-sm leading-6 text-muted-foreground">
              {product.shortDescription}
            </p>
          ) : null}

          {product.categories.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h2 className="text-xs tracking-[0.2em] text-muted-foreground uppercase">
                Categories
              </h2>

              <ul className="flex flex-wrap gap-2">
                {product.categories.map((category) => (
                  <li key={category.id}>
                    <Link
                      href={catalogHref(FRESH_LISTING, { category: category.slug })}
                      className="block rounded-xs border border-border px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-surface-muted hover:text-foreground"
                    >
                      {category.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <AddToCartForm
            productId={product.id}
            availableQuantity={product.availability.availableQuantity}
          />
        </div>
      </div>

      {product.description ? (
        <section aria-labelledby="description-heading" className="flex flex-col gap-3">
          <h2
            id="description-heading"
            className="text-xs tracking-[0.2em] text-muted-foreground uppercase"
          >
            About this watch
          </h2>

          <p className="max-w-prose text-sm leading-7 whitespace-pre-line text-muted-foreground">
            {product.description}
          </p>
        </section>
      ) : null}

      {product.specifications.length > 0 || product.additionalSpecifications.length > 0 ? (
        <Specifications product={product} />
      ) : null}

      {related.length > 0 ? (
        <section aria-labelledby="related-heading" className="flex flex-col gap-5">
          <h2
            id="related-heading"
            className="text-xs tracking-[0.2em] text-muted-foreground uppercase"
          >
            You may also like
          </h2>

          <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            {related.map((item) => (
              <ProductCard key={item.id} product={item} />
            ))}
          </ul>
        </section>
      ) : null}
    </Container>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * A listing query with every default applied.
 *
 * A product page has no listing state of its own, so its brand and category chips open a
 * *fresh* listing — they do not inherit filters the visitor never set on this page. The
 * value is passed through `catalogHref`, so the resulting URL is the canonical one a user
 * would reach by clearing everything else.
 */
const FRESH_LISTING: AppliedCatalogQuery = {
  q: "",
  category: "",
  brand: "",
  sort: DEFAULT_CATALOG_SORT,
  minPrice: undefined,
  maxPrice: undefined,
  page: 1,
  pageSize: DEFAULT_CATALOG_PAGE_SIZE,
};

/**
 * Related products, or nothing.
 *
 * A recommendation query failing must not take the page down with it: the visitor asked
 * for one product and that product is available. The reason is logged server-side with the
 * slug — never rendered — so the failure is still visible to operators.
 */
async function relatedOrEmpty(product: CatalogProductDetail): Promise<CatalogProductListItem[]> {
  try {
    return await getRelatedProducts(product);
  } catch (error) {
    logger.error("catalog.related.failed", { error, slug: product.slug });

    return [];
  }
}

/** Availability sentence, from the server-computed figures only. */
function availabilityLabel(product: CatalogProductDetail): string {
  const { availability } = product;

  if (!availability.isInStock) {
    return "Out of stock";
  }

  if (availability.availableQuantity <= 5) {
    return `Only ${availability.availableQuantity} left in stock`;
  }

  return "In stock and ready to ship";
}

/** The product's place in the catalogue, as links a visitor can back out through. */
function Breadcrumbs({ product }: { product: CatalogProductDetail }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <li>
          <Link href="/" className="transition-colors hover:text-foreground">
            Home
          </Link>
        </li>

        <li aria-hidden className="text-border">
          /
        </li>

        <li>
          <Link href="/products" className="transition-colors hover:text-foreground">
            Watches
          </Link>
        </li>

        <li aria-hidden className="text-border">
          /
        </li>

        <li aria-current="page" className="text-foreground">
          {product.name}
        </li>
      </ol>
    </nav>
  );
}

/**
 * The gallery.
 *
 * The DAL provides short-lived signed URLs for private product images. The primary image
 * is displayed first, followed by any remaining catalogue images. If no usable signed
 * URL exists, the approved placeholder remains the fallback.
 */
function Gallery({ product }: { product: CatalogProductDetail }) {
  const images = product.images.filter((image) => image.url !== null);
  const imageCount = product.images.length;

  return (
    <section aria-labelledby="gallery-heading" className="flex flex-col gap-3">
      <h2 id="gallery-heading" className="sr-only">
        Product images
      </h2>

      {images.length > 0 ? (
        <div className="grid gap-3">
          {images.map((image, index) => (
            <div
              key={image.id}
              className="relative aspect-square w-full overflow-hidden rounded-md border border-border bg-surface-raised"
            >
              <Image
                src={image.url!}
                alt={
                  image.altText ??
                  `${product.name} by ${product.brand.name}${index > 0 ? ` — image ${index + 1}` : ""}`
                }
                fill
                priority={index === 0}
                sizes="(min-width: 1024px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      ) : (
        <PlaceholderImage
          label={`${product.name} by ${product.brand.name}`}
          className="aspect-square w-full"
        />
      )}

      <p className="text-xs text-muted-foreground">
        {imageCount === 0
          ? "No product photography has been published for this watch yet."
          : imageCount === 1
            ? "1 product photograph is held for this watch."
            : `${imageCount} product photographs are held for this watch.`}
      </p>
    </section>
  );
}

/** The specification tables: labelled watch attributes, then any extra pair the catalogue holds. */
function Specifications({ product }: { product: CatalogProductDetail }) {
  return (
    <section aria-labelledby="specifications-heading" className="flex flex-col gap-4">
      <h2
        id="specifications-heading"
        className="text-xs tracking-[0.2em] text-muted-foreground uppercase"
      >
        Specifications
      </h2>

      {product.specifications.length > 0 ? (
        <SpecificationTable caption="Watch attributes" rows={product.specifications} />
      ) : null}

      {product.additionalSpecifications.length > 0 ? (
        <SpecificationTable caption="Additional details" rows={product.additionalSpecifications} />
      ) : null}
    </section>
  );
}

/**
 * A definition-style table of label/value pairs.
 *
 * Rendered as `<dl>` rather than `<table>`: it is a list of attributes, not tabular data,
 * and a screen reader announces it as such without a guessed header row.
 */
function SpecificationTable({
  caption,
  rows,
}: {
  caption: string;
  rows: readonly WatchSpecification[];
}) {
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <p className="border-b border-border bg-surface px-4 py-2 text-xs tracking-[0.2em] text-muted-foreground uppercase">
        {caption}
      </p>

      <dl className="grid gap-px bg-border sm:grid-cols-2">
        {rows.map((row) => (
          <div
            key={`${row.label}:${row.value}`}
            className="flex flex-col gap-1 bg-surface-raised p-4"
          >
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="text-sm text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}