import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function sealer(base64Key: string) {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) throw new Error("SESSION_KEY must be 32 bytes, base64");

  return {
    seal(value: unknown): string {
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
    },
    open<T>(sealed: string | undefined): T | undefined {
      if (!sealed) return undefined;
      try {
        const raw = Buffer.from(sealed, "base64url");
        const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
        decipher.setAuthTag(raw.subarray(12, 28));
        return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8"));
      } catch {
        return undefined;
      }
    },
  };
}
