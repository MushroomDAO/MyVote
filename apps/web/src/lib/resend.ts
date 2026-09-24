/**
 * Resend sender, modelled on PowerSalesMan's `cloudflare/src/resend.ts`.
 *
 * The outcome distinguishes a definite rejection from an in-flight failure: a
 * `fetch` that throws may still have reached Resend, so a blind retry can send
 * the same mail twice. Treat `delivered: 'rejected'` as the retryable case.
 */
export type SendOutcome =
  | { ok: true; id: string | null }
  | { ok: false; error: string; delivered: 'rejected' | 'unknown' }

export type SendEmailInput = {
  apiKey: string
  from: string
  to: string
  subject: string
  text: string
  html?: string
  replyTo?: string
}

export const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export async function sendViaResend(
  input: SendEmailInput,
  fetchImpl: typeof fetch = fetch
): Promise<SendOutcome> {
  let response: Response
  try {
    response = await fetchImpl(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        from: input.from,
        to: input.to,
        subject: input.subject,
        text: input.text,
        ...(input.html ? { html: input.html } : {}),
        ...(input.replyTo ? { reply_to: input.replyTo } : {})
      })
    })
  } catch {
    // The request may have been delivered before the connection broke.
    return { ok: false, error: 'send_unknown', delivered: 'unknown' }
  }

  if (!response.ok) {
    // An explicit error response means Resend did not accept the message.
    return { ok: false, error: `send_failed_${response.status}`, delivered: 'rejected' }
  }

  let id: string | null = null
  try {
    const body = (await response.json()) as { id?: string }
    id = typeof body?.id === 'string' ? body.id : null
  } catch {
    // The send was accepted; an unreadable body leaves the diagnostic id null
    // instead of turning a delivered message into a failure.
  }
  return { ok: true, id }
}
