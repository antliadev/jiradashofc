/**
 * encryption.js - Criptografia AES-256-GCM para tokens do Jira
 */
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const SALT_LENGTH = 64;

/**
 * Deriva uma chave de 32 bytes a partir da chave de criptografia
 */
function deriveKey(encryptionKey) {
  return crypto.createHash('sha256').update(encryptionKey).digest();
}

function getEncryptionKey() {
  const key = process.env.JIRA_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('JIRA_ENCRYPTION_KEY não definida. Defina uma chave de pelo menos 32 caracteres.');
  }
  return key;
}

/**
 * Criptografa um texto simples
 */
export function encrypt(text) {
  const key = deriveKey(getEncryptionKey());
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const tag = cipher.getAuthTag();
  
  // Retorna IV:tag:encrypted em hex
  return iv.toString('hex') + ':' + tag.toString('hex') + ':' + encrypted;
}

/**
 * Descriptografa um texto criptografado
 */
export function decrypt(encryptedText) {
  const key = deriveKey(getEncryptionKey());
  
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Formato de token criptografado inválido');
  }
  
  const iv = Buffer.from(parts[0], 'hex');
  const tag = Buffer.from(parts[1], 'hex');
  const encrypted = parts[2];
  
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}