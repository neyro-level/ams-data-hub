import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from "saxes";
import type { YrlRawAttribute, YrlRawElement } from "./yrl-2010-parser.ts";

export type MarketplaceXmlErrorCode =
  | "MARKETPLACE_XML_ARTIFACT_TOO_LARGE"
  | "MARKETPLACE_XML_DEPTH_LIMIT_EXCEEDED"
  | "MARKETPLACE_XML_DTD_FORBIDDEN"
  | "MARKETPLACE_XML_FIELD_TOO_LONG"
  | "MARKETPLACE_XML_RECORD_LIMIT_EXCEEDED"
  | "MARKETPLACE_XML_RECORD_TOO_COMPLEX"
  | "MARKETPLACE_XML_ROOT_INVALID"
  | "MARKETPLACE_XML_SIGNATURE_INVALID"
  | "MARKETPLACE_XML_UTF8_INVALID"
  | "MARKETPLACE_XML_MALFORMED";

export class MarketplaceXmlError extends Error {
  constructor(readonly code: MarketplaceXmlErrorCode, readonly line?: number, readonly column?: number, options?: ErrorOptions) {
    super(code, options);
    this.name = "MarketplaceXmlError";
  }
}

export interface MarketplaceXmlLimits {
  maxArtifactBytes: number;
  maxRecords: number;
  maxDepth: number;
  maxElementsPerRecord: number;
  maxAttributesPerElement: number;
  maxFieldCharacters: number;
  maxRecordCharacters: number;
}

export const DEFAULT_MARKETPLACE_XML_LIMITS: MarketplaceXmlLimits = Object.freeze({
  maxArtifactBytes: 256 * 1024 * 1024,
  maxRecords: 100_000,
  maxDepth: 32,
  maxElementsPerRecord: 512,
  maxAttributesPerElement: 64,
  maxFieldCharacters: 256_000,
  maxRecordCharacters: 1_000_000,
});

export interface MarketplaceXmlRecord {
  line: number;
  column: number;
  element: YrlRawElement;
}

export interface MarketplaceXmlParserOptions {
  rootElement: string;
  recordElement: string;
  caseSensitive?: boolean;
  validateRoot?: (attributes: readonly YrlRawAttribute[]) => boolean;
  validatePreamble?: (rootChildren: readonly YrlRawElement[]) => boolean;
  validateDocument?: (rootChildren: readonly YrlRawElement[]) => boolean;
  encoding?: "utf-8" | "windows-1251";
  limits?: Partial<MarketplaceXmlLimits>;
}

type MarketplaceXmlInput = AsyncIterable<Uint8Array | string> | Iterable<Uint8Array | string>;
const WRITE_CHARACTERS = 64 * 1024;

function sameName(actual: string, expected: string, caseSensitive: boolean): boolean {
  return caseSensitive ? actual === expected : actual.toLocaleLowerCase("en-US") === expected.toLocaleLowerCase("en-US");
}

function fail(parser: SaxesParser<{ xmlns: true }>, code: MarketplaceXmlErrorCode, options?: ErrorOptions): never {
  throw new MarketplaceXmlError(code, parser.line, parser.column, options);
}

function attributes(parser: SaxesParser<{ xmlns: true }>, tag: SaxesTagNS, limits: MarketplaceXmlLimits): readonly YrlRawAttribute[] {
  const values = Object.values(tag.attributes) as SaxesAttributeNS[];
  if (values.length > limits.maxAttributesPerElement) fail(parser, "MARKETPLACE_XML_RECORD_TOO_COMPLEX");
  return values.map((attribute) => {
    if (attribute.value.length > limits.maxFieldCharacters) fail(parser, "MARKETPLACE_XML_FIELD_TOO_LONG");
    return { name: attribute.name, localName: attribute.local, prefix: attribute.prefix, namespaceUri: attribute.uri, value: attribute.value };
  });
}

function element(parser: SaxesParser<{ xmlns: true }>, tag: SaxesTagNS, limits: MarketplaceXmlLimits): YrlRawElement {
  return { name: tag.name, localName: tag.local, prefix: tag.prefix, namespaceUri: tag.uri, attributes: attributes(parser, tag, limits), text: "", children: [] };
}

