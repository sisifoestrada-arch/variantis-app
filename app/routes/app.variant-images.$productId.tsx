import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState, useCallback, useEffect } from "react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Thumbnail,
  Box,
  Banner,
  Divider,
  Checkbox,
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
  const { product, variants, media, assignment: savedAssignment, commonImages: savedCommon, productId } =
    useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [assignment, setAssignment] = useState<ImageAssignment>(savedAssignment);
  const [commonImages, setCommonImages] = useState<CommonImages>(savedCommon);
  const [activeVariant, setActiveVariant] = useState<string>(
    variants[0]?.id ?? "",
  );

  const isSaving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      shopify.toast.show("Image assignment saved");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const toggleImageForVariant = useCallback(
    (variantId: string, mediaId: string) => {
      setAssignment((prev) => {
        const current = prev[variantId] ?? [];
        const next = current.includes(mediaId)
          ? current.filter((id) => id !== mediaId)
          : [...current, mediaId];
        return { ...prev, [variantId]: next };
      });
    },
    [],
  );

  const toggleCommonImage = useCallback((mediaId: string) => {
    setCommonImages((prev) =>
      prev.includes(mediaId) ? prev.filter((id) => id !== mediaId) : [...prev, mediaId],
    );
  }, []);

  const save = () => {
    fetcher.submit(
      { assignment, commonImages } as unknown as Record<string, string>,
      { method: "POST", encType: "application/json" },
    );
  };

  const currentAssigned = assignment[activeVariant] ?? [];
  const activeVariantData = variants.find((v) => v.id === activeVariant);

  return (
    <Page
      backAction={{ content: "Variant Images", url: "/app/variant-images" }}
      title={product.title}
      subtitle="Assign images to each variant"
      primaryAction={
        <Button variant="primary" onClick={save} loading={isSaving}>
          Save assignment
        </Button>
      }
    >
      <TitleBar title={product.title} />
      <Layout>
        {/* Left: Variant selector */}
        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingMd">
                Variants
              </Text>
              <BlockStack gap="200">
                {variants.map((v) => {
                  const count = (assignment[v.id] ?? []).length;
                  const isActive = v.id === activeVariant;
                  return (
                    <Box
                      key={v.id}
                      padding="300"
                      borderWidth="025"
                      borderRadius="200"
                      borderColor={isActive ? "border-focus" : "border"}
                      background={isActive ? "bg-surface-selected" : "bg-surface"}
                    >
                      <button
                        onClick={() => setActiveVariant(v.id)}
                        style={{
                          all: "unset",
                          cursor: "pointer",
                          width: "100%",
                          display: "block",
                        }}
                      >
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
                              <Text as="span" variant="bodyMd" fontWeight={isActive ? "bold" : "regular"}>
                                {v.title}
                              </Text>
                              {!v.availableForSale && (
                                <Badge tone="attention">Sold out</Badge>
                              )}
                            </BlockStack>
                          </InlineStack>
                          <Badge tone={count > 0 ? "success" : "new"}>
                            {count > 0 ? `${count} images` : "0"}
                          </Badge>
                        </InlineStack>
                      </button>
                    </Box>
                  );
                })}
              </BlockStack>

              <Divider />

              <BlockStack gap="200">
                <Text as="h3" variant="headingMd">
                  Common Images
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  These images appear across ALL variants (e.g. size charts).
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>

        {/* Right: Image grid */}
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between" blockAlign="center">
                <BlockStack gap="050">
                  <Text as="h2" variant="headingMd">
                    {activeVariantData
                      ? `Images for: ${activeVariantData.title}`
                      : "Select a variant"}
                  </Text>
                  <Text as="p" variant="bodySm" tone="subdued">
                    Click an image to assign it to this variant
                  </Text>
                </BlockStack>
                <Badge tone="info">{`${currentAssigned.length} selected`}</Badge>
              </InlineStack>

              <Banner tone="info">
                <Text as="p" variant="bodyMd">
                  Check the <Text as="span" fontWeight="bold">Common</Text> box to show an image on all variants (useful for size charts or lifestyle photos).
                </Text>
              </Banner>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                  gap: "12px",
                }}
              >
                {media.map((m) => {
                  const url = getMediaUrl(m);
                  if (!url) return null;

                  const isAssigned = currentAssigned.includes(m.id);
                  const isCommon = commonImages.includes(m.id);

                  return (
                    <BlockStack key={m.id} gap="100">
                      <div
                        onClick={() =>
                          !isCommon && toggleImageForVariant(activeVariant, m.id)
                        }
                        style={{
                          cursor: isCommon ? "default" : "pointer",
                          border: isAssigned
                            ? "3px solid #008060"
                            : isCommon
                              ? "3px solid #2c6ecb"
                              : "3px solid #e1e3e5",
                          borderRadius: "8px",
                          overflow: "hidden",
                          opacity: isCommon ? 0.7 : 1,
                          transition: "border-color 0.15s, opacity 0.15s",
                        }}
                      >
                        <img
                          src={url}
                          alt=""
                          style={{
                            width: "100%",
                            aspectRatio: "1",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      </div>
                      <Checkbox
                        label="Common"
                        checked={isCommon}
                        onChange={() => {
                          toggleCommonImage(m.id);
                          if (!isCommon) {
                            // remove from variant-specific if marking as common
                            setAssignment((prev) => {
                              const updated = { ...prev };
                              Object.keys(updated).forEach((vid) => {
                                updated[vid] = (updated[vid] ?? []).filter(
                                  (id) => id !== m.id,
                                );
                              });
                              return updated;
                            });
                          }
                        }}
                      />
                    </BlockStack>
                  );
                })}
              </div>

              {media.length === 0 && (
                <Text as="p" variant="bodyMd" tone="subdued">
                  No images found for this product. Upload images in the
                  product editor first.
                </Text>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
