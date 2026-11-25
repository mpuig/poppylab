# Product photos

Juniper Market and Lantern Noodle Bar show a photo for each product or dish
on their websites, and give its address in their catalogue APIs. Harborline
and Northwind sell no products and have none.

The photos are **generated images** of fictional products, made with OpenAI's
image API from the prompts in `scripts/generate-product-images.mjs`. They are
not photographs of real food and show no real brand.

## Where the files are

| Company | Folder                             | Files                                                                           |
| ------- | ---------------------------------- | ------------------------------------------------------------------------------- |
| Juniper | `apps/example-company/public/img/` | `oranges`, `broccoli`, `apples`, `coffee`                                       |
| Lantern | `apps/lantern/public/img/`         | `shoyu-ramen`, `miso-ramen`, `pork-gyoza`, `veg-gyoza`, `edamame`, `matcha-ice` |

Each is `<id>.webp`, where `<id>` is the product or dish id, 1024 by 1024
pixels and about 60 to 110 KB. The pages show them cropped to 4:3.

## How they are served

- **On Workers**, `wrangler.toml` has an `[assets]` block with
  `directory = "./public"`. Cloudflare answers a request for a file there
  before the Worker runs, so a photo carries none of the Company's own
  response headers. That is acceptable for an image and means no photo can be
  made to depend on a Company's state.
- **In development**, `src/node.ts` serves `/img/*` from `public/`, found
  from the file's own location and not from where the server was started.
- **On a page**, each photo is `<img class="photo" src="/img/<id>.webp" alt="">`
  with its size set. The `alt` is empty because the product's name is printed
  next to it. Lantern loads its first three photos at once and the rest lazily.

## Content-Security-Policy

Pages allow images from their own origin and nothing else:

- Lantern's `pageHeaders` (in `apps/lantern/src/site.ts`) include
  `img-src 'self'`.
- Juniper sets `pageHeaders` on its definition with the same `img-src 'self'`,
  for its home page. Its account pages keep their own policy, which allows no
  images.
- The default the gateway adds to every other response allows **no** images,
  so Harborline and Northwind are unchanged. `apps/example-company/src/pap.test.ts`
  checks both halves.

## In the catalogue

`GET /api/menu` (Lantern) and `GET /api/products` (Juniper) give every item an
`image`: an absolute URL to its photo, such as
`https://food-demo.poppylab.dev/img/shoyu-ramen.webp`. It is built from the
origin the Company is configured with, never from the request's `Host`
header, and has no query string. The OpenAPI summary of each endpoint says so.
The field is an addition, so agents that ignore it are unaffected.

A test in each Company checks that every item's `image` is well formed, on the
Company's own origin and points at a file that exists, so an item added
without a photo fails the tests.

## Making or replacing photos

Run the script yourself, so the key stays out of other tools and out of the
repository. It reads `OPENAI_API_KEY` from the environment and never writes it
anywhere.

```sh
OPENAI_API_KEY=... node scripts/generate-product-images.mjs --sample   # one per Company
OPENAI_API_KEY=... node scripts/generate-product-images.mjs            # what is missing
OPENAI_API_KEY=... node scripts/generate-product-images.mjs --force     # all of them again
```

- It makes one request per image and skips files that already exist, so a
  rerun only pays for what is missing. It tries a request up to three times
  when the answer is a rate limit or a server error, and stops on anything
  else.
- `IMAGE_MODEL` (default `gpt-image-2`), `IMAGE_QUALITY` (default `medium`),
  `IMAGE_SIZE` (default `1024x1024`) and `IMAGE_COMPRESSION` (default `70`)
  override the defaults. `gpt-image-1` no longer exists, and `gpt-image-2`
  refuses `768x768` as below its minimum size. Compression is what keeps each
  file under about 110 KB; without it they are about 1 MB.
- To add a product, add it to the Company's catalogue and to the list at the
  top of the script, run the script, and the tests will confirm the file.

## Known limits

- The two gyoza photos show seven pieces, and the dishes are listed as six.
- The photos are not versioned in their address, so a replaced photo can be
  served from a cache for a short while.
