/** XOR + Base64 混淆存储（防配置文件随手窥视，非强加密）。 */

function xorTransform(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ key[i % key.length];
  }
  return out;
}

export function encryptSecret(plaintext: string, keyMaterial: string): string {
  if (!plaintext) return '';
  const key = new TextEncoder().encode(keyMaterial);
  const bytes = new TextEncoder().encode(plaintext);
  const xored = xorTransform(bytes, key);
  return btoa(String.fromCharCode(...xored));
}

export function decryptSecret(encrypted: string, keyMaterial: string): string {
  if (!encrypted) return '';
  try {
    const key = new TextEncoder().encode(keyMaterial);
    const binary = atob(encrypted);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const decoded = xorTransform(bytes, key);
    return new TextDecoder().decode(decoded);
  } catch {
    return '';
  }
}

export function buildInputSecretKey(
  projectName: string | undefined,
  optionKey: string,
  inputName: string,
): string {
  const base = projectName ? `MXU-INPUT-${projectName}` : 'MXU-INPUT';
  return `${base}-${optionKey}-${inputName}`;
}
