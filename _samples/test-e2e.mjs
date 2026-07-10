import { readFileSync } from "fs";
const env = readFileSync(".env.local","utf8");
env.split("\n").forEach(line => { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; });
const { createClient } = await import("@supabase/supabase-js");
const { recognizeShelfPhoto } = await import("../server/shelf-recognition/index.ts");
const { getCatalogMatchCandidates } = await import("../server/catalog-matching.ts");
const { chooseCatalogMatchWithTextAi } = await import("../server/text-ai/catalog-match.ts");

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// company
const { data: m } = await sb.from("company_members").select("company_id").limit(1);
const companyId = m[0].company_id;

// первый конкурент
const { data: stores } = await sb.from("stores").select("id,name").eq("company_id",companyId).eq("is_own",false).limit(1);
const store = stores[0];
console.log("Store:", store.name, "| id:", store.id);

// каталог
const [{data:chem},{data:prod}] = await Promise.all([
  sb.from("catalog_products").select("id,name,brand,size_text,is_active").eq("company_id",companyId).eq("is_active",true).eq("department","chemistry").limit(1500),
  sb.from("catalog_products").select("id,name,brand,size_text,is_active").eq("company_id",companyId).eq("is_active",true).eq("department","products").limit(1500),
]);
const catalog = [...(chem||[]), ...(prod||[])];
console.log("Catalog:", catalog.length);

// распознавание (только первые 2 товара для скорости)
const buf = readFileSync("_samples/шоколадки 1.jpg");
console.log("\nRecognizing photo...");
const rec = await recognizeShelfPhoto({ imageBase64: buf.toString("base64"), mimeType:"image/jpeg" });
console.log("Recognized:", rec.items.length, "items. Testing first 3 only for speed.\n");

let matched=0, review=0, notIn=0, inserted=0;
const today = new Date().toISOString().slice(0,10);

for (const item of rec.items.slice(0,3)) {
  if (item.price_minor === null) continue;
  console.log(`📷 "${item.raw_name}" | ${(item.price_minor/100).toFixed(2)}₽`);
  const recognized = { rawName: item.raw_name, brand: item.brand, sizeText: item.size_text };
  const candidates = getCatalogMatchCandidates(recognized, catalog, { limit: 20 });
  const decision = await chooseCatalogMatchWithTextAi({ item: recognized, candidates });

  let productId = null;
  if (decision.decision === "same_product" && decision.catalog_product_id) {
    productId = decision.catalog_product_id;
    matched++;
    console.log(`   ✅ matched: ${catalog.find(c=>c.id===productId)?.name}`);
  } else if (decision.decision === "different_product") { notIn++; console.log("   ❌ not in catalog"); }
  else { review++; console.log("   🤔 needs review"); }

  const { error } = await sb.from("price_history").insert({
    company_id: companyId, week: 1, catalog_product_id: productId, store_id: store.id,
    price_minor: item.price_minor, currency:"RUB", confidence: Math.max(decision.confidence, item.confidence),
    source:"photo", photo_storage_path:"_test/sample.jpg", captured_date: today,
  });
  if (error) console.log("   ⚠️ INSERT ERROR:", error.message);
  else { inserted++; console.log("   ✓ saved to price_history"); }
  console.log();
}

console.log(`=== SUMMARY: matched=${matched} review=${review} notIn=${notIn} inserted=${inserted} ===`);
