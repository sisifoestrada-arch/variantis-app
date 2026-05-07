import type { LoaderFunctionArgs } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";
import {
  Page,
  Layout,
  Text,
  Card,
  BlockStack,
  InlineStack,
  Button,
  Badge,
  Box,
  Divider,
} from "@shopify/polaris";
import { TitleBar } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);
  return null;
};

export default function Index() {
  const navigate = useNavigate();

  return (
    <Page>
      <TitleBar title="Variantis" />
      <BlockStack gap="600">
        <BlockStack gap="200">
          <Text as="h1" variant="headingXl">
            Variantis
          </Text>
          <Text as="p" variant="bodyMd" tone="subdued">
            Two powerful modules to improve how your variants are displayed — in
            product pages and across your entire store.
          </Text>
        </BlockStack>

        <Layout>
          {/* Module A */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingLg">
                        Variant Images
                      </Text>
                      <Badge tone="success">Module A</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Product page
                    </Text>
                  </BlockStack>
                </InlineStack>

                <Divider />

                <BlockStack gap="300">
                  <Text as="p" variant="bodyMd">
                    Assign multiple images per variant and show only the
                    relevant ones when a customer selects a color, style, or
                    size.
                  </Text>
                  <BlockStack gap="200">
                    {[
                      "Filter gallery images when variant changes",
                      "Assign images via drag & drop",
                      "Shared images across all variants",
                      "Visual swatches: image, color, pill",
                      "Hide / gray out sold-out variants",
                    ].map((f) => (
                      <InlineStack key={f} gap="200" blockAlign="center">
                        <Box>
                          <Text as="span" tone="success" variant="bodyMd">
                            ✓
                          </Text>
                        </Box>
                        <Text as="span" variant="bodyMd">
                          {f}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>

                <Button
                  variant="primary"
                  onClick={() => navigate("/app/variant-images")}
                  fullWidth
                >
                  Configure Variant Images
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>

          {/* Module B */}
          <Layout.Section variant="oneHalf">
            <Card>
              <BlockStack gap="400">
                <InlineStack align="space-between" blockAlign="start">
                  <BlockStack gap="100">
                    <InlineStack gap="200" blockAlign="center">
                      <Text as="h2" variant="headingLg">
                        Collection Display
                      </Text>
                      <Badge tone="info">Module B</Badge>
                    </InlineStack>
                    <Text as="p" variant="bodySm" tone="subdued">
                      Collections · Homepage · Search
                    </Text>
                  </BlockStack>
                </InlineStack>

                <Divider />

                <BlockStack gap="300">
                  <Text as="p" variant="bodyMd">
                    Show each variant as a separate product card in your
                    collections, homepage, and search results — without
                    duplicating products.
                  </Text>
                  <BlockStack gap="200">
                    {[
                      "Variants as individual cards in collections",
                      "No product duplication in your catalog",
                      "Split by color, size, material, or any option",
                      "Hover image per variant",
                      "Hide out-of-stock, show only discounted",
                      "Custom title format per collection",
                    ].map((f) => (
                      <InlineStack key={f} gap="200" blockAlign="center">
                        <Box>
                          <Text as="span" tone="success" variant="bodyMd">
                            ✓
                          </Text>
                        </Box>
                        <Text as="span" variant="bodyMd">
                          {f}
                        </Text>
                      </InlineStack>
                    ))}
                  </BlockStack>
                </BlockStack>

                <Button
                  variant="primary"
                  onClick={() => navigate("/app/collection-display")}
                  fullWidth
                >
                  Configure Collection Display
                </Button>
              </BlockStack>
            </Card>
          </Layout.Section>
        </Layout>
      </BlockStack>
    </Page>
  );
}
