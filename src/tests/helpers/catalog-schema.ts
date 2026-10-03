import type { TestDatabase } from "./db";

/**
 * The shared catalogue's DDL, for tests only.
 *
 * ## Why this exists
 *
 * The catalogue tables are owned by `admin-backend` and live in **its** Drizzle migration
 * lineage (`admin-backend/drizzle/0000..0001`). Chronospeed must never create or alter
 * them, so it cannot generate a migration for them either: `drizzle-kit generate` in this
 * repository would either try to create a second copy of `products` or emit no SQL at
 * all, and either outcome is wrong.
 *
 * So tests that touch the catalogue need the real DDL from somewhere. This module is that
 * somewhere: the statements below are the **final state** of `admin-backend`'s catalogue
 * after migrations `0000_cooing_moon_knight` and `0001_chilly_steve_rogers`, transcribed
 * unchanged — same column names, same types, same nullability, same defaults, same
 * constraints and indexes.
 *
 * It is a test fixture, not a migration. Nothing applies it outside Vitest, and no
 * application code may depend on it.
 *
 * ## Why it is worth maintaining
 *
 * Every test inserts through the mirrored schema in `@/lib/db/schema/catalog`, so this
 * DDL is what proves the mirror is faithful: a column renamed or retyped in
 * `src/lib/db/schema/catalog.ts` stops matching these tables and the suite fails
 * immediately, instead of the storefront discovering it in production.
 */

export const CATALOG_DDL = `
CREATE TABLE "brands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" text,
	"logo_storage_key" text,
	"website_url" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "brands_name_unique" UNIQUE("name"),
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);

CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(120) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parent_id" uuid,
	"image_storage_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);

CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(200) NOT NULL,
	"slug" varchar(220) NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"brand_id" uuid NOT NULL,
	"sku" varchar(100) NOT NULL,
	"short_description" text,
	"price" bigint NOT NULL,
	"compare_at_price" bigint,
	"currency" varchar(3) DEFAULT 'INR' NOT NULL,
	"thumbnail_storage_key" text,
	"is_featured" boolean DEFAULT false NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug"),
	CONSTRAINT "products_sku_unique" UNIQUE("sku"),
	CONSTRAINT "products_price_non_negative_check" CHECK ("products"."price" >= 0),
	CONSTRAINT "products_compare_at_price_non_negative_check" CHECK ("products"."compare_at_price" IS NULL OR "products"."compare_at_price" >= 0)
);

CREATE TABLE "inventory" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"reserved_quantity" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 5 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_product_id_unique" UNIQUE("product_id"),
	CONSTRAINT "inventory_quantity_non_negative_check" CHECK ("inventory"."quantity" >= 0),
	CONSTRAINT "inventory_reserved_quantity_non_negative_check" CHECK ("inventory"."reserved_quantity" >= 0),
	CONSTRAINT "inventory_low_stock_threshold_non_negative_check" CHECK ("inventory"."low_stock_threshold" >= 0),
	CONSTRAINT "inventory_reserved_not_greater_than_quantity_check" CHECK ("inventory"."reserved_quantity" <= "inventory"."quantity")
);

CREATE TABLE "product_categories" (
	"product_id" uuid NOT NULL,
	"category_id" uuid NOT NULL,
	CONSTRAINT "product_categories_pk" PRIMARY KEY("product_id","category_id")
);

CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"alt_text" varchar(255),
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "watch_details" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"watch_type" varchar(50),
	"movement" varchar(100),
	"case_material" varchar(100),
	"case_shape" varchar(50),
	"case_diameter" numeric(6, 2),
	"case_thickness" numeric(6, 2),
	"strap_material" varchar(100),
	"strap_color" varchar(50),
	"dial_color" varchar(50),
	"glass_material" varchar(100),
	"water_resistance" varchar(100),
	"power_reserve" varchar(100),
	"warranty_period" varchar(100),
	"gender" varchar(30),
	"additional_specifications" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "watch_details_product_id_unique" UNIQUE("product_id")
);
`;

/** Foreign keys, matching the admin migrations' final state. */
const CATALOG_FOREIGN_KEYS = `
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE restrict ON UPDATE cascade;
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE cascade;
ALTER TABLE "watch_details" ADD CONSTRAINT "watch_details_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE cascade;
`;

/** Indexes, matching the admin migrations' final state. */
const CATALOG_INDEXES = `
CREATE INDEX "brands_is_active_idx" ON "brands" USING btree ("is_active");
CREATE INDEX "brands_name_idx" ON "brands" USING btree ("name");
CREATE INDEX "inventory_product_id_idx" ON "inventory" USING btree ("product_id");
CREATE INDEX "product_categories_category_id_idx" ON "product_categories" USING btree ("category_id");
CREATE INDEX "product_images_product_id_idx" ON "product_images" USING btree ("product_id");
CREATE INDEX "product_images_sort_order_idx" ON "product_images" USING btree ("product_id","sort_order");
CREATE INDEX "watch_details_product_id_idx" ON "watch_details" USING btree ("product_id");
CREATE INDEX "categories_parent_id_idx" ON "categories" USING btree ("parent_id");
CREATE INDEX "categories_is_active_idx" ON "categories" USING btree ("is_active");
CREATE INDEX "categories_sort_order_idx" ON "categories" USING btree ("sort_order");
CREATE INDEX "products_brand_id_idx" ON "products" USING btree ("brand_id");
CREATE INDEX "products_is_active_idx" ON "products" USING btree ("is_active");
CREATE INDEX "products_is_featured_idx" ON "products" USING btree ("is_featured");
CREATE INDEX "products_name_idx" ON "products" USING btree ("name");
`;

/**
 * Create the shared catalogue tables in an existing test database.
 *
 * Runs through PGlite's `exec`, which accepts a multi-statement script — the same shape
 * `drizzle-kit` emits, minus the `--> statement-breakpoint` markers it uses to split it.
 */
export async function applyCatalogSchema(handle: TestDatabase): Promise<void> {
  await handle.client.exec(`${CATALOG_DDL}${CATALOG_FOREIGN_KEYS}${CATALOG_INDEXES}`);
}

/**
 * Empty every catalogue table.
 *
 * `TRUNCATE ... CASCADE` is used because the tables reference each other, and it is one
 * statement rather than an order-sensitive sequence of `DELETE`s. It runs only against
 * the in-memory PGlite database the suite creates.
 */
export async function clearCatalogData(handle: TestDatabase): Promise<void> {
  await handle.client.exec(
    `TRUNCATE TABLE "watch_details", "product_images", "product_categories", "inventory", "products", "categories", "brands" CASCADE;`,
  );
}