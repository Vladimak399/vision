import { readFileSync } from "fs";
const env = readFileSync(".env.local","utf8");
env.split("\n").forEach(line => { const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) process.env[m[1]] = m[2]; });

const buf = readFileSync("_samples/шоколадки 1.jpg");
const base64 = buf.toString("base64");
console.log("Image size:", (buf.length/1024).toFixed(0), "KB, base64:", (base64.length/1024).toFixed(0), "KB");

const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 90000);
const t0 = Date.now();
try {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    signal: controller.signal,
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://pricevision.local",
      "X-Title": "PriceVision",
    },
    body: JSON.stringify({
      model: "nvidia/nemotron-nano-12b-v2-vl:free",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text: "List visible products and prices as JSON {items:[{name,price}]}" },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
      ]}],
    }),
  });
  clearTimeout(timeout);
  console.log(`Status: ${resp.status} in ${Date.now()-t0}ms`);
  const data = await resp.json();
  if (data.error) console.log("ERROR:", data.error.message || JSON.stringify(data.error).slice(0,200));
  else console.log("RESPONSE:", (data.choices?.[0]?.message?.content||"").slice(0,500));
} catch (e) {
  clearTimeout(timeout);
  console.log("FAILED after", Date.now()-t0, "ms:", e.name, e.message?.slice(0,100));
}
