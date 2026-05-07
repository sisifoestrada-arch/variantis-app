/**
 * Variantis – Module B: Collection Display
 * Shows product variants as separate cards in collection / homepage / search pages.
 * Config is injected via the liquid block from the app proxy endpoint.
 */
(function () {
  "use strict";

  class VariantisCollection {
    constructor(config) {
      this.config = config;
      // config shape:
      // {
      //   collectionId: string,
      //   enabled: boolean,
      //   splitByOption: string,
      //   hideOutOfStock: boolean,
      //   showOnlyDiscount: boolean,
      //   hideWithoutImage: boolean,
      //   titleFormat: "product_variant" | "variant_only" | "product_only" | "custom",
      //   customTitleFormat: string,
      //   variants: [{ variantId, productId, variantTitle, productTitle, imageUrl,
      //                hoverImageUrl, price, availableForSale, visible, position }]
      // }
      this.run();
    }

    run() {
      if (!this.config.enabled) return;

      // Find all product cards in the collection grid
      const productCards = this.findProductCards();
      if (productCards.length === 0) return;

      productCards.forEach((card) => this.expandCard(card));
    }

    findProductCards() {
      const selectors = [
        ".product-item",          // Common
        ".grid__item",            // Dawn
        ".collection-grid__item", // Debut
        "[data-product-id]",      // Generic
        ".product-card",          // Prestige/Impulse
        "li.grid__item",          // Various
        ".boost-pfs-filter-product-item", // Boost filter app
      ];

      for (const sel of selectors) {
        const items = document.querySelectorAll(sel);
        if (items.length > 0) return Array.from(items);
      }
      return [];
    }

    getProductIdFromCard(card) {
      // Try data attributes first
      if (card.dataset.productId) return card.dataset.productId;

      // Try link href pattern /products/handle
      const link = card.querySelector("a[href*='/products/']");
      if (!link) return null;

      // Extract handle, then match against our variant list by title
      const match = link.href.match(/\/products\/([^?#/]+)/);
      return match ? match[1] : null; // returns handle
    }

    expandCard(card) {
      const productHandle = this.getProductHandleFromCard(card);
      if (!productHandle) return;

      // Get all variants for this product that should be shown
      const productVariants = this.config.variants.filter((v) => {
        const handle = v.productHandle || v.productTitle.toLowerCase().replace(/\s+/g, "-");
        return handle === productHandle && v.visible;
      });

      if (productVariants.length <= 1) return; // Nothing to expand

      // Apply display rules
      const visibleVariants = productVariants.filter((v) => {
        if (this.config.hideOutOfStock && !v.availableForSale) return false;
        if (this.config.hideWithoutImage && !v.imageUrl) return false;
        return true;
      });

      if (visibleVariants.length <= 1) return;

      // Sort by position
      visibleVariants.sort((a, b) => a.position - b.position);

      // Replace the single card with multiple variant cards
      const parent = card.parentElement;
      if (!parent) return;

      const insertBefore = card.nextSibling;

      visibleVariants.forEach((v, idx) => {
        const newCard = this.createVariantCard(card, v);
        if (idx === 0) {
          // Replace original card
          parent.replaceChild(newCard, card);
        } else {
          parent.insertBefore(newCard, insertBefore);
        }
      });
    }

    getProductHandleFromCard(card) {
      const link = card.querySelector("a[href*='/products/']");
      if (!link) return null;
      const match = link.href.match(/\/products\/([^?#/]+)/);
      return match ? match[1] : null;
    }

    buildTitle(variant) {
      const { titleFormat, customTitleFormat } = this.config;
      switch (titleFormat) {
        case "variant_only":
          return variant.variantTitle;
        case "product_only":
          return variant.productTitle;
        case "custom":
          return (customTitleFormat || "{product} - {variant}")
            .replace("{product}", variant.productTitle)
            .replace("{variant}", variant.variantTitle);
        default: // product_variant
          return `${variant.productTitle} - ${variant.variantTitle}`;
      }
    }

    createVariantCard(originalCard, variant) {
      const clone = originalCard.cloneNode(true);

      // Update image
      const img = clone.querySelector("img");
      if (img && variant.imageUrl) {
        img.src = variant.imageUrl;
        img.srcset = variant.imageUrl;
        img.alt = this.buildTitle(variant);

        // Hover image
        if (variant.hoverImageUrl) {
          img.addEventListener("mouseenter", () => {
            img.src = variant.hoverImageUrl;
          });
          img.addEventListener("mouseleave", () => {
            img.src = variant.imageUrl;
          });
        }
      }

      // Update title
      const titleEl =
        clone.querySelector(".card__heading a") ||
        clone.querySelector(".product-item__title") ||
        clone.querySelector("h2 a") ||
        clone.querySelector("h3 a") ||
        clone.querySelector(".product-card__title");

      if (titleEl) titleEl.textContent = this.buildTitle(variant);

      // Update price (show variant price)
      const priceEl =
        clone.querySelector(".price__regular .price-item") ||
        clone.querySelector(".product-item__price") ||
        clone.querySelector(".price");
      if (priceEl && variant.price) {
        priceEl.textContent = this.formatMoney(parseFloat(variant.price));
      }

      // Update links to point to variant-specific URL
      clone.querySelectorAll("a[href*='/products/']").forEach((link) => {
        const variantNumericId = variant.variantId.replace(
          "gid://shopify/ProductVariant/",
          "",
        );
        const url = new URL(link.href);
        url.searchParams.set("variant", variantNumericId);
        link.href = url.toString();
      });

      // Update add-to-cart form
      const variantInput = clone.querySelector('input[name="id"]');
      if (variantInput) {
        variantInput.value = variant.variantId.replace(
          "gid://shopify/ProductVariant/",
          "",
        );
      }

      // Sold out badge
      if (!variant.availableForSale) {
        const badge = clone.querySelector(".badge, .product-item__badge");
        if (badge) {
          badge.textContent = "Sold out";
          badge.style.display = "";
        }
      }

      // Mark as variantis-generated
      clone.setAttribute("data-variantis", "true");
      clone.setAttribute("data-variant-id", variant.variantId);

      return clone;
    }

    formatMoney(amount) {
      return new Intl.NumberFormat(document.documentElement.lang || "en", {
        style: "currency",
        currency: window.Shopify?.currency?.active || "USD",
      }).format(amount);
    }
  }

  // Boot: config is injected by the liquid block
  function boot() {
    const dataEl = document.getElementById("variantis-collection-data");
    if (!dataEl) return;

    try {
      const configs = JSON.parse(dataEl.textContent || "[]");
      configs.forEach((config) => new VariantisCollection(config));
    } catch (e) {
      console.warn("[Variantis] Could not parse collection config", e);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
