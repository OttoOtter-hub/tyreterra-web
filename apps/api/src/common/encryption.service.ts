import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

const ALGORITHM = 'aes-256-gcm';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor() {
    // A silently-used fallback key would encrypt real prices/contacts with a known
    // secret and make existing data unreadable — so outside dev/test the key is required.
    const devOrTest = ['development', 'test'].includes(process.env.NODE_ENV ?? '');
    const secret = process.env.ENCRYPTION_KEY || (devOrTest ? 'default-dev-key-change-in-production' : '');
    if (!secret) {
      throw new Error('ENCRYPTION_KEY is not set — refusing to start (required unless NODE_ENV is development or test)');
    }
    // Derive a 32-byte key from the secret using scrypt
    this.key = scryptSync(secret, 'tyreterra-salt', 32);
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Stored format: <iv-hex>:<tag-hex>:<ciphertext-hex>
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  decrypt(ciphertext: string): string {
    const [ivHex, tagHex, encHex] = ciphertext.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const enc = Buffer.from(encHex, 'hex');
    const decipher = createDecipheriv(ALGORITHM, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
