/**
 * sandboxAdapter.ts — browser-side stub.
 *
 * The SandboxFiatPaymentProvider class that used to live here has been
 * removed.  All HMAC signing is now performed exclusively on the server
 * (server/sandboxProvider.ts) so the FIAT_WEBHOOK_SECRET is never present
 * in the frontend bundle.
 *
 * This file is kept so existing imports do not break during the transition,
 * but it exports nothing that touches the signing secret.
 */

export {} // intentionally empty — signing is server-only
