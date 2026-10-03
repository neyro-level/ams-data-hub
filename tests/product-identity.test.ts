import { describe, expect, it } from "vitest";
import projectManifest from "../project.identity.json";
import { productIdentity } from "../src/platform/config/product-identity.ts";

describe("product identity", () => {
  it("is sourced from the project manifest", () => {
    expect(productIdentity).toMatchObject({
      appName: projectManifest.identity.productName,
      productSlug: projectManifest.identity.productSlug,
      publicOrigin: projectManifest.identity.publicOrigin,
      faviconPath: projectManifest.identity.faviconPath,
    });
    expect(productIdentity.metadataBase.href).toBe(`${projectManifest.identity.publicOrigin}/`);
  });
});
