import { expect, it } from "vitest";
import { openApiDocument } from "./openapi";

it("keeps openapi.json, the file a client app is built from, as the API describes itself", async () => {
  // `vitest run -u` writes it again after the API changes.
  await expect(
    `${JSON.stringify(openApiDocument(), null, 2)}\n`,
  ).toMatchFileSnapshot("../openapi.json");
});
