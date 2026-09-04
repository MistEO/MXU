import { decryptSecret, encryptSecret } from '@/utils/secretCrypto';

const BASE_KEY = 'MXU-CDK';

function buildKey(projectName?: string): string {
  return projectName ? `${BASE_KEY}-${projectName}` : BASE_KEY;
}

export function encryptCdk(plaintext: string, projectName?: string): string {
  return encryptSecret(plaintext, buildKey(projectName));
}

export function decryptCdk(encrypted: string, projectName?: string): string {
  return decryptSecret(encrypted, buildKey(projectName));
}
