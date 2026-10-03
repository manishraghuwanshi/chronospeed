import { eq } from "drizzle-orm";

import {
  brands,
  categories,
  inventory,
  productCategories,
  productImages,
  products,
  watchDetails,
} from "@/lib/db/schema/catalog";

import type { TestDatabase } from "./db";

/**
 * Catalogue fixtures, shared by the storefront catalogue suites.
 *
 * Everything is inserted through the mirrored schema against the real admin DDL
 * (`./catalog-schema.ts`), which is what makes these helpers double as a faithfulness
 * check on that mirror.
 *
 * Two conventions worth stating, because the tests depend on them:
 *
 * - **Money is whole INR units.** `12999` is ₹12,999. Nothing here is in paise.
 * - **Prices and names are deliberately out of step.** Prices are distinct and names sort
 *   in a different order from prices, so a wrong `ORDER BY` fails the test instead of
 *   accidentally passing.
 */

export interface SeedBrandInput {
  readonly name: string;
  readonly slug: string;
  readonly isActive?: boolean;
  readonly logoStorageKey?: string | null;
}

export interface SeedCategoryInput {
  readonly name: string;
  readonly slug: string;
  readonly isActive?: boolean;
  readonly sortOrder?: number;
}

export interface SeedProductInput {
  readonly name: string;
  readonly slug: string;
  readonly sku: string;
  readonly brandId: string;
  readonly price: number;
  readonly compareAtPrice?: number | null;
  readonly shortDescription?: string | null;
  readonly description?: string | null;
  readonly currency?: string;
  readonly isFeatured?: boolean;
  readonly isActive?: boolean;
  readonly thumbnailStorageKey?: string | null;
  /** Distinct creation instants, so "newest first" is deterministic in a test. */
  readonly createdAt?: Date;
  /** Omit the row entirely to model a product with no inventory record. */
  readonly inventory?: { readonly quantity: number; readonly reservedQuantity?: number } | null;
  readonly categoryIds?: readonly string[];
  readonly watchDetails?: SeedWatchDetailsInput | null;
  readonly images?: readonly SeedProductImageInput[];
}

export interface SeedWatchDetailsInput {
  readonly watchType?: string | null;
  readonly movement?: string | null;
  readonly caseMaterial?: string | null;
  readonly caseShape?: string | null;
  /** Passed as a string because the column is `numeric(6, 2)`, not a number. */
  readonly caseDiameter?: string | null;
  readonly caseThickness?: string | null;
  readonly strapMaterial?: string | null;
  readonly strapColor?: string | null;
  readonly dialColor?: string | null;
  readonly glassMaterial?: string | null;
  readonly waterResistance?: string | null;
  readonly powerReserve?: string | null;
  readonly warrantyPeriod?: string | null;
  readonly gender?: string | null;
  readonly additionalSpecifications?: unknown;
}

export interface SeedProductImageInput {
  readonly storageKey: string;
  readonly altText?: string | null;
  readonly sortOrder?: number;
  readonly isPrimary?: boolean;
}

export async function seedBrand(handle: TestDatabase, input: SeedBrandInput) {
  const [row] = await handle.db
    .insert(brands)
    .values({
      name: input.name,
      slug: input.slug,
      isActive: input.isActive ?? true,
      logoStorageKey: input.logoStorageKey ?? null,
    })
    .returning();

  return row!;
}

export async function seedCategory(handle: TestDatabase, input: SeedCategoryInput) {
  const [row] = await handle.db
    .insert(categories)
    .values({
      name: input.name,
      slug: input.slug,
      isActive: input.isActive ?? true,
      sortOrder: input.sortOrder ?? 0,
    })
    .returning();

  return row!;
}

/**
 * Insert a product and everything hanging off it.
 *
 * `inventory` defaults to an in-stock row; passing `null` deliberately leaves the row
 * out, so a test can assert the "no inventory record → out of stock" behaviour.
 */
export async function seedProduct(handle: TestDatabase, input: SeedProductInput) {
  const [row] = await handle.db
    .insert(products)
    .values({
      name: input.name,
      slug: input.slug,
      sku: input.sku,
      brandId: input.brandId,
      price: input.price,
      compareAtPrice: input.compareAtPrice ?? null,
      shortDescription: input.shortDescription ?? null,
      description: input.description ?? null,
      currency: input.currency ?? "INR",
      isFeatured: input.isFeatured ?? false,
      isActive: input.isActive ?? true,
      thumbnailStorageKey: input.thumbnailStorageKey ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    })
    .returning();

  const product = row!;

  if (input.inventory !== null) {
    const stock = input.inventory ?? { quantity: 10 };

    await handle.db.insert(inventory).values({
      productId: product.id,
      quantity: stock.quantity,
      reservedQuantity: stock.reservedQuantity ?? 0,
    });
  }

  if (input.categoryIds && input.categoryIds.length > 0) {
    await handle.db
      .insert(productCategories)
      .values(input.categoryIds.map((categoryId) => ({ productId: product.id, categoryId })));
  }

  if (input.watchDetails) {
    await handle.db.insert(watchDetails).values({
      productId: product.id,
      watchType: input.watchDetails.watchType ?? null,
      movement: input.watchDetails.movement ?? null,
      caseMaterial: input.watchDetails.caseMaterial ?? null,
      caseShape: input.watchDetails.caseShape ?? null,
      caseDiameter: input.watchDetails.caseDiameter ?? null,
      caseThickness: input.watchDetails.caseThickness ?? null,
      strapMaterial: input.watchDetails.strapMaterial ?? null,
      strapColor: input.watchDetails.strapColor ?? null,
      dialColor: input.watchDetails.dialColor ?? null,
      glassMaterial: input.watchDetails.glassMaterial ?? null,
      waterResistance: input.watchDetails.waterResistance ?? null,
      powerReserve: input.watchDetails.powerReserve ?? null,
      warrantyPeriod: input.watchDetails.warrantyPeriod ?? null,
      gender: input.watchDetails.gender ?? null,
      additionalSpecifications: input.watchDetails.additionalSpecifications ?? null,
    });
  }

  if (input.images && input.images.length > 0) {
    await handle.db.insert(productImages).values(
      input.images.map((image) => ({
        productId: product.id,
        storageKey: image.storageKey,
        altText: image.altText ?? null,
        sortOrder: image.sortOrder ?? 0,
        isPrimary: image.isPrimary ?? false,
      })),
    );
  }

  return product;
}

/** Read a product row straight from the table, bypassing the DAL. */
export async function findProductRow(handle: TestDatabase, slug: string) {
  const [row] = await handle.db.select().from(products).where(eq(products.slug, slug)).limit(1);

  return row ?? null;
}

/** Read a product's inventory row straight from the table, bypassing the DAL. */
export async function findInventoryRow(handle: TestDatabase, productId: string) {
  const [row] = await handle.db
    .select()
    .from(inventory)
    .where(eq(inventory.productId, productId))
    .limit(1);

  return row ?? null;
}