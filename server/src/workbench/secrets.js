/**
 * AES-256-GCM encryption for credentials kept in Settings (bearer token,
 * password, API key). The key comes from SETTINGS_SECRET_KEY; without it a
 * random key is created once in server/.data/settings.key (keep that file out
 * of version control and backups you share).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from '../logger.js';

const KEY_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.data/settings.key');
let cachedKey = null;

function loadKey() {
  if (cachedKey) return cachedKey;
  const fromEnv = process.env.SETTINGS_SECRET_KEY;
  if (fromEnv) {
    cachedKey = crypto.scryptSync(fromEnv, 'ppi-api-workbench/settings', 32);
    return cachedKey;
  }
  try {
    cachedKey = Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
    if (cachedKey.length === 32) return cachedKey;
  } catch {
    /* create below */
  }
  cachedKey = crypto.randomBytes(32);
  fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
  fs.writeFileSync(KEY_FILE, cachedKey.toString('base64'), { mode: 0o600 });
  logger.warn(`SETTINGS_SECRET_KEY is not set. Created ${KEY_FILE} to encrypt stored credentials.`);
  return cachedKey;
}

export function encryptSecret(plain) {
  if (plain === null || plain === undefined || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', loadKey(), iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export function decryptSecret(stored) {
  if (!stored) return '';
  try {
    const [version, iv, tag, data] = stored.split(':');
    if (version !== 'v1') return '';
    const decipher = crypto.createDecipheriv('aes-256-gcm', loadKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    logger.warn('A stored credential could not be decrypted (was the encryption key changed?). Re-enter it in Settings.');
    return '';
  }
}
