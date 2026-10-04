export class MediaAssetError extends Error {
  public constructor(public readonly code: "MEDIA_ADMIN_ACCESS_DENIED" | "MEDIA_PROJECT_NOT_FOUND") {
    super(code);
    this.name = "MediaAssetError";
  }
}
