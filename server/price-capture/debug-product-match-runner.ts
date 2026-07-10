import { buildLocalProductMatchDebugResult, createLocalCatalogProductMatcher, productMatchToDebugItem, type LocalProductMatchDebugResult } from "./local-product-matcher";
import { DEBUG_MATCH_CATALOG, DEBUG_MATCH_CATALOG_SOURCE } from "./debug-match-catalog";
import type { ParsedPriceCandidate, PriceCaptureRunContext, ProductTextCandidate } from "./evidence-contract";

export type DebugProductMatchInputItem = {
  itemId: string;
  productText: ProductTextCandidate;
  parsedPrice?: ParsedPriceCandidate | null;
};

export type DebugProductMatchResult = LocalProductMatchDebugResult & {
  catalogSource: typeof DEBUG_MATCH_CATALOG_SOURCE;
};

export async function runDebugProductMatching(input: {
  run: PriceCaptureRunContext;
  items: DebugProductMatchInputItem[];
}): Promise<DebugProductMatchResult> {
  const matcher = createLocalCatalogProductMatcher();
  const matchedItems = [];

  for (const item of input.items) {
    const match = await matcher.match({
      run: input.run,
      productText: item.productText,
      parsedPrice: item.parsedPrice ?? null,
      catalog: DEBUG_MATCH_CATALOG,
    });

    matchedItems.push(productMatchToDebugItem({
      itemId: item.itemId,
      productText: item.productText,
      match,
    }));
  }

  return {
    catalogSource: DEBUG_MATCH_CATALOG_SOURCE,
    ...buildLocalProductMatchDebugResult({
      inputDraftCount: input.items.length,
      catalogSize: DEBUG_MATCH_CATALOG.filter((product) => product.is_active !== false).length,
      items: matchedItems,
    }),
  };
}
