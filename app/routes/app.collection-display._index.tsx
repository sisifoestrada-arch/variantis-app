import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  ResourceList,
  ResourceItem,
  Thumbnail,
  EmptyState,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  featuredImage: { url: string; altText: string | null } | null;
  variantsCount: { count: number };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(`
    #graphql
    query getProducts($first: Int!) {
      products(first: $first, sortKey: TITLE) {
        edges {
          node {
            id
            title
            handle
            status
            featuredImage { url altText }
            variantsCount { count }
          }
        }
      }
    }
  `, { variables: { first: 100 } });

  const data = await response.json();
  const products: ProductNode[] = data.data.products.edges.map(
    (e: { node: ProductNode }) => e.node,
  );

  // Get configured products from DB
  const configs = await db.productConfig.findMany({
    where: { shop: session.shop },
    select: { productId: true, enabled: true, splitByOption: true },
  });

  const configMap = Object.fromEntries(
    configs.map((c) => [c.productId, c]),
  );

  return json({ products, configMap });
};

export default function CollectionDisplay() {
  const { products, configMap } = useLoaderData<typeof loader>();

  // Only products with > 1 variant can be split into cards
  const eligible = products.filter((p) => p.variantsCount.count > 1);

  return (
    <Page
      backAction={{ content: "Home", url: "/app" }}
      title="Collection Display"
      subtitle="Configure how each product's variants appear as separate cards"
    >
      <TitleBar title="Collection Display" />
      <Layout>
        <Layout.Section>
          {eligible.length === 0 ? (
            <Card>
              <EmptyState
                heading="No multi-variant products found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p" variant="bodyMd">
                  This module shows variants as separate cards in your
                  collections, homepage and search. Add variants to your
                  products in Shopify first.
                </Text>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <ResourceList
                resourceName={{ singular: "product", plural: "products" }}
                items={eligible}
                renderItem={(product) => {
                  const numericId = product.id.replace(
                    "gid://shopify/Product/",
                    "",
                  );
                  const config = configMap[product.id];
                  const isConfigured = Boolean(config);

                  return (
                    <ResourceItem
                      id={product.id}
                      url={`/app/collection-display/${numericId}`}
                      media={
                        <Thumbnail
                          source={product.featuredImage?.url ?? ""}
                          alt={product.featuredImage?.altText ?? product.title}
                          size="medium"
                        />
                      }
                      accessibilityLabel={`Configure ${product.title}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="h3" variant="bodyMd" fontWeight="bold">
                            {product.title}
                          </Text>
                          <InlineStack gap="200">
                            <Badge>{`${product.variantsCount.count} variants`}</Badge>
                            <Badge
                              tone={
                                product.status === "ACTIVE"
                                  ? "success"
                                  : "attention"
                              }
                            >
                              {product.status.toLowerCase()}
                            </Badge>
                            {isConfigured ? (
                              <Badge tone={config.enabled ? "success" : "attention"}>
                                {config.enabled
                                  ? `Split by ${config.splitByOption}`
                                  : "Disabled"}
                              </Badge>
                            ) : (
                              <Badge tone="new">Not configured</Badge>
                            )}
                          </InlineStack>
                        </BlockStack>
                        <Text as="span" variant="bodyMd" tone="subdued">
                          Configure →
                        </Text>
                      </InlineStack>
                    </ResourceItem>
                  );
                }}
              />
            </Card>
          )}
        </Layout.Section>

        <Layout.Section variant="oneThird">
          <Card>
            <BlockStack gap="300">
              <Text as="h2" variant="headingMd">
                How it works
              </Text>
              <BlockStack gap="200">
                <Text as="p" variant="bodyMd">
                  <Text as="span" fontWeight="bold">1. Pick a product</Text>{" "}
                  from the list and configure which variants to show as cards.
                </Text>
                <Text as="p" variant="bodyMd">
                  <Text as="span" fontWeight="bold">2. Choose the option</Text>{" "}
                  to split by (Color, Size, Material…).
                </Text>
                <Text as="p" variant="bodyMd">
                  <Text as="span" fontWeight="bold">3. Control visibility</Text>{" "}
                  — show/hide specific variants, set hover images, reorder.
                </Text>
                <Text as="p" variant="bodyMd">
                  <Text as="span" fontWeight="bold">4. No duplicates.</Text>{" "}
                  Variants appear as separate cards in home, collections and
                  search without creating new products in your catalog.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>

          <Box paddingBlockStart="400">
            <Card>
              <BlockStack gap="300">
                <Text as="h2" variant="headingMd">
                  Theme setup required
                </Text>
                <Text as="p" variant="bodySm" tone="subdued">
                  To display variants as separate cards, enable the Variantis
                  Collections app embed in your theme editor.
                </Text>
                <Button
                  url="shopify:admin/themes/current/editor?context=apps"
                  target="_blank"
                  variant="secondary"
                  fullWidth
                >
                  Open Theme Editor
                </Button>
              </BlockStack>
            </Card>
          </Box>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
