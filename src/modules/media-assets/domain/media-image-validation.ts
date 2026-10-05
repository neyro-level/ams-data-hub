import sharp from "sharp";

const expectedFormats = new Map([
  ["image/avif", "heif"],
  ["image/jpeg", "jpeg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

export async function assertDecodedImage(contentType: string, body: Uint8Array): Promise<void> {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const expected = expectedFormats.get(normalized);
  if (!expected) throw new Error("MEDIA_IMAGE_DECODE_REJECTED");
  try {
    const metadata = await sharp(body, { failOn: "error", limitInputPixels: 100_000_000 }).metadata();
    if (metadata.format !== expected || !metadata.width || !metadata.height) {
      throw new Error("MEDIA_IMAGE_DECODE_REJECTED");
    }
  } catch {
    throw new Error("MEDIA_IMAGE_DECODE_REJECTED");
  }
}
