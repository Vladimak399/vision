import { readFileSync } from "fs";
// Load env manually
const env = readFileSync(".env.local","utf8");
env.split("\n").forEach(line => {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g,"");
});
const { recognizeShelfPhotoWithOpenRouter } = await import("../server/shelf-recognition/openrouter.ts");

const buf = readFileSync("_samples/шоколадки 1.jpg");
const base64 = buf.toString("base64");

console.log("Sending photo to nemotron-nano-12b-vl:free...");
const t0 = Date.now();
try {
  const result = await recognizeShelfPhotoWithOpenRouter({ imageBase64: base64, mimeType: "image/jpeg" });
  console.log(`\nRecognized ${result.items.length} items in ${Date.now()-t0}ms`);
  console.log("Warnings:", result.warnings);
  console.log("\n=== ITEMS ===");
  result.items.forEach((item, i) => {
    const price = item.price_minor !== null ? `${(item.price_minor/100).toFixed(2)} RUB` : "—";
    console.log(`${i+1}. ${item.raw_name || "(no name)"} | ${price} | conf:${item.confidence} | ${item.position_hint||""}`);
  });
} catch (e) {
  console.error("ERROR:", e.message);
}
