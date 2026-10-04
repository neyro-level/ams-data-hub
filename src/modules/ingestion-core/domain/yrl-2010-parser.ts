import { SaxesParser, type SaxesAttributeNS, type SaxesTagNS } from "saxes";

export type YrlParserErrorCode =
  | "YRL_ARTIFACT_TOO_LARGE"
  | "YRL_DEPTH_LIMIT_EXCEEDED"
  | "YRL_DTD_FORBIDDEN"
  | "YRL_FIELD_TOO_LONG"
  | "YRL_NAMESPACE_MISMATCH"
  | "YRL_OFFER_LIMIT_EXCEEDED"
  | "YRL_OFFER_TOO_COMPLEX"
  | "YRL_ROOT_INVALID"
  | "YRL_UTF8_INVALID"
  | "YRL_XML_MALFORMED";

export class YrlParserError extends Error {
  constructor(
    readonly code: YrlParserErrorCode,
    readonly line?: number,
    readonly column?: number,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "YrlParserError";
  }
}

export interface YrlRawAttribute {
  name: string;
  localName: string;
  prefix: string;
  namespaceUri: string;
  value: string;
}

export interface YrlRawElement {
  name: string;
  localName: string;
  prefix: string;
  namespaceUri: string;
  attributes: readonly YrlRawAttribute[];
  text: string;
  children: YrlRawElement[];
}

export interface YrlRawOffer {
  line: number;
  column: number;
  element: YrlRawElement;
}

export interface YrlParserLimits {
  maxArtifactBytes: number;
  maxOffers: number;
  maxDepth: number;
  maxElementsPerOffer: number;
  maxAttributesPerElement: number;
  maxFieldCharacters: number;
  maxOfferCharacters: number;
}

export interface YrlParserOptions {
  expectedNamespace?: string;
  limits?: Partial<YrlParserLimits>;
}

export const DEFAULT_YRL_PARSER_LIMITS: YrlParserLimits = Object.freeze({
  maxArtifactBytes: 256 * 1024 * 1024,
  maxOffers: 100_000,
  maxDepth: 32,
  maxElementsPerOffer: 512,
  maxAttributesPerElement: 64,
  maxFieldCharacters: 256_000,
  maxOfferCharacters: 1_000_000,
});

const PARSER_WRITE_CHARACTERS = 64 * 1024;

type YrlInput =
  | AsyncIterable<Uint8Array | string>
  | Iterable<Uint8Array | string>;

function fail(parser: SaxesParser<{ xmlns: true }>, code: YrlParserErrorCode, options?: ErrorOptions): never {
  throw new YrlParserError(code, parser.line, parser.column, options);
}

function rawAttributes(
  parser: SaxesParser<{ xmlns: true }>,
  tag: SaxesTagNS,
  limits: YrlParserLimits,
): readonly YrlRawAttribute[] {
  const attributes = Object.values(tag.attributes) as SaxesAttributeNS[];
  if (attributes.length > limits.maxAttributesPerElement) {
    fail(parser, "YRL_OFFER_TOO_COMPLEX");
  }
  return attributes.map((attribute) => {
    if (attribute.value.length > limits.maxFieldCharacters) {
      fail(parser, "YRL_FIELD_TOO_LONG");
    }
    return {
      name: attribute.name,
      localName: attribute.local,
      prefix: attribute.prefix,
      namespaceUri: attribute.uri,
      value: attribute.value,
    };
  });
}

function rawElement(
  parser: SaxesParser<{ xmlns: true }>,
  tag: SaxesTagNS,
  limits: YrlParserLimits,
): YrlRawElement {
  return {
    name: tag.name,
    localName: tag.local,
    prefix: tag.prefix,
    namespaceUri: tag.uri,
    attributes: rawAttributes(parser, tag, limits),
    text: "",
    children: [],
  };
}

function safeWrite(parser: SaxesParser<{ xmlns: true }>, chunk: string): void {
  try {
    parser.write(chunk);
  } catch (error) {
    if (error instanceof YrlParserError) throw error;
    fail(parser, "YRL_XML_MALFORMED", { cause: error });
  }
}

