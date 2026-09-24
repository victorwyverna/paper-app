import { createHash, randomBytes } from 'node:crypto';

export function generateEditToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashEditToken(editToken: string): string {
  return createHash('sha256').update(editToken, 'utf8').digest('hex');
}
