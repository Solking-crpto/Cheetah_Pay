/**
 * SandboxFiatProvider — SERVER-ONLY.
 *
 * Lives in server/ so it is never imported by the Vite frontend bundle.
 * The HMAC secret (FIAT_WEBHOOK_SECRET) is only ever read here, on the
 * server, and is never exposed to the browser.
 *
 * HARD CONSTRAINTS:
 *   1. isSandbox is always true.
 *   2. This module NEVER produces or embeds a blockchain tx hash.
 *      The settlement tx is created exclusively by submitSettlementTx().
 *   3. The HMAC is computed over a deterministic canonical string so the
 *      verifier can detect any field tampering.
 */

import type { FiatWebhookPayload, InitiateParams } from '../src/fiat/types'

/** Canonical string — field order is load-bearing. */
export function canonicalPayload(
  providerId: string,
  onchainPaymentId: string,
  amount: string,
  merchant: string,
  eventTimestamp: string,
): string {
  return [
    `providerId=${providerId}`,
    `onchainPaymentId=${onchainPaymentId}`,
    `amount=${amount}`,
    `merchant=${merchant}`,
    `eventTimestamp=${eventTimestamp}`,
    `isSandbox=true`,
  ].join('&')
}

/** HMAC-SHA256 — returns lowercase hex. Uses Web Crypto (available in Bun). */
async function hmacSha256(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Build a signed sandbox webhook payload entirely on the server.
 * The browser never touches this function or the signing secret.
 */
export async function buildSandboxWebhook(
  secret: string,
  params: InitiateParams,
): Promise<FiatWebhookPayload> {
  const providerId = `sandbox_${params.fiatPaymentId}`
  const eventTimestamp = new Date().toISOString()
  const canonical = canonicalPayload(
    providerId,
    params.onchainPaymentId,
    params.amount,
    params.merchant,
    eventTimestamp,
  )
  const signature = await hmacSha256(secret, canonical)
  return {
    providerId,
    onchainPaymentId: params.onchainPaymentId,
    amount: params.amount,
    merchant: params.merchant,
    isSandbox: true,
    eventTimestamp,
    signature,
  }
}

/** Verify a webhook HMAC on the server. */
export async function verifyHmac(
  secret: string,
  payload: FiatWebhookPayload,
): Promise<boolean> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
  )
  const sigBytes = new Uint8Array(
    payload.signature.match(/.{2}/g)!.map(h => parseInt(h, 16)),
  )
  const canonical = canonicalPayload(
    payload.providerId,
    payload.onchainPaymentId,
    payload.amount,
    payload.merchant,
    payload.eventTimestamp,
  )
  return crypto.subtle.verify('HMAC', key, sigBytes, enc.encode(canonical))
}
