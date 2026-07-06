"use server";

import { createCatalogProduct } from "../../../server/catalog";

export async function createProductAction(formData: FormData) {
  const externalSku = formData.get("external_sku");
  const name = formData.get("name");
  const brand = formData.get("brand");
  const sizeText = formData.get("size_text");
  const ownPriceStr = formData.get("own_price_minor");
  const currency = formData.get("currency");

  if (!externalSku || typeof externalSku !== "string") {
    throw new Error("external_sku is required");
  }
  if (!name || typeof name !== "string") {
    throw new Error("name is required");
  }

  const ownPriceMinor = ownPriceStr && typeof ownPriceStr === "string" ? BigInt(ownPriceStr) : undefined;
  const brandValue = brand && typeof brand === "string" && brand.trim() ? brand.trim() : null;
  const sizeTextValue = sizeText && typeof sizeText === "string" && sizeText.trim() ? sizeText.trim() : null;
  const currencyValue = currency && typeof currency === "string" ? currency : "RUB";

  return createCatalogProduct(externalSku.trim(), name.trim(), {
    brand: brandValue,
    sizeText: sizeTextValue,
    ownPriceMinor,
    currency: currencyValue,
  });
}
