import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 64 });

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function safeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

export async function hashPassword(password, salt = randomBytes(16)) {
  const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt, 'hex');
  const hash = await scryptAsync(password, saltBuffer, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return {
    passwordHash: hash.toString('hex'),
    salt: saltBuffer.toString('hex'),
    scrypt: { ...SCRYPT },
  };
}

export async function verifyPassword(password, user) {
  const params = user?.scrypt || SCRYPT;
  const salt = Buffer.from(String(user?.salt || ''), 'hex');
  if (!user?.passwordHash || salt.length === 0) return false;
  const hash = await scryptAsync(String(password), salt, params.keylen, {
    N: params.N,
    r: params.r,
    p: params.p,
  });
  return safeEqual(hash.toString('hex'), user.passwordHash);
}
