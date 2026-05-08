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

    const variantNumeric = String(variant.variantId).replace(
      /^gid:\/\/shopify\/ProductVariant\//,
      ""
    );
    const uniqueSuffix = `variantis-${variantNumeric}`;

    // Make element ID unique to avoid Horizon dedup
    if (clone.id) clone.id = `${clone.id}-${uniqueSuffix}`;
    // Override data-product-id with variant ID so the custom element treats it as distinct
    if (clone.dataset) {
      clone.dataset.productId = variantNumeric;
      clone.dataset.variantId = variantNumeric;
    }
    // Rewrite all inner element IDs so DOM stays valid
    clone.querySelectorAll("[id]").forEach((el) => {
      el.id = `${el.id}-${uniqueSuffix}`;
    });
    clone.querySelectorAll("[for]").forEach((el) => {
      el.setAttribute("for", `${el.getAttribute("for")}-${uniqueSuffix}`);
    });
    clone.querySelectorAll("[aria-controls]").forEach((el) => {
      el.setAttribute(
        "aria-controls",
        `${el.getAttribute("aria-controls")}-${uniqueSuffix}`
      );
    });
    clone.querySelectorAll("[aria-labelledby]").forEach((el) => {
      el.setAttribute(
        "aria-labelledby",
        `${el.getAttribute("aria-labelledby")}-${uniqueSuffix}`
      );
    });

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

    // Find the grid item wrapper (the element that's actually the grid child)
    const gridItem =
      card.closest(
        ".resource-list__item, .grid__item, li, .collection-grid__item, .card-wrapper"
      ) || card;

    const itemParent = gridItem.parentElement;
    if (!itemParent) return;

    const insertBefore = gridItem.nextSibling;

    visible.forEach((v, idx) => {
      // Clone the grid item wrapper, then update the inner product-card
      const newWrapper = gridItem.cloneNode(true);
      const innerCard = newWrapper.querySelector("product-card") || newWrapper;
      const transformed = createVariantCard(innerCard, v, config);
      // Replace the inner product-card with the transformed clone
      if (transformed !== innerCard) {
        innerCard.parentNode?.replaceChild(transformed, innerCard);
      }
      // Mark the wrapper so we know it's variantis
      newWrapper.setAttribute("data-variantis-wrapper", "true");

      if (idx === 0) {
        itemParent.replaceChild(newWrapper, gridItem);
      } else {
        itemParent.insertBefore(newWrapper, insertBefore);
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

    let scheduled = false;
    let isRunning = false;

    const scheduledRun = () => {
      if (scheduled || isRunning) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        isRunning = true;
        try {
          run(config);
        } finally {
          // Small delay before allowing observer to react again
          setTimeout(() => { isRunning = false; }, 100);
        }
      });
    };

    // Initial run + small delay to let theme finish first paint
    setTimeout(() => scheduledRun(), 100);

    // Re-run when DOM changes (filters, infinite scroll, AJAX pagination)
    const observer = new MutationObserver((mutations) => {
      if (isRunning) return;
      // Only react to mutations that add product cards we haven't expanded yet
      const interesting = mutations.some((m) =>
        Array.from(m.addedNodes).some((n) => {
          if (!(n instanceof Element)) return false;
          if (n.dataset?.variantis === "true") return false;
          return n.matches?.("product-card, .product-item, .grid__item, .card-wrapper") ||
            n.querySelector?.("product-card, .product-item, .grid__item, .card-wrapper");
        })
      );
      if (interesting) scheduledRun();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
