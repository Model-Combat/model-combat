import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import type { FlagMetadata } from "@model-combat/contracts";

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export function issueFlag(metadata: Omit<FlagMetadata, "nonce">, secret: string): string {
  const payload = { ...metadata, nonce: randomUUID() };
  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(encodedPayload).digest("base64url");

  return `MC1.${encodedPayload}.${signature}`;
}

export function verifyFlag(flag: string, secret: string): FlagMetadata | null {
  const [prefix, encodedPayload, signature] = flag.split(".");
  if (prefix !== "MC1" || !encodedPayload || !signature) {
    return null;
  }

  const expected = createHmac("sha256", secret).update(encodedPayload).digest();
  const actual = Buffer.from(signature, "base64url");

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  const parsed = JSON.parse(decodeBase64Url(encodedPayload)) as FlagMetadata;
  return parsed;
}
