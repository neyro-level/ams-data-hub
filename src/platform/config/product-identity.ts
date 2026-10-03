import projectIdentity from "../../../project.identity.json";

const { productName, productSlug, publicOrigin, faviconPath } = projectIdentity.identity;

if (!productName || !productSlug || !publicOrigin || !faviconPath) {
  throw new Error("Project identity is incomplete");
}

export const productIdentity = Object.freeze({
  appName: productName,
  productSlug,
  publicOrigin,
  metadataBase: new URL(publicOrigin),
  faviconPath,
  wordmark: "DATA HUB",
});
