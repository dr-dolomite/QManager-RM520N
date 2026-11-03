// lib/config-backup/crypto.ts
//
// AES-256-GCM + PBKDF2-SHA256 for .qmbackup files, WebCrypto only. `crypto.subtle`
// exists only in a secure context, so its absence is reported, never read as a wrong passphrase.

const PBKDF2_ITER = 200_000;
const KEY_BITS = 256;

export const CRYPTO_PARAMS = {
  KDF_ITER: PBKDF2_ITER,
  SALT_LEN: 16,
  IV_LEN: 12,
  KEY_BITS,
} as const;

/** A coded failure; `code` resolves through the `errors` namespace. */
export class BackupError extends Error {
  readonly code: string;
  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "BackupError";
    this.code = code;
  }
}

/** The GCM tag did not verify: a wrong passphrase or a tampered file. */
export class DecryptAuthError extends BackupError {
  constructor() {
    super("decrypt_failed");
    this.name = "DecryptAuthError";
  }
}

export function hasWebCrypto(): boolean {
  return typeof globalThis.crypto?.subtle?.importKey === "function";
}

function subtle(): SubtleCrypto {
  if (!hasWebCrypto()) throw new BackupError("insecure_context");
  return globalThis.crypto.subtle;
}

function toFixedBuffer(u: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength),
  ) as Uint8Array<ArrayBuffer>;
}

export function randomBytes(len: number): Uint8Array<ArrayBuffer> {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return buf;
}

export function base64Encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export function base64Decode(b64: string): Uint8Array<ArrayBuffer> {
  let s: string;
  try {
    s = atob(b64);
  } catch {
    throw new BackupError("invalid_envelope", "bad base64");
  }
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Derive a non-extractable AES-256-GCM key from a passphrase and salt. */
export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iter: number = PBKDF2_ITER,
): Promise<CryptoKey> {
  const s = subtle();
  const passKey = await s.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return s.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", iterations: iter, salt: toFixedBuffer(salt) },
    passKey,
    { name: "AES-GCM", length: KEY_BITS },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt; the 16-byte GCM tag is appended to the ciphertext. */
export async function encryptPayload(
  key: CryptoKey,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv: toFixedBuffer(iv), additionalData: toFixedBuffer(aad), tagLength: 128 },
    key,
    toFixedBuffer(plaintext),
  );
  return new Uint8Array(ct);
}

/** Decrypt; throws `DecryptAuthError` only when the tag does not verify. */
export async function decryptPayload(
  key: CryptoKey,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array<ArrayBuffer>> {
  const s = subtle();
  try {
    const pt = await s.decrypt(
      { name: "AES-GCM", iv: toFixedBuffer(iv), additionalData: toFixedBuffer(aad), tagLength: 128 },
      key,
      toFixedBuffer(ciphertext),
    );
    return new Uint8Array(pt);
  } catch {
    throw new DecryptAuthError();
  }
}