export async function* parseMarketplaceXmlRecords(
  input: MarketplaceXmlInput,
  options: MarketplaceXmlParserOptions,
): AsyncGenerator<MarketplaceXmlRecord, void, undefined> {
  const limits = { ...DEFAULT_MARKETPLACE_XML_LIMITS, ...options.limits };
  const caseSensitive = options.caseSensitive ?? true;
  const parser = new SaxesParser({ xmlns: true, position: true, fileName: "marketplace-feed.xml" });
  const decoder = new TextDecoder(options.encoding ?? "utf-8", { fatal: true });
  const encoder = new TextEncoder();
  const completed: MarketplaceXmlRecord[] = [];
  const rootChildren: YrlRawElement[] = [];
  let byteCount = 0;
  let depth = 0;
  let rootSeen = false;
  let rootDepth = 0;
  let rootChildStack: YrlRawElement[] | null = null;
  let rootMetadataElementCount = 0;
  let rootMetadataCharacterCount = 0;
  let recordDepth = 0;
  let recordLine = 0;
  let recordColumn = 0;
  let recordElementCount = 0;
  let recordCharacterCount = 0;
  let recordStack: YrlRawElement[] | null = null;
  let recordCount = 0;

  parser.on("doctype", () => fail(parser, "MARKETPLACE_XML_DTD_FORBIDDEN"));
  parser.on("error", (error) => fail(parser, "MARKETPLACE_XML_MALFORMED", { cause: error }));
  parser.on("opentag", (tag) => {
    depth += 1;
    if (depth > limits.maxDepth) fail(parser, "MARKETPLACE_XML_DEPTH_LIMIT_EXCEEDED");
    if (!rootSeen) {
      rootSeen = true;
      rootDepth = depth;
      if (!sameName(tag.local, options.rootElement, caseSensitive)) fail(parser, "MARKETPLACE_XML_ROOT_INVALID");
      const rootAttributes = attributes(parser, tag, limits);
      if (options.validateRoot && !options.validateRoot(rootAttributes)) fail(parser, "MARKETPLACE_XML_SIGNATURE_INVALID");
      return;
    }

    if (recordStack) {
      recordElementCount += 1;
      if (recordElementCount > limits.maxElementsPerRecord) fail(parser, "MARKETPLACE_XML_RECORD_TOO_COMPLEX");
      const child = element(parser, tag, limits);
      recordStack.at(-1)!.children.push(child);
      recordStack.push(child);
      return;
    }
    if (depth === rootDepth + 1 && sameName(tag.local, options.recordElement, caseSensitive)) {
      if (options.validatePreamble && !options.validatePreamble(rootChildren)) {
        fail(parser, "MARKETPLACE_XML_SIGNATURE_INVALID");
      }
      recordCount += 1;
      if (recordCount > limits.maxRecords) fail(parser, "MARKETPLACE_XML_RECORD_LIMIT_EXCEEDED");
      recordDepth = depth;
      recordLine = parser.line;
      recordColumn = parser.column;
      recordElementCount = 1;
      recordCharacterCount = 0;
      recordStack = [element(parser, tag, limits)];
      return;
    }
    if (!options.validatePreamble && !options.validateDocument) return;
    rootMetadataElementCount += 1;
    if (rootMetadataElementCount > limits.maxElementsPerRecord) {
      fail(parser, "MARKETPLACE_XML_RECORD_TOO_COMPLEX");
    }
    if (depth === rootDepth + 1) {
      rootChildStack = [element(parser, tag, limits)];
    } else if (rootChildStack) {
      const child = element(parser, tag, limits);
      rootChildStack.at(-1)!.children.push(child);
      rootChildStack.push(child);
    }
  });

  const appendText = (value: string) => {
    const stack = recordStack ?? rootChildStack;
    if (!stack || value.length === 0) return;
    const current = stack.at(-1)!;
    if (current.text.length + value.length > limits.maxFieldCharacters) fail(parser, "MARKETPLACE_XML_FIELD_TOO_LONG");
    if (recordStack) {
      recordCharacterCount += value.length;
      if (recordCharacterCount > limits.maxRecordCharacters) fail(parser, "MARKETPLACE_XML_RECORD_TOO_COMPLEX");
    } else {
      rootMetadataCharacterCount += value.length;
      if (rootMetadataCharacterCount > limits.maxRecordCharacters) fail(parser, "MARKETPLACE_XML_RECORD_TOO_COMPLEX");
    }
    current.text += value;
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);
  parser.on("closetag", (tag) => {
    if (recordStack && depth >= recordDepth) {
      const closed = recordStack.pop();
      if (!closed || !sameName(closed.localName, tag.local, caseSensitive)) fail(parser, "MARKETPLACE_XML_MALFORMED");
      if (depth === recordDepth) {
        completed.push({ line: recordLine, column: recordColumn, element: closed });
        recordStack = null;
      }
    } else if (rootChildStack) {
      const closed = rootChildStack.pop();
      if (!closed || !sameName(closed.localName, tag.local, caseSensitive)) fail(parser, "MARKETPLACE_XML_MALFORMED");
      if (rootChildStack.length === 0) {
        rootChildren.push(closed);
        rootChildStack = null;
      }
    }
    depth -= 1;
  });

  const drain = function* () { while (completed.length > 0) yield completed.shift()!; };
  const safeWrite = function* (value: string) {
    for (let offset = 0; offset < value.length; offset += WRITE_CHARACTERS) {
      try { parser.write(value.slice(offset, offset + WRITE_CHARACTERS)); }
      catch (error) {
        if (error instanceof MarketplaceXmlError) throw error;
        fail(parser, "MARKETPLACE_XML_MALFORMED", { cause: error });
      }
      yield* drain();
    }
  };

  try {
    for await (const rawChunk of input) {
      const chunk = typeof rawChunk === "string" ? encoder.encode(rawChunk) : rawChunk;
      byteCount += chunk.byteLength;
      if (byteCount > limits.maxArtifactBytes) fail(parser, "MARKETPLACE_XML_ARTIFACT_TOO_LARGE");
      yield* safeWrite(decoder.decode(chunk, { stream: true }));
    }
    yield* safeWrite(decoder.decode());
    try { parser.close(); }
    catch (error) {
      if (error instanceof MarketplaceXmlError) throw error;
      fail(parser, "MARKETPLACE_XML_MALFORMED", { cause: error });
    }
    yield* drain();
    if (!rootSeen) fail(parser, "MARKETPLACE_XML_ROOT_INVALID");
    if (options.validateDocument && !options.validateDocument(rootChildren)) fail(parser, "MARKETPLACE_XML_SIGNATURE_INVALID");
  } catch (error) {
    if (error instanceof MarketplaceXmlError) throw error;
    if (error instanceof TypeError && error.message.toLowerCase().includes("encoded data")) {
      fail(parser, "MARKETPLACE_XML_UTF8_INVALID", { cause: error });
    }
    fail(parser, "MARKETPLACE_XML_MALFORMED", { cause: error });
  }
}