export async function* parseYrl2010(
  input: YrlInput,
  options: YrlParserOptions = {},
): AsyncGenerator<YrlRawOffer, void, undefined> {
  const limits: YrlParserLimits = { ...DEFAULT_YRL_PARSER_LIMITS, ...options.limits };
  const parser = new SaxesParser({ xmlns: true, position: true, fileName: "yrl-feed.xml" });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const encoder = new TextEncoder();
  const completedOffers: YrlRawOffer[] = [];
  let byteCount = 0;
  let depth = 0;
  let rootSeen = false;
  let offerDepth = 0;
  let offerLine = 0;
  let offerColumn = 0;
  let offerElementCount = 0;
  let offerCharacterCount = 0;
  let offerStack: YrlRawElement[] | null = null;
  let offerCount = 0;

  parser.on("doctype", () => fail(parser, "YRL_DTD_FORBIDDEN"));
  parser.on("error", (error) => fail(parser, "YRL_XML_MALFORMED", { cause: error }));
  parser.on("opentag", (tag) => {
    depth += 1;
    if (depth > limits.maxDepth) fail(parser, "YRL_DEPTH_LIMIT_EXCEEDED");

    if (!rootSeen) {
      rootSeen = true;
      if (tag.local !== "realty-feed") fail(parser, "YRL_ROOT_INVALID");
      if (options.expectedNamespace !== undefined && tag.uri !== options.expectedNamespace) {
        fail(parser, "YRL_NAMESPACE_MISMATCH");
      }
    }

    if (offerStack) {
      offerElementCount += 1;
      if (offerElementCount > limits.maxElementsPerOffer) fail(parser, "YRL_OFFER_TOO_COMPLEX");
      const element = rawElement(parser, tag, limits);
      offerStack.at(-1)!.children.push(element);
      offerStack.push(element);
      return;
    }

    if (tag.local === "offer") {
      offerCount += 1;
      if (offerCount > limits.maxOffers) fail(parser, "YRL_OFFER_LIMIT_EXCEEDED");
      offerDepth = depth;
      offerLine = parser.line;
      offerColumn = parser.column;
      offerElementCount = 1;
      offerCharacterCount = 0;
      offerStack = [rawElement(parser, tag, limits)];
    }
  });

  const appendText = (value: string) => {
    if (!offerStack || value.length === 0) return;
    const current = offerStack.at(-1)!;
    if (current.text.length + value.length > limits.maxFieldCharacters) {
      fail(parser, "YRL_FIELD_TOO_LONG");
    }
    offerCharacterCount += value.length;
    if (offerCharacterCount > limits.maxOfferCharacters) fail(parser, "YRL_OFFER_TOO_COMPLEX");
    current.text += value;
  };
  parser.on("text", appendText);
  parser.on("cdata", appendText);

  parser.on("closetag", (tag) => {
    if (offerStack && depth >= offerDepth) {
      const closed = offerStack.pop();
      if (!closed || closed.localName !== tag.local || closed.namespaceUri !== tag.uri) {
        fail(parser, "YRL_XML_MALFORMED");
      }
      if (depth === offerDepth) {
        completedOffers.push({ line: offerLine, column: offerColumn, element: closed });
        offerStack = null;
      }
    }
    depth -= 1;
  });

  const drainOffers = function* () {
    while (completedOffers.length > 0) yield completedOffers.shift()!;
  };

  const writeDecoded = function* (decoded: string) {
    for (let offset = 0; offset < decoded.length; offset += PARSER_WRITE_CHARACTERS) {
      safeWrite(parser, decoded.slice(offset, offset + PARSER_WRITE_CHARACTERS));
      yield* drainOffers();
    }
  };

  try {
    for await (const rawChunk of input) {
      const chunk = typeof rawChunk === "string" ? encoder.encode(rawChunk) : rawChunk;
      byteCount += chunk.byteLength;
      if (byteCount > limits.maxArtifactBytes) fail(parser, "YRL_ARTIFACT_TOO_LARGE");
      const decoded = decoder.decode(chunk, { stream: true });
      yield* writeDecoded(decoded);
    }
    yield* writeDecoded(decoder.decode());
    try {
      parser.close();
    } catch (error) {
      if (error instanceof YrlParserError) throw error;
      fail(parser, "YRL_XML_MALFORMED", { cause: error });
    }
    yield* drainOffers();
    if (!rootSeen) fail(parser, "YRL_ROOT_INVALID");
  } catch (error) {
    if (error instanceof YrlParserError) throw error;
    if (error instanceof TypeError && error.message.toLowerCase().includes("encoded data")) {
      fail(parser, "YRL_UTF8_INVALID", { cause: error });
    }
    fail(parser, "YRL_XML_MALFORMED", { cause: error });
  }
}
