import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

const localKey = randomBytes(32);
const lifetimeMs = 24 * 60 * 60 * 1000;
const maxTokenLength = 900000;
const maxSnapshotBytes = 4 * 1024 * 1024;

function sessionKey() {
  const configured = process.env.PLAN_SESSION_SECRET?.trim();
  if (/^[0-9a-f]{64}$/i.test(configured ?? '')) return Buffer.from(configured, 'hex');
  if (configured || process.env.VERCEL === '1' || process.env.NODE_ENV === 'production') return null;
  return localKey;
}

export const planSessionsReady = () => sessionKey() !== null;

export function rememberPlan(plan) {
  const key = sessionKey();
  if (!key) throw new Error('Plan sessions are not configured');
  const snapshot = JSON.stringify({ expires: Date.now() + lifetimeMs, plan });
  if (Buffer.byteLength(snapshot) > maxSnapshotBytes) throw new Error('Plan snapshot exceeds the size limit');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(gzipSync(snapshot)), cipher.final()]);
  const token = Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
  if (token.length > maxTokenLength) throw new Error('Plan token exceeds the size limit');
  return token;
}

export function findPlan(token) {
  const key = sessionKey();
  if (!key || typeof token !== 'string' || token.length > maxTokenLength || !/^[\w-]+$/.test(token)) return undefined;
  try {
    const bytes = Buffer.from(token, 'base64url');
    if (bytes.length <= 28 || bytes.toString('base64url') !== token) return undefined;
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAuthTag(bytes.subarray(12, 28));
    const decrypted = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]);
    const { expires, plan } = JSON.parse(gunzipSync(decrypted, { maxOutputLength: maxSnapshotBytes }).toString('utf8'));
    return expires > Date.now() ? plan : undefined;
  } catch {
    return undefined;
  }
}
