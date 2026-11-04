import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const hashSecret = (value: string) => createHash("sha256").update(value).digest("hex");

/** Versioned encryption envelope. A record's identity is authenticated along with its contents. */
export class RecordCipher {
  private readonly keys: Map<string, Buffer>;
  constructor(readonly currentKeyId: string, keys: Record<string, string>) {
    this.keys = new Map(Object.entries(keys).map(([id, value]) => {
      if (!/^[a-zA-Z0-9_-]{1,40}$/.test(id) || !/^[a-fA-F0-9]{64}$/.test(value)) throw new Error("Storage keys must be named 32-byte hexadecimal keys.");
      return [id, Buffer.from(value, "hex")];
    }));
    if (!this.keys.has(currentKeyId)) throw new Error("The current storage encryption key is missing.");
  }
  seal(value: unknown, identity: string): string {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.keys.get(this.currentKeyId)!, nonce);
    cipher.setAAD(Buffer.from(identity));
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
    return ["v1", this.currentKeyId, nonce.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  }
  open<T>(sealed: string, identity: string): T {
    const [version, keyId, nonce, tag, value, extra] = sealed.split(".");
    const key = keyId && this.keys.get(keyId);
    if (version !== "v1" || !key || !nonce || !tag || !value || extra !== undefined) throw new Error("Invalid encrypted record or unavailable key.");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonce, "base64url"));
    decipher.setAAD(Buffer.from(identity));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value, "base64url")), decipher.final()]).toString("utf8")) as T;
  }
}
