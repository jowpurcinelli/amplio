import { randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";

/** Hash a password with a random salt. Returns "saltHex:hashHex". */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

/** Verify a password against a stored "saltHex:hashHex", constant-time. */
export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const hash = Buffer.from(hashHex, "hex");
  const test = scryptSync(password, Buffer.from(saltHex, "hex"), hash.length);
  return hash.length === test.length && timingSafeEqual(hash, test);
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export interface TokenPayload {
  sub: string; // user id
  email: string;
  exp?: number;
}

/** Sign a compact HS256 token (JWT-shaped) with an HMAC secret. */
export function signToken(payload: TokenPayload, secret: string, ttlSeconds = 7 * 24 * 3600): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const claims = b64url(Buffer.from(JSON.stringify(body)));
  const sig = b64url(createHmac("sha256", secret).update(`${header}.${claims}`).digest());
  return `${header}.${claims}.${sig}`;
}

/** Verify a token's signature and expiry; returns the payload or null. */
export function verifyToken(token: string, secret: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, claims, sig] = parts as [string, string, string];
  const expected = b64url(createHmac("sha256", secret).update(`${header}.${claims}`).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(claims, "base64url").toString()) as TokenPayload;
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}
