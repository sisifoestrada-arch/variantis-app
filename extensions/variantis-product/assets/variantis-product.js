/**
 * Variantis – Module A: Variant Images
 * Filters the product gallery to show only images assigned to the selected variant.
 * Assignment data is stored in product metafields (namespace: variantis, key: image_assignment).
 */
(function () {
  "use strict";

  const TRANSITION_MS = 300;

  class VariantisProductImages {
    constructor() {
      this.assignment = null;   // { variantId: [mediaId, ...] }
      this.commonImages = [];   // mediaIds shared across all variants
      this.currentVariantId = null;
      this.init();
    }

    init() {
      // Load metafield data injected by the liquid block
      const dataEl = document.getElementById("variantis-product-data");
      if (!dataEl) return;

      try {
        const data = JSON.parse(dataEl.textContent || "{}");
        this.assignment = data.assignment || {};
        this.commonImages = data.commonImages || [];
      } catch {
        return;
      }

      // Find current variant from URL or form
      this.detectCurrentVariant();

      // Listen for variant changes — covers all theme patterns
      this.watchVariantChanges();

      // Initial filter
      if (this.currentVariantId) {
        this.filterImages(this.currentVariantId);
      }
    }

    detectCurrentVariant() {
      // 1. URL param
      const params = new URLSearchParams(window.location.search);
      const variantParam = params.get("variant");
      if (variantParam) {
        this.currentVariantId = `gid://shopify/ProductVariant/${variantParam}`;
        return;
      }

      // 2. Hidden input in variant form
      const variantInput = document.querySelector(
        'input[name="id"], select[name="id"]'
      );
      if (variantInput) {
        this.currentVariantId = `gid://shopify/ProductVariant/${variantInput.value}`;
      }
    }

    watchVariantChanges() {
      // Method 1: Shopify native variant:change event (Dawn, Refresh, etc.)
      document.addEventListener("variant:change", (e) => {
        const variantId = e.detail?.variant?.id;
        if (variantId) {
          this.currentVariantId = `gid://shopify/ProductVariant/${variantId}`;
          this.filterImages(this.currentVariantId);
        }
      });

      // Method 2: form input change (select, radio)
      document.addEventListener("change", (e) => {
        const el = e.target;
        if (el && el.name === "id") {
          this.currentVariantId = `gid://shopify/ProductVariant/${el.value}`;
          this.filterImages(this.currentVariantId);
        }
      });

      // Method 3: MutationObserver on hidden input (for JS-driven themes)
      const hiddenInput = document.querySelector('input[name="id"][type="hidden"]');
      if (hiddenInput) {
        const observer = new MutationObserver(() => {
          const newId = `gid://shopify/ProductVariant/${hiddenInput.value}`;
          if (newId !== this.currentVariantId) {
            this.currentVariantId = newId;
            this.filterImages(newId);
          }
        });
        observer.observe(hiddenInput, { attributes: true, attributeFilter: ["value"] });
      }

      // Method 4: popstate (back/forward navigation with ?variant=)
      window.addEventListener("popstate", () => {
        this.detectCurrentVariant();
        if (this.currentVariantId) this.filterImages(this.currentVariantId);
      });
    }

    filterImages(variantId) {
      const assignedIds = this.assignment[variantId] || [];
      const allAllowed = new Set([...assignedIds, ...this.commonImages]);
      const showAll = assignedIds.length === 0 && this.commonImages.length === 0;

      const mediaItems = this.getMediaItems();

      mediaItems.forEach((item) => {
        const mediaId = this.extractMediaId(item);
        const shouldShow = showAll || !mediaId || allAllowed.has(mediaId);
        this.setVisibility(item, shouldShow);
      });
    }

    getMediaItems() {
      // Try multiple gallery patterns used across Shopify themes
      const selectors = [
        ".product__media-list .product__media-item",   // Dawn
        ".product-single__media-group .product-single__media", // Debut
        "[data-media-id]",                             // Generic
        ".product__media-wrapper",                     // Impulse/Prestige
        ".swiper-slide .media",                        // Swiper-based themes
        ".product-gallery__item",                      // Other common pattern
      ];

      for (const sel of selectors) {
        const items = document.querySelectorAll(sel);
        if (items.length > 0) return Array.from(items);
      }

      // Fallback: any element with data-media-id
      return Array.from(document.querySelectorAll("[data-media-id]"));
    }

    extractMediaId(el) {
      // 1. data-media-id attribute (most themes set this)
      if (el.dataset.mediaId) {
        return `gid://shopify/MediaImage/${el.dataset.mediaId}`;
      }

      // 2. data-media-id on child element
      const child = el.querySelector("[data-media-id]");
      if (child?.dataset.mediaId) {
        return `gid://shopify/MediaImage/${child.dataset.mediaId}`;
      }

      // 3. Extract from image src URL
      const img = el.querySelector("img");
      if (img?.src) {
        const match = img.src.match(/\/(\d{13,})\./);
        if (match) return `gid://shopify/MediaImage/${match[1]}`;
      }

      return null;
    }

    setVisibility(el, visible) {
      if (visible) {
        el.style.transition = `opacity ${TRANSITION_MS}ms ease`;
        el.style.opacity = "1";
        el.style.display = "";
        el.style.pointerEvents = "";
        el.removeAttribute("aria-hidden");
      } else {
        el.style.transition = `opacity ${TRANSITION_MS}ms ease`;
        el.style.opacity = "0";
        el.setAttribute("aria-hidden", "true");
        setTimeout(() => {
          // Only hide if still invisible after transition
          if (el.style.opacity === "0") {
            el.style.display = "none";
            el.style.pointerEvents = "none";
          }
        }, TRANSITION_MS);
      }
    }
  }

  // Boot when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => new VariantisProductImages());
  } else {
    new VariantisProductImages();
  }
})();
