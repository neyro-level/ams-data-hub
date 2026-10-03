export class SharedCatalogError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "SharedCatalogError";
  }
}
