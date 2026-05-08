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
  Badge,
  ResourceList,
  ResourceItem,
  Thumbnail,
  EmptyState,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

interface ProductNode {
  id: string;
  title: string;
  handle: string;
  status: string;
  featuredImage: { url: string; altText: string | null } | null;
  variants: {
    edges: Array<{
      node: { id: string; title: string; image: { url: string } | null };
    }>;
  };
  media: { edges: Array<{ node: { id: string } }> };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);

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
            featuredImage {
              url
              altText
            }
            variants(first: 20) {
              edges {
                node {
                  id
                  title
                  image {
                    url
                  }
                }
              }
            }
            media(first: 1) {
              edges {
                node {
                  id
                }
              }
            }
          }
        }
      }
    }
  `, { variables: { first: 50 } });

  const data = await response.json();
  const products: ProductNode[] = data.data.products.edges.map(
    (e: { node: ProductNode }) => e.node,
  );

  return json({ products });
};

export default function VariantImages() {
  const { products } = useLoaderData<typeof loader>();

  const multiVariantProducts = products.filter(
    (p) => p.variants.edges.length > 1,
  );

  return (
    <Page
      backAction={{ content: "Home", url: "/app" }}
      title="Variant Images"
      subtitle="Select a product to assign images to each variant"
    >
      <TitleBar title="Variant Images" />
      <Layout>
        <Layout.Section>
          {multiVariantProducts.length === 0 ? (
            <Card>
              <EmptyState
                heading="No multi-variant products found"
                image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
              >
                <Text as="p" variant="bodyMd">
                  This module works with products that have more than one
                  variant. Add variants to your products first.
                </Text>
              </EmptyState>
            </Card>
          ) : (
            <Card padding="0">
              <ResourceList
                resourceName={{ singular: "product", plural: "products" }}
                items={multiVariantProducts}
                renderItem={(product) => {
                  const variantCount = product.variants.edges.length;
                  const numericId = product.id.replace(
                    "gid://shopify/Product/",
                    "",
                  );

                  return (
                    <ResourceItem
                      id={product.id}
                      url={`/app/variant-images/${numericId}`}
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
                            <Badge>{`${variantCount} variants`}</Badge>
                            <Badge
                              tone={
                                product.status === "ACTIVE"
                                  ? "success"
                                  : "attention"
                              }
                            >
                              {product.status.toLowerCase()}
                            </Badge>
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
                  <Text as="span" fontWeight="bold">
                    1. Select a product
                  </Text>{" "}
                  from the list on the left.
                </Text>
                <Text as="p" variant="bodyMd">
                  <Text as="span" fontWeight="bold">
                    2. Assign images
                  </Text>{" "}
                  to each variant by dragging them into the correct group.
                </Text>
                <Text as="p" variant="bodyMd">
                  <Text as="span" fontWeight="bold">
                    3. Save.
                  </Text>{" "}
                  The storefront will automatically filter the gallery when
                  customers switch variants.
                </Text>
              </BlockStack>
            </BlockStack>
          </Card>
        </Layout.Section>
      </Layout>
    </Page>
  );
}
