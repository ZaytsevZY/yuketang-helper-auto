import { safeStorage } from 'electron';
import type { SecretCodec } from '@ykt/storage';

export class ElectronSafeStorageCodec implements SecretCodec {
  encrypt(value: string): Uint8Array {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('System credential encryption is unavailable.');
    }
    return safeStorage.encryptString(value);
  }

  decrypt(value: Uint8Array): string {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('System credential encryption is unavailable.');
    }
    return safeStorage.decryptString(Buffer.from(value));
  }
}
