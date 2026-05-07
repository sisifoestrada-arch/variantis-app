import { json } from "@remix-run/node";
import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData, useNavigate } from "@remix-run/react";
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
  EmptyState,
  Box,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";

interface CollectionNode {
  id: string;
  title: string;
  handle: string;
  image: { url: string; altText: string | null } | null;
  productsCount: { count: number };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);

  const response = await admin.graphql(`
    #graphql
    query getCollections($first: Int!) {
      collections(first: $first, sortKey: TITLE) {
        edges {
          node {
            id
            title
            handle
            image { url altText }
            productsCount { count }
          }
        }
      }
    }
  `, { variables: { first: 50 } });

  const data = await response.json();
  const collections: CollectionNode[] = data.data.collections.edges.map(
    (e: { node: CollectionNode }) => e.node,
  );

  // Get configured collections from DB
  const configs = await db.collectionConfig.findMany({
    where: { shop: session.shop },
    select: { collectionId: true, enabled: true, splitByOption: true },
  });

  const configMap = Object.fromEntries(
    configs.map((c) => [c.collectionId, c]),
  );

  return json({ collections, configMap });
};

export default function CollectionDisplay() {
  const { collections, configMap } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  return (
    <Page
      backAction={{ content: "Home", url: "/app" }}
      title="Collection Display"
      subtitle="Configure how variants appear in each collection"
    >
      <TitleBar title="Collection Display" />
      <Layout>
        <Layout.Section>
          {collections.length === 0 ? (
            <Card>
              <EmptyState
                heading="No collections found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p" variant="bodyMd">
                  Create collections in your Shopify admin and come back here
                  to configure variant display for each one.
                </Text>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <ResourceList
                resourceName={{ singular: "collection", plural: "collections" }}
                items={collections}
                renderItem={(col) => {
                  const numericId = col.id.replace(
                    "gid://shopify/Collection/",
                    "",
                  );
                  const config = configMap[col.id];
                  const isConfigured = Boolean(config);

                  return (
                    <ResourceItem
                      id={col.id}
                      url={`/app/collection-display/${numericId}`}
                      accessibilityLabel={`Configure ${col.title}`}
                    >
                      <InlineStack align="space-between" blockAlign="center">
                        <BlockStack gap="100">
                          <Text as="h3" variant="bodyMd" fontWeight="bold">
                            {col.title}
                          </Text>
                          <InlineStack gap="200">
                            <Badge>{`${col.productsCount.count} products`}</Badge>
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
                        <Button
                          onClick={() =>
                            navigate(`/app/collection-display/${numericId}`)
                          }
                          variant="plain"
                        >
                          Configure
                        </Button>
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
                  <Text as="span" fontWeight="bold">1. Select a collection</Text>{" "}
                  and enable variant display.
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
                  Variants appear as separate cards without creating new
                  products in your catalog.
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
                  To display variants in collections, enable the Variantis
                  app embed in your theme editor.
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
