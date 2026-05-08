import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState, useEffect } from "react";
import type React from "react";
import {
  Page,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Thumbnail,
  Banner,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

interface MediaNode {
  id: string;
  mediaContentType: string;
  image?: { url: string; altText: string | null };
  preview?: { image?: { url: string } };
}

interface VariantNode {
  id: string;
  title: string;
  price: string;
  availableForSale: boolean;
  selectedOptions: Array<{ name: string; value: string }>;
  image: { id: string; url: string; altText: string | null } | null;
}

// Saved assignment: variantId -> array of mediaIds
type ImageAssignment = Record<string, string[]>;
type CommonImages = string[]; // mediaIds shared across all variants

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const productId = `gid://shopify/Product/${params.productId}`;

  const response = await admin.graphql(`
    #graphql
    query getProductForAssignment($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        variants(first: 100) {
          edges {
            node {
              id
              title
              price
              availableForSale
              selectedOptions { name value }
              image { id url altText }
            }
          }
        }
        media(first: 100) {
          edges {
            node {
              id
              mediaContentType
              ... on MediaImage {
                image { url altText }
              }
              ... on Video {
                preview { image { url } }
              }
              ... on Model3d {
                preview { image { url } }
              }
            }
          }
        }
        metafield(namespace: "variantis", key: "image_assignment") {
          value
        }
      }
    }
  `, { variables: { id: productId } });

  const data = await response.json();
  const product = data.data.product;

  if (!product) {
    throw new Response("Product not found", { status: 404 });
  }

  const variants: VariantNode[] = product.variants.edges.map(
    (e: { node: VariantNode }) => e.node,
  );
  const media: MediaNode[] = product.media.edges.map(
    (e: { node: MediaNode }) => e.node,
  );

  let assignment: ImageAssignment = {};
  let commonImages: CommonImages = [];

  if (product.metafield?.value) {
    try {
      const saved = JSON.parse(product.metafield.value);
      assignment = saved.assignment ?? {};
      commonImages = saved.commonImages ?? [];
    } catch {
      // malformed metafield, start fresh
    }
  }

  return json({ product, variants, media, assignment, commonImages, productId });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const productId = `gid://shopify/Product/${params.productId}`;
  const body = await request.json();

  const metafieldValue = JSON.stringify({
    assignment: body.assignment,
    commonImages: body.commonImages,
  });

  // Ensure metafield definition exists with storefront visibility
  await admin.graphql(`
    #graphql
    mutation EnsureProductMetafieldDefinition {
      metafieldDefinitionCreate(definition: {
        name: "Variantis Image Assignment",
        namespace: "variantis",
        key: "image_assignment",
        type: "json",
        ownerType: PRODUCT,
        access: { storefront: PUBLIC_READ }
      }) {
        createdDefinition { id }
        userErrors { field message code }
      }
    }
  `);

  await admin.graphql(`
    #graphql
    mutation setVariantImageAssignment($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace value }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      metafields: [{
        ownerId: productId,
        namespace: "variantis",
        key: "image_assignment",
        value: metafieldValue,
        type: "json",
      }],
    },
  });

  return json({ ok: true });
};

function getMediaUrl(m: MediaNode): string {
  if (m.image?.url) return m.image.url;
  if (m.preview?.image?.url) return m.preview.image.url;
  return "";
}

export default function VariantImageAssignment() {
  const { product, variants, media, assignment: savedAssignment, commonImages: savedCommon } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [assignment, setAssignment] = useState<ImageAssignment>(savedAssignment);
  const [commonImages, setCommonImages] = useState<CommonImages>(savedCommon);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const isSaving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      shopify.toast.show("Image assignment saved");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const save = () => {
    fetcher.submit(
      { assignment, commonImages } as unknown as Record<string, string>,
      { method: "POST", encType: "application/json" },
    );
  };

  // Build mediaId → URL map
  const mediaMap = new Map<string, string>();
  media.forEach((m) => {
    const url = getMediaUrl(m);
    if (url) mediaMap.set(m.id, url);
  });

  // Compute unassigned media (not in any variant, not common)
  const allAssignedIds = new Set<string>();
  Object.values(assignment).forEach((ids) => ids.forEach((id) => allAssignedIds.add(id)));
  commonImages.forEach((id) => allAssignedIds.add(id));
  const unassignedMedia = media.filter((m) => !allAssignedIds.has(m.id));

  // Drag-and-drop handlers
  const handleDragStart = (
    e: React.DragEvent,
    mediaId: string,
    source: string, // variantId | "common" | "pool"
  ) => {
    e.dataTransfer.setData("mediaId", mediaId);
    e.dataTransfer.setData("source", source);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (
    e: React.DragEvent,
    targetVariantId: string, // variantId | "common" | "pool"
    targetIndex?: number,
  ) => {
    e.preventDefault();
    setDragOverTarget(null);
    const mediaId = e.dataTransfer.getData("mediaId");
    const source = e.dataTransfer.getData("source");
    if (!mediaId) return;

    setAssignment((prev) => {
      const updated: ImageAssignment = { ...prev };

      // Remove from source (if it's a variant)
      if (source !== "pool" && source !== "common" && source !== targetVariantId) {
        updated[source] = (updated[source] ?? []).filter((id) => id !== mediaId);
      }

      // Reorder within same variant
      if (source === targetVariantId) {
        const list = [...(updated[targetVariantId] ?? [])];
        const fromIdx = list.indexOf(mediaId);
        if (fromIdx !== -1) {
          list.splice(fromIdx, 1);
          const insertAt = targetIndex !== undefined ? Math.min(targetIndex, list.length) : list.length;
          list.splice(insertAt, 0, mediaId);
          updated[targetVariantId] = list;
        }
        return updated;
      }

      // Add to target variant
      if (targetVariantId !== "common" && targetVariantId !== "pool") {
        const list = [...(updated[targetVariantId] ?? [])];
        if (!list.includes(mediaId)) {
          const insertAt = targetIndex !== undefined ? Math.min(targetIndex, list.length) : list.length;
          list.splice(insertAt, 0, mediaId);
          updated[targetVariantId] = list;
        }
      }
      return updated;
    });

    // Common drop zone
    if (targetVariantId === "common") {
      setCommonImages((prev) => (prev.includes(mediaId) ? prev : [...prev, mediaId]));
      // Remove from all variants
      setAssignment((prev) => {
        const updated: ImageAssignment = {};
        for (const k of Object.keys(prev)) {
          updated[k] = (prev[k] ?? []).filter((id) => id !== mediaId);
        }
        return updated;
      });
    } else if (source === "common") {
      setCommonImages((prev) => prev.filter((id) => id !== mediaId));
    }

    // Pool drop zone (drag back to pool removes from everywhere)
    if (targetVariantId === "pool") {
      setAssignment((prev) => {
        const updated: ImageAssignment = {};
        for (const k of Object.keys(prev)) {
          updated[k] = (prev[k] ?? []).filter((id) => id !== mediaId);
        }
        return updated;
      });
      setCommonImages((prev) => prev.filter((id) => id !== mediaId));
    }
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverTarget !== targetId) setDragOverTarget(targetId);
  };

  const handleDragLeave = () => setDragOverTarget(null);

  // Reusable thumbnail component
  const renderImage = (
    mediaId: string,
    source: string,
    options: { size?: number; index?: number } = {},
  ) => {
    const url = mediaMap.get(mediaId);
    if (!url) return null;
    const size = options.size ?? 80;
    return (
      <div
        key={`${source}-${mediaId}`}
        draggable
        onDragStart={(e) => handleDragStart(e, mediaId, source)}
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: 8,
          overflow: "hidden",
          cursor: "grab",
          border: "2px solid #e1e3e5",
          flexShrink: 0,
        }}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
            pointerEvents: "none",
          }}
        />
        {options.index !== undefined && (
          <div
            style={{
              position: "absolute",
              top: 4,
              right: 4,
              background: "#008060",
              color: "white",
              borderRadius: "999px",
              minWidth: 22,
              height: 22,
              padding: "0 6px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: "bold",
              boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
            }}
          >
            {options.index + 1}
          </div>
        )}
      </div>
    );
  };

  const variantRowStyle = (variantId: string): React.CSSProperties => ({
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    minHeight: 96,
    padding: 12,
    borderRadius: 8,
    border:
      dragOverTarget === variantId
        ? "2px dashed #008060"
        : "2px dashed #d1d5db",
    background: dragOverTarget === variantId ? "rgba(0,128,96,0.05)" : "#fafbfb",
    transition: "all 0.15s",
  });

  return (
    <Page
      backAction={{ content: "Variant Images", url: "/app/variant-images" }}
      title={product.title}
      subtitle="Drag and drop images to each variant"
      primaryAction={
        <Button variant="primary" onClick={save} loading={isSaving}>
          Save assignment
        </Button>
      }
    >
      <TitleBar title={product.title} />
      <BlockStack gap="400">
        <Banner tone="info">
          <Text as="p" variant="bodyMd">
            Drag images from the bottom pool into each variant. Drag within a
            variant to reorder. Drag back to the pool to remove.
          </Text>
        </Banner>

        {/* Variant rows */}
        <Card>
          <BlockStack gap="400">
            <Text as="h2" variant="headingMd">
              Variants
            </Text>
            {variants.map((v) => {
              const ids = assignment[v.id] ?? [];
              return (
                <BlockStack key={v.id} gap="200">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="200" blockAlign="center">
                      {v.image?.url && (
                        <Thumbnail
                          source={v.image.url}
                          alt={v.title}
                          size="small"
                        />
                      )}
                      <BlockStack gap="050">
                        <Text as="h3" variant="bodyMd" fontWeight="bold">
                          {v.title}
                        </Text>
                        {!v.availableForSale && (
                          <Badge tone="attention">Sold out</Badge>
                        )}
                      </BlockStack>
                    </InlineStack>
                    <Badge tone={ids.length > 0 ? "success" : "new"}>
                      {`${ids.length} images`}
                    </Badge>
                  </InlineStack>
                  <div
                    onDragOver={(e) => handleDragOver(e, v.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, v.id)}
                    style={variantRowStyle(v.id)}
                  >
                    {ids.length === 0 ? (
                      <Text as="span" variant="bodySm" tone="subdued">
                        Drop images here for {v.title}
                      </Text>
                    ) : (
                      ids.map((mediaId, idx) =>
                        renderImage(mediaId, v.id, { index: idx }),
                      )
                    )}
                  </div>
                </BlockStack>
              );
            })}
          </BlockStack>
        </Card>

        {/* Common images row */}
        <Card>
          <BlockStack gap="200">
            <BlockStack gap="050">
              <Text as="h2" variant="headingMd">
                Common Images
              </Text>
              <Text as="p" variant="bodySm" tone="subdued">
                These images appear on ALL variants (size charts, lifestyle photos).
              </Text>
            </BlockStack>
            <div
              onDragOver={(e) => handleDragOver(e, "common")}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, "common")}
              style={variantRowStyle("common")}
            >
              {commonImages.length === 0 ? (
                <Text as="span" variant="bodySm" tone="subdued">
                  Drop images here that should show on all variants
                </Text>
              ) : (
                commonImages.map((mediaId) => renderImage(mediaId, "common"))
              )}
            </div>
          </BlockStack>
        </Card>

        {/* Pool of unassigned images */}
        <Card>
          <BlockStack gap="200">
            <InlineStack align="space-between" blockAlign="center">
              <BlockStack gap="050">
                <Text as="h2" variant="headingMd">
                  Unassigned images
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  Drag from here into any variant. Drop here to remove.
                </Text>
              </BlockStack>
              <Badge tone="info">{`${unassignedMedia.length} images`}</Badge>
            </InlineStack>
            <div
              onDragOver={(e) => handleDragOver(e, "pool")}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, "pool")}
              style={{
                ...variantRowStyle("pool"),
                background: dragOverTarget === "pool" ? "rgba(220,53,69,0.05)" : "#fafbfb",
                borderColor: dragOverTarget === "pool" ? "#dc3545" : "#d1d5db",
              }}
            >
              {unassignedMedia.length === 0 ? (
                <Text as="span" variant="bodySm" tone="subdued">
                  All images assigned. Upload more in the product editor.
                </Text>
              ) : (
                unassignedMedia.map((m) => renderImage(m.id, "pool"))
              )}
            </div>
          </BlockStack>
        </Card>
      </BlockStack>
    </Page>
  );
}
