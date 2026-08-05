import { createHash, randomBytes } from 'node:crypto';

/** RFC 7636 PKCE helpers + state generation, all base64url-encoded. */

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** A high-entropy code_verifier (43–128 chars). */
export function generateCodeVerifier(): string {
  return base64url(randomBytes(32));
}

/** The S256 code_challenge derived from a verifier. */
export function codeChallengeS256(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/** An opaque CSRF/state value that also keys the stored verifier during the flow. */
export function randomState(): string {
  return base64url(randomBytes(16));
}