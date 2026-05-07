-- CreateTable
CREATE TABLE "CollectionConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "collectionTitle" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "splitByOption" TEXT NOT NULL DEFAULT 'Color',
    "hideOutOfStock" BOOLEAN NOT NULL DEFAULT false,
    "showOnlyDiscount" BOOLEAN NOT NULL DEFAULT false,
    "hideWithoutImage" BOOLEAN NOT NULL DEFAULT false,
    "titleFormat" TEXT NOT NULL DEFAULT 'product_variant',
    "customTitleFormat" TEXT NOT NULL DEFAULT '{product} - {variant}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "VariantCollectionConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "variantTitle" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "hoverImageUrl" TEXT NOT NULL DEFAULT '',
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VariantCollectionConfig_shop_collectionId_fkey" FOREIGN KEY ("shop", "collectionId") REFERENCES "CollectionConfig" ("shop", "collectionId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CollectionConfig_shop_collectionId_key" ON "CollectionConfig"("shop", "collectionId");

-- CreateIndex
CREATE UNIQUE INDEX "VariantCollectionConfig_shop_collectionId_variantId_key" ON "VariantCollectionConfig"("shop", "collectionId", "variantId");
