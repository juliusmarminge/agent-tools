import { gcmsiv } from "@noble/ciphers/aes";
import * as crypto from "node:crypto";

/**
 * Generate a random 32-byte instance secret.
 * @returns Hex-encoded 64-character string
 */
export function generateInstanceSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

/**
 * KBKDF-CTR-HMAC-SHA256 key derivation (NIST SP 800-108r1).
 * Simplified variant matching aws-lc-rs (no separator or length fields).
 */
function kbkdfCtrHmac(secret: Buffer, info: string, outputLen: number): Buffer {
  const iterations = Math.ceil(outputLen / 32);
  const chunks: Buffer[] = [];

  for (let i = 1; i <= iterations; i++) {
    const counterBuf = Buffer.alloc(4);
    counterBuf.writeUInt32BE(i, 0);

    const hmac = crypto.createHmac("sha256", secret);
    hmac.update(counterBuf);
    hmac.update(info);
    chunks.push(hmac.digest());
  }

  return Buffer.concat(chunks).subarray(0, outputLen);
}

/**
 * Encode a varint (protobuf wire format).
 */
function encodeVarint(value: number | bigint): Buffer {
  const bytes: number[] = [];
  let v = typeof value === "bigint" ? value : BigInt(value);

  while (v > 0x7fn) {
    bytes.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  bytes.push(Number(v));

  return Buffer.from(bytes);
}

/**
 * Encode a protobuf field tag.
 */
function encodeTag(fieldNumber: number, wireType: number): Buffer {
  return encodeVarint((fieldNumber << 3) | wireType);
}

const WIRE_TYPE_VARINT = 0;

/**
 * Encode the AdminKeyProto message.
 *
 * Fields:
 * - 2: issued_s (uint64, varint) - timestamp in seconds
 * - 3: member_id (uint64, varint) - identity oneof member
 * - 5: is_read_only (bool, varint) - only if true
 */
function encodeAdminKeyProto(issuedS: bigint, memberId: bigint, isReadOnly: boolean): Buffer {
  const parts: Buffer[] = [];

  // Field 2: issued_s (uint64)
  parts.push(encodeTag(2, WIRE_TYPE_VARINT));
  parts.push(encodeVarint(issuedS));

  // Field 3: member_id (uint64) - identity oneof
  parts.push(encodeTag(3, WIRE_TYPE_VARINT));
  parts.push(encodeVarint(memberId));

  // Field 5: is_read_only (bool) - only encoded if true
  if (isReadOnly) {
    parts.push(encodeTag(5, WIRE_TYPE_VARINT));
    parts.push(encodeVarint(1));
  }

  return Buffer.concat(parts);
}

const ADMIN_KEY_VERSION = 1;
const ADMIN_KEY_PURPOSE = "admin key";

/**
 * Generate a Convex admin key.
 *
 * @param instanceSecret - 64-character hex string (32 bytes)
 * @param instanceName - Instance name for the backend
 * @param memberId - Member ID (default 0 for generic keys)
 * @param isReadOnly - Whether the key is read-only (default false)
 * @returns Admin key in format "instance_name|encrypted_part"
 */
export function generateAdminKey(
  instanceSecret: string,
  instanceName: string,
  memberId = 0n,
  isReadOnly = false,
): string {
  const secret = Buffer.from(instanceSecret, "hex");

  if (secret.length !== 32) {
    throw new Error(`Instance secret must be 32 bytes (64 hex chars), got ${secret.length} bytes`);
  }

  // Derive 16-byte AES key using KBKDF
  const aesKey = kbkdfCtrHmac(secret, ADMIN_KEY_PURPOSE, 16);

  // Generate 12-byte random nonce
  const nonce = crypto.randomBytes(12);

  // Create proto payload
  const issuedS = BigInt(Math.floor(Date.now() / 1000));
  const plaintext = encodeAdminKeyProto(issuedS, memberId, isReadOnly);

  // AAD is just the version byte
  const aad = Buffer.from([ADMIN_KEY_VERSION]);

  // Encrypt with AES-128-GCM-SIV
  const cipher = gcmsiv(aesKey, nonce, aad);
  const ciphertext = cipher.encrypt(plaintext);

  // Build output: version || nonce || ciphertext (includes 16-byte tag)
  const encrypted = Buffer.concat([
    Buffer.from([ADMIN_KEY_VERSION]),
    nonce,
    Buffer.from(ciphertext),
  ]);

  return `${instanceName}|${encrypted.toString("hex")}`;
}

/**
 * Generate a matching instance secret and admin key pair.
 *
 * @param instanceName - Instance name for the backend
 * @returns Object with instanceSecret and adminKey
 */
export function generateKeyPair(instanceName: string): {
  instanceSecret: string;
  adminKey: string;
} {
  const instanceSecret = generateInstanceSecret();
  const adminKey = generateAdminKey(instanceSecret, instanceName);

  return { instanceSecret, adminKey };
}
