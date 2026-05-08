/**
 * Variantis – Module B: Collection Display
 * Splits product cards by variant on collection / homepage / search pages.
 *
 * Reads shop.metafields.variantis.all_configs which has shape:
 * {
 *   enabled, splitByOption, hideOutOfStock, showOnlyDiscount, hideWithoutImage,
 *   titleFormat, customTitleFormat,
 *   productHandles: { "<handle>": [variant, variant, ...] },
 *   collections: { "<collectionGid>": {settings...} }
 * }
 *
 * Each variant entry shape:
 * { variantId, productId, productHandle, variantTitle, productTitle,
 *   imageUrl, hoverImageUrl, price, availableForSale, optionValue,
 *   visible, position }
 */
(function () {
  "use strict";

  function findCards() {
    const selectors = [
      "product-card",
      "[data-product-handle]",
      ".product-item",
      ".grid__item",
      "li.grid__item",
      ".collection-grid__item",
      ".product-card",
      ".card-wrapper",
      "[data-product-id]",
      ".boost-pfs-filter-product-item",
    ];
    for (const sel of selectors) {
      const items = document.querySelectorAll(sel);
      if (items.length === 0) continue;
      const filtered = Array.from(items).filter((el) =>
        !!el.querySelector("a[href*='/products/']")
      );
      if (filtered.length > 0) return filtered;
    }
    return [];
  }

  function getProductHandle(card) {
    if (card.dataset?.productHandle) return card.dataset.productHandle;
    const link = card.querySelector("a[href*='/products/']");
    if (!link) return null;
    const match = link.href.match(/\/products\/([^?#/]+)/);
    return match ? match[1] : null;
  }

  function buildTitle(variant, settings) {
    const fmt = settings.titleFormat || "product_variant";
    switch (fmt) {
      case "variant_only":
        return variant.variantTitle;
      case "product_only":
        return variant.productTitle;
      case "custom":
        return (settings.customTitleFormat || "{product} - {variant}")
          .replace("{product}", variant.productTitle)
          .replace("{variant}", variant.variantTitle);
      default:
        return `${variant.productTitle} - ${variant.variantTitle}`;
    }
  }

  function formatMoney(amount) {
    if (!amount) return "";
    return new Intl.NumberFormat(document.documentElement.lang || "en", {
      style: "currency",
      currency: window.Shopify?.currency?.active || "USD",
    }).format(parseFloat(amount));
  }

  function createVariantCard(originalCard, variant, settings) {
    const clone = originalCard.cloneNode(true);

    // Update image
    const img = clone.querySelector("img");
    if (img && variant.imageUrl) {
      img.src = variant.imageUrl;
      if (img.srcset) img.srcset = variant.imageUrl;
      img.alt = buildTitle(variant, settings);

      if (variant.hoverImageUrl) {
        img.addEventListener("mouseenter", () => { img.src = variant.hoverImageUrl; });
        img.addEventListener("mouseleave", () => { img.src = variant.imageUrl; });
      }
    }

    // Update title (multiple theme patterns)
    const titleEl =
      clone.querySelector(".card__heading a") ||
      clone.querySelector(".card__heading") ||
      clone.querySelector(".product-item__title") ||
      clone.querySelector(".product-card__title") ||
      clone.querySelector("h2 a") ||
      clone.querySelector("h3 a") ||
      clone.querySelector("h2") ||
      clone.querySelector("h3");
    if (titleEl) titleEl.textContent = buildTitle(variant, settings);

    // Update price
    const priceEls = clone.querySelectorAll(
      ".price__regular .price-item, .price-item--regular, .product-item__price, .price, [class*='price']"
    );
    priceEls.forEach((el) => {
      if (el.querySelector("*")) return; // skip wrappers
      if (variant.price) el.textContent = formatMoney(variant.price);
    });

    // Update product links to ?variant=...
    const variantNumeric = String(variant.variantId).replace(
      /^gid:\/\/shopify\/ProductVariant\//,
      ""
    );
    clone.querySelectorAll("a[href*='/products/']").forEach((link) => {
      try {
        const url = new URL(link.href, window.location.origin);
        url.searchParams.set("variant", variantNumeric);
        link.href = url.toString();
      } catch {}
    });

    // Update add-to-cart variant input
    const variantInput = clone.querySelector('input[name="id"]');
    if (variantInput) variantInput.value = variantNumeric;

    // Sold out badge
    if (!variant.availableForSale) {
      const badge = clone.querySelector(".badge, .product-item__badge");
      if (badge) {
        badge.textContent = "Sold out";
        badge.style.display = "";
      }
    }

    clone.setAttribute("data-variantis", "true");
    clone.setAttribute("data-variant-id", variant.variantId);
    return clone;
  }

  function expandCard(card, config) {
    if (card.dataset?.variantis === "true") return;
    const handle = getProductHandle(card);
    if (!handle) return;

    const variants = config.productHandles?.[handle];
    if (!variants || variants.length <= 1) return;

    // Apply visibility rules
    const visible = variants
      .filter((v) => v.visible !== false)
      .filter((v) => !(config.hideOutOfStock && !v.availableForSale))
      .filter((v) => !(config.hideWithoutImage && !v.imageUrl))
      .sort((a, b) => (a.position || 0) - (b.position || 0));

    if (visible.length <= 1) return;

    const parent = card.parentElement;
    if (!parent) return;

    const insertBefore = card.nextSibling;

    visible.forEach((v, idx) => {
      const newCard = createVariantCard(card, v, config);
      if (idx === 0) {
        parent.replaceChild(newCard, card);
      } else {
        parent.insertBefore(newCard, insertBefore);
      }
    });
  }

  function run(config) {
    if (!config || !config.enabled) return;
    const cards = findCards();
    cards.forEach((card) => expandCard(card, config));
  }

  function boot() {
    const dataEl = document.getElementById("variantis-collection-data");
    if (!dataEl) return;

    let config;
    try {
      const raw = dataEl.textContent?.trim();
      if (!raw || raw === "[]" || raw === "null") return;
      config = JSON.parse(raw);
    } catch (e) {
      console.warn("[Variantis] Could not parse collection config", e);
      return;
    }

    // Support both old and new format
    if (Array.isArray(config)) {
      // Legacy: array of per-collection configs — pick first
      config = config[0];
      if (!config) return;
    }

    run(config);

    // Re-run when DOM changes (filters, infinite scroll, AJAX pagination)
    const observer = new MutationObserver(() => run(config));
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
