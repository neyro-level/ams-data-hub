import { z } from "zod";

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PUBLIC_URL_ID_ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";
const MAX_ULID_TIMESTAMP = 2 ** 48 - 1;

export const cuidSchema = z.string().regex(/^c[a-z0-9]{24}$/, "Expected a Prisma cuid identifier");
export const ulidSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/, "Expected an uppercase ULID");
export const publicUrlIdSchema = z.string().regex(
  /^[0-9a-hjkmnp-tv-z]{16}$/,
  "Expected a 16-character lowercase Crockford Base32 publicUrlId",
);

export type Cuid = z.infer<typeof cuidSchema>;
export type Ulid = z.infer<typeof ulidSchema>;
export type PublicUrlId = z.infer<typeof publicUrlIdSchema>;

function encodeBase32(value: bigint, length: number, alphabet: string): string {
  let encoded = "";
  let remaining = value;
  for (let index = 0; index < length; index += 1) {
    encoded = alphabet[Number(remaining & 31n)]! + encoded;
    remaining >>= 5n;
  }
  if (remaining !== 0n) throw new Error("Identifier value exceeds its encoded length");
  return encoded;
}

function randomBigInt(byteLength: number): bigint {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  return value;
}

export function createUlid(timestamp = Date.now()): Ulid {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > MAX_ULID_TIMESTAMP) {
    throw new Error("ULID timestamp is outside the 48-bit range");
  }
  const encoded = `${encodeBase32(BigInt(timestamp), 10, ULID_ALPHABET)}${encodeBase32(randomBigInt(10), 16, ULID_ALPHABET)}`;
  return ulidSchema.parse(encoded);
}

export function createPublicUrlId(): PublicUrlId {
  return publicUrlIdSchema.parse(encodeBase32(randomBigInt(10), 16, PUBLIC_URL_ID_ALPHABET));
}
