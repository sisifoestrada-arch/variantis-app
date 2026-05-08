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
  productId: string;
  productHandle: string;
  variantTitle: string;
  productTitle: string;
  imageUrl: string;
  imageUrls: string[];
  price: string;
  availableForSale: boolean;
  optionValue: string;
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const collectionId = `gid://shopify/Collection/${params.collectionId}`;

  const response = await admin.graphql(`
    #graphql
    query getCollectionVariants($id: ID!) {
      collection(id: $id) {
        id
        title
        handle
        products(first: 50) {
          edges {
            node {
              id
              title
              handle
              options { name values }
              variants(first: 20) {
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
        }
      }
    }
  `, { variables: { id: collectionId } });

  const data = await response.json();
  const collection = data.data.collection;

  if (!collection) throw new Response("Collection not found", { status: 404 });

  // Build flat list of all variants in this collection
  const allVariants: VariantInfo[] = [];
  const optionNames = new Set<string>();

  for (const pe of collection.products.edges) {
    const product = pe.node;
    for (const option of product.options) {
      if (option.name !== "Title") optionNames.add(option.name);
    }

    // Build mediaId → URL map for this product
    const mediaUrlMap = new Map<string, string>();
    for (const me of product.media?.edges ?? []) {
      const node = me.node;
      const url = node.image?.url ?? node.preview?.image?.url ?? "";
      if (url) mediaUrlMap.set(node.id, url);
    }

    // Parse Module A's image_assignment metafield (mediaIds per variant)
    let imageAssignment: Record<string, string[]> = {};
    let commonImageIds: string[] = [];
    if (product.metafield?.value) {
      try {
        const parsed = JSON.parse(product.metafield.value);
        imageAssignment = parsed.assignment ?? {};
        commonImageIds = parsed.commonImages ?? [];
      } catch {}
    }

    for (const ve of product.variants.edges) {
      const variant = ve.node;
      const firstOption = variant.selectedOptions[0];

      // Module A: variant-specific assigned images, in user-defined order
      const assignedMediaIds = imageAssignment[variant.id] ?? [];
      const assignedUrls = assignedMediaIds
        .map((id) => mediaUrlMap.get(id))
        .filter((u): u is string => Boolean(u));

      const commonUrls = commonImageIds
        .map((id) => mediaUrlMap.get(id))
        .filter((u): u is string => Boolean(u));

      // FORCE the Shopify variant image (miniatura) as position 0
      const variantThumbnail = variant.image?.url ?? "";

      // Build final list: [variantThumbnail, ...assigned (excluding thumbnail), ...common (excluding thumbnail)]
      const seen = new Set<string>();
      const finalUrls: string[] = [];
      const pushUnique = (u: string) => {
        if (!u || seen.has(u)) return;
        seen.add(u);
        finalUrls.push(u);
      };

      pushUnique(variantThumbnail);
      assignedUrls.forEach(pushUnique);
      commonUrls.forEach(pushUnique);

      const primaryUrl = finalUrls[0] ?? "";

      allVariants.push({
        variantId: variant.id,
        productId: product.id,
        productHandle: product.handle,
        variantTitle: variant.title,
        productTitle: product.title,
        imageUrl: primaryUrl,
        imageUrls: finalUrls,
        price: variant.price,
        availableForSale: variant.availableForSale,
        optionValue: firstOption?.value ?? variant.title,
      });
    }
  }

  // Load saved config
  const config = await db.collectionConfig.findUnique({
    where: { shop_collectionId: { shop: session.shop, collectionId: collection.id } },
    include: { variants: true },
  });

  const savedVariants = Object.fromEntries(
    (config?.variants ?? []).map((v) => [v.variantId, v]),
  );

  return json({
    collection,
    allVariants,
    optionNames: Array.from(optionNames),
    config,
    savedVariants,
    collectionGid: collection.id,
    shop: session.shop,
  });
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const collectionId = `gid://shopify/Collection/${params.collectionId}`;
  const body = await request.json();

  const {
    enabled, splitByOption, hideOutOfStock, showOnlyDiscount,
    hideWithoutImage, titleFormat, customTitleFormat, variants,
    collectionTitle,
  } = body;

  await db.collectionConfig.upsert({
    where: { shop_collectionId: { shop: session.shop, collectionId } },
    update: {
      enabled, splitByOption, hideOutOfStock, showOnlyDiscount,
      hideWithoutImage, titleFormat, customTitleFormat, collectionTitle, updatedAt: new Date(),
    },
    create: {
      shop: session.shop, collectionId, collectionTitle,
      enabled, splitByOption, hideOutOfStock, showOnlyDiscount,
      hideWithoutImage, titleFormat, customTitleFormat,
    },
  });

  type VariantPayload = VariantInfo & { visible: boolean; position: number; hoverImageUrl: string };
  // Upsert each variant config
  for (const v of variants as VariantPayload[]) {
    await db.variantCollectionConfig.upsert({
      where: {
        shop_collectionId_variantId: {
          shop: session.shop, collectionId, variantId: v.variantId,
        },
      },
      update: {
        visible: v.visible, position: v.position,
        hoverImageUrl: v.hoverImageUrl ?? "", updatedAt: new Date(),
      },
      create: {
        shop: session.shop, collectionId, variantId: v.variantId,
        productId: v.productId, variantTitle: v.variantTitle,
        imageUrl: v.imageUrl, hoverImageUrl: v.hoverImageUrl ?? "",
        visible: v.visible, position: v.position,
      },
    });
  }

  // Ensure metafield definitions exist (collection-level + shop-level)
  await admin.graphql(`
    #graphql
    mutation EnsureMetafieldDefinitions {
      collectionDef: metafieldDefinitionCreate(definition: {
        name: "Variantis Display Config",
        namespace: "variantis",
        key: "display_config",
        type: "json",
        ownerType: COLLECTION,
        access: { storefront: PUBLIC_READ }
      }) {
        createdDefinition { id }
        userErrors { field message code }
      }
      shopDef: metafieldDefinitionCreate(definition: {
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

  // Build the storefront payload for THIS collection
  type VariantConfig = { variantId: string; productId: string; productHandle: string; variantTitle: string; productTitle: string; imageUrl: string; imageUrls: string[]; hoverImageUrl: string; price: string; availableForSale: boolean; optionValue: string; visible: boolean; position: number };
  const variantList: VariantConfig[] = (variants as VariantPayload[]).map((v) => ({
    variantId: v.variantId,
    productId: v.productId,
    productHandle: v.productHandle,
    variantTitle: v.variantTitle,
    productTitle: v.productTitle,
    imageUrl: v.imageUrl,
    imageUrls: v.imageUrls ?? (v.imageUrl ? [v.imageUrl] : []),
    hoverImageUrl: v.hoverImageUrl ?? "",
    price: v.price,
    availableForSale: v.availableForSale,
    optionValue: v.optionValue,
    visible: v.visible,
    position: v.position,
  }));

  const storefrontConfig = {
    collectionId,
    enabled,
    splitByOption,
    hideOutOfStock,
    showOnlyDiscount,
    hideWithoutImage,
    titleFormat,
    customTitleFormat,
    variants: variantList,
  };

  // Build the GLOBAL config: aggregate variants from ALL configured collections
  // so homepage / search / arbitrary product cards all benefit
  const allConfigs = await db.collectionConfig.findMany({
    where: { shop: session.shop },
    include: { variants: true },
  });

  // Map productHandle → unified variant entry (deduplicate across collections)
  const handleToVariants = new Map<string, VariantConfig[]>();
  // Include the current save first (most up-to-date data)
  for (const v of variantList) {
    if (!v.productHandle) continue;
    if (!handleToVariants.has(v.productHandle)) handleToVariants.set(v.productHandle, []);
    handleToVariants.get(v.productHandle)!.push(v);
  }

  const globalConfig = {
    enabled,
    splitByOption,
    hideOutOfStock,
    showOnlyDiscount,
    hideWithoutImage,
    titleFormat,
    customTitleFormat,
    // Map of productHandle → array of variant entries
    productHandles: Object.fromEntries(handleToVariants),
    // Per-collection settings keyed by collection GID
    collections: Object.fromEntries(
      allConfigs.map((c) => [
        c.collectionId,
        {
          enabled: c.enabled,
          splitByOption: c.splitByOption,
          hideOutOfStock: c.hideOutOfStock,
          showOnlyDiscount: c.showOnlyDiscount,
          hideWithoutImage: c.hideWithoutImage,
          titleFormat: c.titleFormat,
          customTitleFormat: c.customTitleFormat,
        },
      ]),
    ),
  };

  // Get the actual shop GID
  const shopRes = await admin.graphql(`#graphql
    query { shop { id } }
  `);
  const shopData = await shopRes.json();
  const shopGid = shopData.data.shop.id;

  // Write metafields: collection-specific + shop-level global
  await admin.graphql(`
    #graphql
    mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id key namespace value }
        userErrors { field message }
      }
    }
  `, {
    variables: {
      metafields: [
        {
          ownerId: collectionId,
          namespace: "variantis",
          key: "display_config",
          value: JSON.stringify(storefrontConfig),
          type: "json",
        },
        {
          ownerId: shopGid,
          namespace: "variantis",
          key: "all_configs",
          value: JSON.stringify(globalConfig),
          type: "json",
        },
      ],
    },
  });

  return json({ ok: true });
};

export default function CollectionDisplayConfig() {
  const {
    collection, allVariants, optionNames, config, savedVariants,
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
      allVariants.map((v, i) => [
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
      shopify.toast.show("Collection display saved");
    }
  }, [fetcher.state, fetcher.data, shopify]);

  const save = () => {
    const variantsPayload = allVariants.map((v) => ({
      ...v,
      ...(variantConfigs[v.variantId] ?? { visible: true, position: 0, hoverImageUrl: "" }),
    }));

    fetcher.submit(
      {
        enabled, splitByOption, hideOutOfStock, showOnlyDiscount,
        hideWithoutImage, titleFormat, customTitleFormat,
        collectionTitle: collection.title,
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
      title={collection.title}
      subtitle="Configure variant display for this collection"
      primaryAction={
        <Button variant="primary" onClick={save} loading={isSaving}>
          Save settings
        </Button>
      }
    >
      <TitleBar title={collection.title} />
      <Layout>
        <Layout.Section>
          {/* Main settings */}
          <Card>
            <BlockStack gap="400">
              <InlineStack align="space-between">
                <Text as="h2" variant="headingMd">Display Settings</Text>
                <Badge tone={enabled ? "success" : "attention"}>
                  {enabled ? "Enabled" : "Disabled"}
                </Badge>
              </InlineStack>

              <Checkbox
                label="Enable variant display for this collection"
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

          {/* Variant list */}
          {enabled && (
            <Box paddingBlockStart="400">
              <Card>
                <BlockStack gap="400">
                  <InlineStack align="space-between">
                    <Text as="h2" variant="headingMd">
                      Variant Visibility
                    </Text>
                    <Text as="p" variant="bodySm" tone="subdued">
                      {allVariants.length} variants in this collection
                    </Text>
                  </InlineStack>

                  <Banner tone="info">
                    Toggle individual variants to show or hide them in this
                    collection.
                  </Banner>

                  <BlockStack gap="300">
                    {allVariants.map((v) => {
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
                                  {v.productTitle}
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
                Customers will see each variant as a separate product card in
                this collection.
              </Text>
              <Box
                background="bg-surface-secondary"
                padding="400"
                borderRadius="200"
              >
                <BlockStack gap="200">
                  {allVariants.slice(0, 3).map((v) => (
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
                            ? `${v.productTitle} - ${v.optionValue}`
                            : titleFormat === "variant_only"
                              ? v.optionValue
                              : titleFormat === "product_only"
                                ? v.productTitle
                                : customTitleFormat
                                    .replace("{product}", v.productTitle)
                                    .replace("{variant}", v.optionValue)}
                        </Text>
                        <Text as="span" variant="bodySm" tone="subdued">
                          ${v.price}
                        </Text>
                      </BlockStack>
                    </InlineStack>
                  ))}
                  {allVariants.length > 3 && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      +{allVariants.length - 3} more…
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
