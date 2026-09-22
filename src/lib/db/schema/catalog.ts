import { bigint, boolean, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

/**
 * READ-ONLY mirror of the shared catalog tables.
 *
 * Ownership: `admin-backend` owns these tables and its Drizzle migration lineage
 * (`admin-backend/drizzle/`). Chronospeed mirrors the column shapes so its queries
 * are type-safe, and **never** writes to them (see `docs/database-plan.md` §2.9).
 *
 * Rules:
 * - column names, types, nullability and defaults must match the real DDL exactly;
 * - do not add indexes, checks or relations here — those are DDL and belong to the
 *   owner's lineage. Changing them from Chronospeed would be a catalog mutation;
 * - do not "fix" anything that looks unusual (`categories.parent_id` intentionally
 *   has no foreign key; `products.price` is a whole-unit `bigint`, not paise).
 */

/** Admin-owned. Mirrors `admin-backend/src/db/schema.ts` -> `brands`. */
export const brands = pgTable("brands", {
  id: uuid("id").defaultRandom().primaryKey(),

  name: varchar("name", { length: 100 }).notNull().unique(),

  slug: varchar("slug", { length: 120 }).notNull().unique(),

  description: text("description"),

  logoStorageKey: text("logo_storage_key"),

  websiteUrl: text("website_url"),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Admin-owned. Mirrors `admin-backend/src/db/schema.ts` -> `categories`.
 *
 * `parentId` is a plain `uuid` with **no foreign key** — deliberate in the admin
 * schema (hierarchy is validated in application code). Mirrored as-is.
 */
export const categories = pgTable("categories", {
  id: uuid("id").defaultRandom().primaryKey(),

  parentId: uuid("parent_id"),

  name: varchar("name", { length: 100 }).notNull(),

  slug: varchar("slug", { length: 120 }).notNull().unique(),

  description: text("description"),

  imageStorageKey: text("image_storage_key"),

  isActive: boolean("is_active").notNull().default(true),

  sortOrder: integer("sort_order").notNull().default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Admin-owned. Mirrors `admin-backend/src/db/schema.ts` -> `products`.
 *
 * `price` / `compareAtPrice` are `bigint` **whole INR units** read in `number`
 * mode: `12999` is ₹12,999 (see `docs/database-plan.md` §9). Never convert to paise.
 */
export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),

  brandId: uuid("brand_id").notNull(),

  name: varchar("name", { length: 200 }).notNull(),

  slug: varchar("slug", { length: 220 }).notNull().unique(),

  sku: varchar("sku", { length: 100 }).notNull().unique(),

  shortDescription: text("short_description"),

  description: text("description"),

  price: bigint("price", { mode: "number" }).notNull(),

  compareAtPrice: bigint("compare_at_price", { mode: "number" }),

  currency: varchar("currency", { length: 3 }).notNull().default("INR"),

  thumbnailStorageKey: text("thumbnail_storage_key"),

  isFeatured: boolean("is_featured").notNull().default(false),

  isActive: boolean("is_active").notNull().default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Admin-owned. Mirrors `admin-backend/src/db/schema.ts` -> `product_categories`.
 */
export const productCategories = pgTable(
  "product_categories",
  {
    productId: uuid("product_id").notNull(),

    categoryId: uuid("category_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.productId, table.categoryId] })],
);

/**
 * Admin-owned. Mirrors `admin-backend/src/db/schema.ts` -> `watch_details`.
 *
 * Numeric dimensions are `numeric(6, 2)` and therefore returned by Drizzle as
 * `string` — they are not money and must not be parsed into floats for display.
 */
export const watchDetails = pgTable("watch_details", {
  id: uuid("id").defaultRandom().primaryKey(),

  productId: uuid("product_id").notNull().unique(),

  watchType: varchar("watch_type", { length: 50 }),

  movement: varchar("movement", { length: 100 }),

  caseMaterial: varchar("case_material", { length: 100 }),

  caseShape: varchar("case_shape", { length: 50 }),

  caseDiameter: numeric("case_diameter", { precision: 6, scale: 2 }),

  caseThickness: numeric("case_thickness", { precision: 6, scale: 2 }),

  strapMaterial: varchar("strap_material", { length: 100 }),

  strapColor: varchar("strap_color", { length: 50 }),

  dialColor: varchar("dial_color", { length: 50 }),

  glassMaterial: varchar("glass_material", { length: 100 }),

  waterResistance: varchar("water_resistance", { length: 100 }),

  powerReserve: varchar("power_reserve", { length: 100 }),

  warrantyPeriod: varchar("warranty_period", { length: 100 }),

  gender: varchar("gender", { length: 30 }),

  additionalSpecifications: jsonb("additional_specifications"),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Admin-owned. Mirrors `admin-backend/src/db/schema.ts` -> `product_images`.
 *
 * `storageKey` is an object-storage **key**, never a URL. Resolve it through the
 * signed-URL helper (Phase 3) — never concatenate it into a public URL.
 */
export const productImages = pgTable("product_images", {
  id: uuid("id").defaultRandom().primaryKey(),

  productId: uuid("product_id").notNull(),

  storageKey: text("storage_key").notNull(),

  altText: varchar("alt_text", { length: 255 }),

  sortOrder: integer("sort_order").notNull().default(0),

  isPrimary: boolean("is_primary").notNull().default(false),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Admin-owned. Mirrors `admin-backend/src/db/schema.ts` -> `inventory`.
 *
 * Chronospeed reads this table. `reservedQuantity` is adjusted only by the Phase 8
 * reservation service, inside a transaction. Customer-visible availability is
 * `quantity - reservedQuantity` (computed, never stored). The database enforces
 * `reserved_quantity <= quantity` and non-negative values.
 */
export const inventory = pgTable("inventory", {
  id: uuid("id").defaultRandom().primaryKey(),

  productId: uuid("product_id").notNull().unique(),

  quantity: integer("quantity").notNull().default(0),

  reservedQuantity: integer("reserved_quantity").notNull().default(0),

  lowStockThreshold: integer("low_stock_threshold").notNull().default(5),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A derived view of a catalog row, not a table. Used by the DAL so callers depend
 * on a stable shape instead of the raw Drizzle row type.
 */
export interface CatalogAvailability {
  readonly quantity: number;
  readonly reservedQuantity: number;
  /** Units a customer may actually buy. Never negative. */
  readonly availableQuantity: number;
  readonly isInStock: boolean;
}
