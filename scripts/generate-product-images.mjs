/**
 * Generates product photos for the fictional Companies with OpenAI's image
 * API and writes them to apps/<company>/public/img/<id>.webp.
 *
 * The key is read from OPENAI_API_KEY in the environment and is never
 * written anywhere. Run it yourself so the key stays out of other tools:
 *
 *   OPENAI_API_KEY=... node scripts/generate-product-images.mjs --sample
 *   OPENAI_API_KEY=... node scripts/generate-product-images.mjs
 *
 * --sample makes one image per Company. An existing file is kept unless
 * --force is given, so a rerun only pays for what is missing.
 * IMAGE_MODEL (default gpt-image-2), IMAGE_QUALITY (default medium) and
 * IMAGE_COMPRESSION (default 70) and IMAGE_SIZE (default 1024x1024) can be
 * overridden.
 */
import { Buffer } from "node:buffer";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import console from "node:console";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error("Set OPENAI_API_KEY in the environment.");
  process.exit(1);
}
const sample = process.argv.includes("--sample");
const force = process.argv.includes("--force");
const model = process.env.IMAGE_MODEL ?? "gpt-image-2";
const quality = process.env.IMAGE_QUALITY ?? "medium";
// 0-100; around 70 keeps a product photo sharp at a fraction of the size.
// gpt-image-2 refuses 768x768 (below its minimum pixel budget), so the
// default stays at 1024x1024 and compression keeps the files light.
const size = process.env.IMAGE_SIZE ?? "1024x1024";
const compression = Number(process.env.IMAGE_COMPRESSION ?? 70);

const style =
  "Editorial product photograph, soft natural window light, shallow depth of field, " +
  "seen from slightly above, on a plain warm neutral background. No text, no labels, " +
  "no logos, no people, no hands.";

const companies = {
  "example-company": [
    [
      "oranges",
      "A paper bag of Cara cara oranges, a few cut open to show pink flesh",
    ],
    [
      "broccoli",
      "A bunch of purple sprouting broccoli with long purple-green stems",
    ],
    ["apples", "A bag of Pink Lady apples, red-pink with a yellow blush"],
    [
      "coffee",
      "A 250 g kraft coffee bag, plain and unlabelled, with a few roasted beans beside it",
    ],
  ],
  lantern: [
    [
      "shoyu-ramen",
      "A bowl of shoyu ramen with soy-brown broth, noodles, a soft egg, nori and spring onion",
    ],
    [
      "miso-ramen",
      "A bowl of miso vegetable ramen with corn, mushrooms, bok choy and a cloudy broth",
    ],
    [
      "pork-gyoza",
      "Six pan-fried pork gyoza on a plate, crisp golden bases, with a small dish of dipping sauce",
    ],
    [
      "veg-gyoza",
      "Six pan-fried vegetable gyoza on a plate, with a small dish of dipping sauce",
    ],
    ["edamame", "A small bowl of salted edamame pods"],
    ["matcha-ice", "Two scoops of matcha ice cream in a small ceramic bowl"],
  ],
};

let cost = 0;
for (const [company, items] of Object.entries(companies)) {
  const dir = path.join(root, "apps", company, "public", "img");
  await mkdir(dir, { recursive: true });
  for (const [id, subject] of sample ? items.slice(0, 1) : items) {
    const file = path.join(dir, `${id}.webp`);
    const exists = await access(file).then(
      () => true,
      () => false,
    );
    if (exists && !force) {
      console.log(`kept     ${company}/${id}`);
      continue;
    }
    const response = await globalThis.fetch(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        // A stuck request should fail the run, not hang it.
        signal: globalThis.AbortSignal.timeout(180_000),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model,
          prompt: `${subject}. ${style}`,
          size,
          quality,
          output_format: "webp",
          output_compression: compression,
          n: 1,
        }),
      },
    );
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      console.error(
        `failed   ${company}/${id}: ${response.status} ${body?.error?.message ?? ""}`,
      );
      process.exit(1);
    }
    const data = await response.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) {
      console.error(`failed   ${company}/${id}: no image in the response`);
      process.exit(1);
    }
    await writeFile(file, Buffer.from(b64, "base64"));
    cost += 1;
    console.log(`wrote    ${company}/${id}`);
  }
}
console.log(
  `Done. ${cost} image(s) requested with ${model} at ${quality} quality.`,
);
