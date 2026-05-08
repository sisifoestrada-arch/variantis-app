/**
 * Variantis – Module A: Variant Images
 * Filters the product gallery to show only images assigned to the selected variant.
 * Assignment data is stored in product metafields (namespace: variantis, key: image_assignment).
 */
(function () {
  "use strict";

  const TRANSITION_MS = 300;

  function toMediaGid(value) {
    if (!value) return null;
    if (value.startsWith("gid://")) return value;
    return `gid://shopify/MediaImage/${value}`;
  }

  function toVariantGid(value) {
    if (!value) return null;
    if (String(value).startsWith("gid://")) return value;
    return `gid://shopify/ProductVariant/${value}`;
  }

  // Convert any media ID to a comparable numeric form
  function toNumericMediaId(value) {
    if (!value) return null;
    const match = String(value).match(/(\d+)$/);
    return match ? match[1] : null;
  }

  class VariantisProductImages {
    constructor() {
      this.assignment = {};       // { variantId: [mediaId, ...] }
      this.commonImages = [];
      this.allowedNumericIds = null; // current allowed set (numeric IDs)
      this.currentVariantId = null;
      this.init();
    }

    init() {
      const dataEl = document.getElementById("variantis-product-data");
      if (!dataEl) return;

      try {
        const data = JSON.parse(dataEl.textContent || "{}");
        this.assignment = data.assignment || {};
        this.commonImages = data.commonImages || [];
      } catch {
        return;
      }

      this.detectCurrentVariant();
      this.watchVariantChanges();

      if (this.currentVariantId) {
        this.filterImages(this.currentVariantId);
      }
    }

    detectCurrentVariant() {
      const params = new URLSearchParams(window.location.search);
      const variantParam = params.get("variant");
      if (variantParam) {
        this.currentVariantId = toVariantGid(variantParam);
        return;
      }
      const variantInput = document.querySelector(
        'input[name="id"], select[name="id"]'
      );
      if (variantInput) {
        this.currentVariantId = toVariantGid(variantInput.value);
      }
    }

    watchVariantChanges() {
      // Shopify native variant:change event
      document.addEventListener("variant:change", (e) => {
        const variantId = e.detail?.variant?.id;
        if (variantId) {
          this.currentVariantId = toVariantGid(variantId);
          this.filterImages(this.currentVariantId);
        }
      });

      // Form input change (selects, radios, hidden inputs named "id")
      document.addEventListener("change", (e) => {
        const el = e.target;
        if (el && el.name === "id") {
          this.currentVariantId = toVariantGid(el.value);
          this.filterImages(this.currentVariantId);
        }
      });

      // Hidden input mutations
      const hiddenInput = document.querySelector('input[name="id"][type="hidden"]');
      if (hiddenInput) {
        const observer = new MutationObserver(() => {
          const newId = toVariantGid(hiddenInput.value);
          if (newId !== this.currentVariantId) {
            this.currentVariantId = newId;
            this.filterImages(newId);
          }
        });
        observer.observe(hiddenInput, { attributes: true, attributeFilter: ["value"] });
      }

      // popstate (back/forward)
      window.addEventListener("popstate", () => {
        this.detectCurrentVariant();
        if (this.currentVariantId) this.filterImages(this.currentVariantId);
      });

      // Re-apply filter after dynamic gallery updates (Horizon swaps slides on variant change)
      const galleryRoot = document.querySelector(
        "product-media-gallery, slideshow-component, .product-media-container, .product__media-list"
      )?.parentElement || document.body;
      const reapplyObs = new MutationObserver(() => {
        if (this.currentVariantId) this.filterImages(this.currentVariantId);
      });
      reapplyObs.observe(galleryRoot, { childList: true, subtree: true });
    }

    filterImages(variantId) {
      const assignedIds = this.assignment[variantId] || [];
      const showAll = assignedIds.length === 0 && this.commonImages.length === 0;

      // Build set of numeric media IDs that should be visible
      const allowedNumeric = new Set(
        [...assignedIds, ...this.commonImages]
          .map(toNumericMediaId)
          .filter(Boolean)
      );
      this.allowedNumericIds = showAll ? null : allowedNumeric;

      this.getMediaItems().forEach((item) => {
        const numericId = this.extractNumericMediaId(item);
        const shouldShow = showAll || !numericId || allowedNumeric.has(numericId);
        this.setVisibility(item, shouldShow);
      });
    }

    getMediaItems() {
      // Horizon-specific: each slideshow-slide wraps a media item
      const horizon = document.querySelectorAll("slideshow-slide");
      if (horizon.length > 0) return Array.from(horizon);

      // Other patterns - prefer parent containers over leaf elements
      const selectors = [
        ".product__media-list .product__media-item",
        ".product-single__media-group .product-single__media",
        ".product__media-wrapper",
        ".product-media-container",
        ".swiper-slide",
        ".product-gallery__item",
      ];
      for (const sel of selectors) {
        const items = document.querySelectorAll(sel);
        if (items.length > 0) return Array.from(items);
      }
      // Last resort: every element with a media id (may include thumbs/zoom)
      return Array.from(document.querySelectorAll("[data-media-id]"));
    }

    extractNumericMediaId(el) {
      // Element itself
      if (el.dataset?.mediaId) {
        return toNumericMediaId(el.dataset.mediaId);
      }
      // Child with data-media-id
      const child = el.querySelector?.("[data-media-id]");
      if (child?.dataset?.mediaId) {
        return toNumericMediaId(child.dataset.mediaId);
      }
      // Image src fallback
      const img = el.querySelector?.("img");
      if (img?.src) {
        const match = img.src.match(/\/(\d{10,})[\.\-_]/);
        if (match) return match[1];
      }
      return null;
    }

    setVisibility(el, visible) {
      if (visible) {
        el.style.transition = `opacity ${TRANSITION_MS}ms ease`;
        el.style.opacity = "";
        el.style.display = "";
        el.style.pointerEvents = "";
        el.removeAttribute("aria-hidden");
        el.removeAttribute("data-variantis-hidden");
      } else {
        el.style.transition = `opacity ${TRANSITION_MS}ms ease`;
        el.style.opacity = "0";
        el.setAttribute("aria-hidden", "true");
        el.setAttribute("data-variantis-hidden", "true");
        // Use display:none after fade so it doesn't take layout space
        setTimeout(() => {
          if (el.getAttribute("data-variantis-hidden") === "true") {
            el.style.display = "none";
            el.style.pointerEvents = "none";
          }
        }, TRANSITION_MS);
      }
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => new VariantisProductImages());
  } else {
    new VariantisProductImages();
  }
})();
