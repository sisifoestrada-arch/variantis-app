import { json } from "@remix-run/node";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useFetcher } from "@remix-run/react";
import { useState, useEffect } from "react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Select,
  Checkbox,
  Thumbnail,
  Box,
  Divider,
  Banner,
  TextField,
  RadioButton,
} from "@shopify/polaris";
import { TitleBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

interface VariantInfo {
  variantId: string;
  variantTitle: string;
  imageUrl: string;
  imageUrls: string[];
  price: string;
  availableForSale: boolean;
  optionValue: string;
}

const PRODUCT_QUERY = `#graphql
  query getProductForDisplay($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      options { name values }
      variants(first: 100) {
        edges {
          node {
            id
            title
            price
            availableForSale
            selectedOptions { name value }
            image { url }
          }
        }
      }
      media(first: 100) {
        edges {
          node {
            id
            ... on MediaImage { image { url } }
            ... on Video { preview { image { url } } }
            ... on Model3d { preview { image { url } } }
          }
        }
      }
      metafield(namespace: "variantis", key: "image_assignment") {
        value
      }
    }
  }
`;

interface MediaEdge { node: { id: string; image?: { url: string }; preview?: { image?: { url: string } } } }
interface VariantEdge {
  node: {
    id: string;
    title: string;
    price: string;
    availableForSale: boolean;
    selectedOptions: Array<{ name: string; value: string }>;
    image: { url: string } | null;
  };
}
interface FullProductNode {
  id: string;
  title: string;
  handle: string;
  options: Array<{ name: string; values: string[] }>;
  variants: { edges: VariantEdge[] };
  media: { edges: MediaEdge[] };
  metafield: { value: string } | null;
}

// Resolve variant→imageUrls[] from product media + image_assignment metafield
function buildVariantInfos(product: FullProductNode): { variants: VariantInfo[]; optionNames: string[] } {
  const optionNames: string[] = [];
  for (const option of product.options) {
    if (option.name !== "Title") optionNames.push(option.name);
  }

  const mediaUrlMap = new Map<string, string>();
  for (const me of product.media.edges) {
    const url = me.node.image?.url ?? me.node.preview?.image?.url ?? "";
    if (url) mediaUrlMap.set(me.node.id, url);
  }

  let imageAssignment: Record<string, string[]> = {};
  let commonImageIds: string[] = [];
  if (product.metafield?.value) {
    try {
      const parsed = JSON.parse(product.metafield.value);
      imageAssignment = parsed.assignment ?? {};
      commonImageIds = parsed.commonImages ?? [];
    } catch {}
  }

  const variants: VariantInfo[] = [];
  for (const ve of product.variants.edges) {
    const v = ve.node;
    const firstOption = v.selectedOptions[0];

    const assignedIds = imageAssignment[v.id] ?? [];
    const seen = new Set<string>();
    const finalUrls: string[] = [];
    const pushUnique = (u: string | undefined | null) => {
      if (!u || seen.has(u)) return;
      seen.add(u);
      finalUrls.push(u);
    };
    assignedIds.map((id) => mediaUrlMap.get(id)).forEach(pushUnique);
    commonImageIds.map((id) => mediaUrlMap.get(id)).forEach(pushUnique);
    if (finalUrls.length === 0 && v.image?.url) pushUnique(v.image.url);

    variants.push({
      variantId: v.id,
      variantTitle: v.title,
      imageUrl: finalUrls[0] ?? "",
      imageUrls: finalUrls,
      price: v.price,
      availableForSale: v.availableForSale,
      optionValue: firstOption?.value ?? v.title,
    });
  }

  return { variants, optionNames };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const productId = `gid://shopify/Product/${params.productId}`;

  const response = await admin.graphql(PRODUCT_QUERY, { variables: { id: productId } });
  const data = await response.json();
  const product: FullProductNode | null = data.data.product;

  if (!product) throw new Response("Product not found", { status: 404 });

  const { variants, optionNames } = buildVariantInfos(product);

  // Load existing config from DB
  const config = await db.productConfig.findUnique({
    where: { shop_productId: { shop: session.shop, productId: product.id } },
    include: { variants: true },
  });

  const savedVariants = Object.fromEntries(
    (config?.variants ?? []).map((v) => [v.variantId, v]),
  );

  return json({
    product: { id: product.id, title: product.title, handle: product.handle },
    variants,
    optionNames,
    config,
    savedVariants,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const productId = `gid://shopify/Product/${params.productId}`;
  const body = await request.json();

  const {
    enabled, splitByOption, hideOutOfStock, showOnlyDiscount,
    hideWithoutImage, titleFormat, customTitleFormat, variants,
    productTitle, productHandle,
  } = body;

  // Upsert ProductConfig + variants
  await db.productConfig.upsert({
    where: { shop_productId: { shop: session.shop, productId } },
    update: {
      enabled, splitByOption, hideOutOfStock, showOnlyDiscount,
      hideWithoutImage, titleFormat, customTitleFormat,
      productTitle, productHandle, updatedAt: new Date(),
    },
    create: {
      shop: session.shop, productId, productTitle, productHandle,
      enabled, splitByOption, hideOutOfStock, showOnlyDiscount,
      hideWithoutImage, titleFormat, customTitleFormat,
    },
  });

  type VariantPayload = VariantInfo & { visible: boolean; position: number; hoverImageUrl: string };
  for (const v of variants as VariantPayload[]) {
    await db.productVariantConfig.upsert({
      where: {
        shop_productId_variantId: {
          shop: session.shop, productId, variantId: v.variantId,
        },
      },
      update: {
        visible: v.visible, position: v.position,
        hoverImageUrl: v.hoverImageUrl ?? "", updatedAt: new Date(),
      },
      create: {
        shop: session.shop, productId, variantId: v.variantId,
        variantTitle: v.variantTitle,
        imageUrl: v.imageUrl, hoverImageUrl: v.hoverImageUrl ?? "",
        visible: v.visible, position: v.position,
      },
    });
  }

  // Ensure metafield definition with storefront access
  await admin.graphql(`
    #graphql
    mutation EnsureShopMetafieldDef {
      metafieldDefinitionCreate(definition: {
        name: "Variantis All Configs",
        namespace: "variantis",
        key: "all_configs",
        type: "json",
        ownerType: SHOP,
        access: { storefront: PUBLIC_READ }
      }) {
        createdDefinition { id }
        userErrors { field message code }
      }
    }
  `);

  // Build the global shop metafield by aggregating ALL configured products
  const allConfigs = await db.productConfig.findMany({
    where: { shop: session.shop },
    include: { variants: true },
  });

  // Bulk-load all products to resolve images per variant (single GraphQL call)
  const productGids = allConfigs.map((c) => c.productId);
  type VariantConfigOut = VariantInfo & {
    productId: string;
    productHandle: string;
    productTitle: string;
    hoverImageUrl: string;
    visible: boolean;
    position: number;
  };
  const productHandles: Record<string, VariantConfigOut[]> = {};

  if (productGids.length > 0) {
    const bulkRes = await admin.graphql(`
      #graphql
      query BulkProducts($ids: [ID!]!) {
        nodes(ids: $ids) {
          ... on Product {
            id
            title
            handle
            options { name values }
            variants(first: 100) {
              edges {
                node {
                  id title price availableForSale
                  selectedOptions { name value }
                  image { url }
                }
              }
            }
            media(first: 100) {
              edges {
                node {
                  id
                  ... on MediaImage { image { url } }
                  ... on Video { preview { image { url } } }
                  ... on Model3d { preview { image { url } } }
                }
              }
            }
            metafield(namespace: "variantis", key: "image_assignment") {
              value
            }
          }
        }
      }
    `, { variables: { ids: productGids } });
    const bulkData = await bulkRes.json();
    const productsArr: FullProductNode[] = (bulkData.data.nodes ?? []).filter(Boolean);

    const productById = new Map(productsArr.map((p) => [p.id, p]));

    for (const cfg of allConfigs) {
      const product = productById.get(cfg.productId);
      if (!product) continue;
      const { variants: variantInfos } = buildVariantInfos(product);
      const savedMap = new Map(cfg.variants.map((v) => [v.variantId, v]));

      const list: VariantConfigOut[] = variantInfos.map((vi, idx) => {
        const saved = savedMap.get(vi.variantId);
        return {
          ...vi,
          productId: product.id,
          productHandle: product.handle,
          productTitle: product.title,
          hoverImageUrl: saved?.hoverImageUrl ?? "",
          visible: saved?.visible ?? true,
          position: saved?.position ?? idx,
        };
      });

      // Filter out invisible & sort by position before publishing
      const sorted = list
        .filter((v) => v.visible !== false)
        .sort((a, b) => (a.position || 0) - (b.position || 0));

      productHandles[product.handle] = sorted;
    }
  }

  // Use current product's settings as global defaults (storefront JS reads top-level)
  const globalConfig = {
    enabled,
    splitByOption,
    hideOutOfStock,
    showOnlyDiscount,
    hideWithoutImage,
    titleFormat,
    customTitleFormat,
    productHandles,
  };

  // Get shop GID
  const shopRes = await admin.graphql(`
    #graphql
    query GetShopId { shop { id } }
  `);
  const shopData = await shopRes.json();
  const shopGid = shopData.data.shop.id;

  await admin.graphql(`
    #graphql
    mutation SetShopMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace value }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      metafields: [{
        ownerId: shopGid,
        namespace: "variantis",
        key: "all_configs",
        value: JSON.stringify(globalConfig),
        type: "json",
      }],
    },
  });

  return json({ ok: true });
};

export default function ProductDisplayConfig() {
  const {
    product, variants, optionNames, config, savedVariants,
  } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  const [enabled, setEnabled] = useState(config?.enabled ?? true);
  const [splitByOption, setSplitByOption] = useState(config?.splitByOption ?? optionNames[0] ?? "Color");
  const [hideOutOfStock, setHideOutOfStock] = useState(config?.hideOutOfStock ?? false);
  const [showOnlyDiscount, setShowOnlyDiscount] = useState(config?.showOnlyDiscount ?? false);
  const [hideWithoutImage, setHideWithoutImage] = useState(config?.hideWithoutImage ?? false);
  const [titleFormat, setTitleFormat] = useState(config?.titleFormat ?? "product_variant");
  const [customTitleFormat, setCustomTitleFormat] = useState(
    config?.customTitleFormat ?? "{product} - {variant}",
  );
  const [variantConfigs, setVariantConfigs] = useState<
    Record<string, { visible: boolean; position: number; hoverImageUrl: string }>
  >(
    Object.fromEntries(
      variants.map((v, i) => [
        v.variantId,
        {
          visible: savedVariants[v.variantId]?.visible ?? true,
          position: savedVariants[v.variantId]?.position ?? i,
          hoverImageUrl: savedVariants[v.variantId]?.hoverImageUrl ?? "",
        },
      ]),
    ),
  );

  const isSaving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      shopify.toast.show("Product display saved");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const save = () => {
    const variantsPayload = variants.map((v) => ({
      ...v,
      ...(variantConfigs[v.variantId] ?? { visible: true, position: 0, hoverImageUrl: "" }),
    }));

    fetcher.submit(
      {
        enabled, splitByOption, hideOutOfStock, showOnlyDiscount,
        hideWithoutImage, titleFormat, customTitleFormat,
        productTitle: product.title,
        productHandle: product.handle,
        variants: variantsPayload,
      } as unknown as Record<string, string>,
      { method: "POST", encType: "application/json" },
    );
  };

  const optionSelectOptions = [
    ...optionNames.map((n) => ({ label: n, value: n })),
    { label: "All combinations", value: "__all__" },
  ];

  return (
    <Page
      backAction={{ content: "Collection Display", url: "/app/collection-display" }}
      title={product.title}
      subtitle="Configure how this product's variants appear as separate cards"
      primaryAction={
        <Button variant="primary" onClick={save} loading={isSaving}>
          Save settings
        </Button>
      }
    >
      <TitleBar title={product.title} />
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Display Settings</Text>
                <Badge tone={enabled ? "success" : "attention"}>
                  {enabled ? "Enabled" : "Disabled"}
                </Badge>
              </InlineStack>

              <Checkbox
                label="Enable variant cards for this product"
                checked={enabled}
                onChange={setEnabled}
              />

              {enabled && (
                <>
                  <Divider />
                  <Select
                    label="Split variants by"
                    options={optionSelectOptions}
                    value={splitByOption}
                    onChange={setSplitByOption}
                    helpText="Each value of this option becomes a separate product card"
                  />

                  <BlockStack gap="200">
                    <Text as="h3" variant="headingMd">Display Rules</Text>
                    <Checkbox
                      label="Hide out-of-stock variants"
                      checked={hideOutOfStock}
                      onChange={setHideOutOfStock}
                    />
                    <Checkbox
                      label="Show only discounted variants"
                      checked={showOnlyDiscount}
                      onChange={setShowOnlyDiscount}
                    />
                    <Checkbox
                      label="Hide variants without an image"
                      checked={hideWithoutImage}
                      onChange={setHideWithoutImage}
                    />
                  </BlockStack>

                  <Divider />
                  <BlockStack gap="300">
                    <Text as="h3" variant="headingMd">Title Format</Text>
                    <RadioButton
                      label={`Product + Variant (e.g. "T-Shirt - Blue")`}
                      checked={titleFormat === "product_variant"}
                      id="product_variant"
                      name="titleFormat"
                      onChange={() => setTitleFormat("product_variant")}
                    />
                    <RadioButton
                      label={'Variant title only (e.g. "Blue")'}
                      checked={titleFormat === "variant_only"}
                      id="variant_only"
                      name="titleFormat"
                      onChange={() => setTitleFormat("variant_only")}
                    />
                    <RadioButton
                      label={'Product title only (e.g. "T-Shirt")'}
                      checked={titleFormat === "product_only"}
                      id="product_only"
                      name="titleFormat"
                      onChange={() => setTitleFormat("product_only")}
                    />
                    <RadioButton
                      label="Custom format"
                      checked={titleFormat === "custom"}
                      id="custom"
                      name="titleFormat"
                      onChange={() => setTitleFormat("custom")}
                    />
                    {titleFormat === "custom" && (
                      <TextField
                        label="Custom format"
                        value={customTitleFormat}
                        onChange={setCustomTitleFormat}
                        helpText="Use {product} and {variant} as placeholders"
                        autoComplete="off"
                      />
                    )}
                  </BlockStack>
                </>
              )}
            </BlockStack>
          </Card>

          {enabled && (
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Variant Visibility
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {variants.length} variants
                    </Text>
                  </InlineStack>

                  <Banner tone="info">
                    Toggle individual variants to show or hide them as cards.
                  </Banner>

                  <BlockStack gap="300">
                    {variants.map((v) => {
                      const vc = variantConfigs[v.variantId] ?? {
                        visible: true, position: 0, hoverImageUrl: "",
                      };
                      return (
                        <Box
                          key={v.variantId}
                          padding="300"
                          borderWidth="025"
                          borderRadius="200"
                          borderColor="border"
                          background={vc.visible ? "bg-surface" : "bg-surface-disabled"}
                        >
                          <InlineStack align="space-between" blockAlign="center" gap="400">
                            <InlineStack gap="300" blockAlign="center">
                              {v.imageUrl && (
                                <Thumbnail source={v.imageUrl} alt={v.variantTitle} size="small" />
                              )}
                              <BlockStack gap="050">
                                <Text as="span" variant="bodyMd" fontWeight="bold">
                                  {v.variantTitle}
                                </Text>
                                <InlineStack gap="100">
                                  <Badge>{v.optionValue}</Badge>
                                  {!v.availableForSale && (
                                    <Badge tone="attention">Sold out</Badge>
                                  )}
                                  <Text as="span" variant="bodySm" tone="subdued">
                                    ${v.price}
                                  </Text>
                                </InlineStack>
                              </BlockStack>
                            </InlineStack>
                            <Checkbox
                              label="Visible"
                              labelHidden
                              checked={vc.visible}
                              onChange={(val) =>
                                setVariantConfigs((prev) => ({
                                  ...prev,
                                  [v.variantId]: { ...vc, visible: val },
                                }))
                              }
                            />
                          </InlineStack>
                        </Box>
                      );
                    })}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Box>
          )}
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">Preview</Text>
              <Text as="p" variant="bodySm" tone="subdued">
                Customers will see each variant as a separate card on home,
                collections and search.
              </Text>
              <Box
                background="bg-surface-secondary"
                padding="400"
                borderRadius="200"
              >
                <BlockStack gap="200">
                  {variants.slice(0, 3).map((v) => (
                    <InlineStack key={v.variantId} gap="200" blockAlign="center">
                      {v.imageUrl ? (
                        <Thumbnail source={v.imageUrl} alt="" size="small" />
                      ) : (
                        <Box
                          width="40px"
                          minHeight="40px"
                          background="bg-surface-tertiary"
                          borderRadius="100"
                        />
                      )}
                      <BlockStack gap="025">
                        <Text as="span" variant="bodySm" fontWeight="bold">
                          {titleFormat === "product_variant"
                            ? `${product.title} - ${v.optionValue}`
                            : titleFormat === "variant_only"
                              ? v.optionValue
                              : titleFormat === "product_only"
                                ? product.title
                                : customTitleFormat
                                    .replace("{product}", product.title)
                                    .replace("{variant}", v.optionValue)}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          ${v.price}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  ))}
                  {variants.length > 3 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      +{variants.length - 3} more…
                    </Text>
                  )}
                </BlockStack>
              </Box>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
