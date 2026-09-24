/**
 * POST /api/email-code  { email }
 *
 * Sends a 6-digit code that `/api/register` asks for when a mail service is
 * configured (M6-3). Storage keeps a salted hash plus a TTL.
 */

import {
  EMAIL_CODE_TTL_SECONDS,
  generateEmailCode,
  hashEmailCode,
  type EmailCodeRecord
} from '../../src/lib/emailCode'
import { isValidEmail } from '../../src/lib/email'
import { hitRateLimit } from '../../src/lib/rateLimit'
import { sendViaResend } from '../../src/lib/resend'

interface Env {
  TENANTS_KV: KVNamespace
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  /** Salt for the stored code hash, kept in server config. */
  EMAIL_CODE_SECRET?: string
}

/** Requests per IP and per address inside one window. */
const PER_IP_LIMIT = 10
const PER_EMAIL_LIMIT = 3
const WINDOW_SECONDS = 600

/** A Resend-verified sender on the account's own domain. */
const DEFAULT_FROM = 'hello@idoris.ai'

const CODE_KEY = (email: string) => `ec:${email}`

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: { email?: string }
  try {
    body = (await context.request.json()) as { email?: string }
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = body.email?.trim().toLowerCase() ?? ''
  if (!email) return Response.json({ error: 'email is required' }, { status: 400 })
  if (!isValidEmail(email)) return Response.json({ error: 'email is invalid' }, { status: 400 })

  const ip = context.request.headers.get('CF-Connecting-IP') ?? 'unknown'
  const ipRate = await hitRateLimit(context.env.TENANTS_KV, `rl:email-code:${ip}`, PER_IP_LIMIT, WINDOW_SECONDS)
  if (ipRate.limited) {
    return Response.json({ error: 'Too many code requests, try again later' }, { status: 429 })
  }
  const emailRate = await hitRateLimit(
    context.env.TENANTS_KV,
    `rl:email-code:${email}`,
    PER_EMAIL_LIMIT,
    WINDOW_SECONDS
  )
  if (emailRate.limited) {
    return Response.json({ error: 'Too many code requests for this address' }, { status: 429 })
  }

  const apiKey = context.env.RESEND_API_KEY
  if (!apiKey) {
    // No mail service on this deployment: say so instead of faking a send the
    // registrant does not receive.
    return Response.json({ error: 'email_verification_unavailable' }, { status: 503 })
  }

  const code = generateEmailCode()
  const record: EmailCodeRecord = {
    hash: await hashEmailCode(email, code, context.env.EMAIL_CODE_SECRET ?? ''),
    expiresAt: Math.floor(Date.now() / 1000) + EMAIL_CODE_TTL_SECONDS,
    attempts: 0
  }
  const minutes = Math.round(EMAIL_CODE_TTL_SECONDS / 60)

  const outcome = await sendViaResend({
    apiKey,
    from: context.env.EMAIL_FROM ?? DEFAULT_FROM,
    to: email,
    subject: 'MyVote 社区注册验证码',
    text: `你的验证码是 ${code}，${minutes} 分钟内有效。如果不是你本人操作，请忽略本邮件。`,
    html: `<p>你的验证码是 <b>${code}</b>，${minutes} 分钟内有效。</p><p>如果不是你本人操作，请忽略本邮件。</p>`
  })

  if (!outcome.ok && outcome.delivered === 'rejected') {
    // Resend refused it, so no code can arrive; leave nothing to verify against.
    return Response.json({ error: 'email_send_failed' }, { status: 502 })
  }

  // Success, or `unknown`: the message may have gone out, so keep the code and
  // tell the caller not to retry blindly.
  await context.env.TENANTS_KV.put(CODE_KEY(email), JSON.stringify(record), {
    expirationTtl: EMAIL_CODE_TTL_SECONDS
  })
  if (!outcome.ok) return Response.json({ error: 'email_send_unknown' }, { status: 202 })
  return Response.json({ ok: true })
}
