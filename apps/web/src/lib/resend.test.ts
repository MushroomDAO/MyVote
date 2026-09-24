import { describe, expect, it, vi } from 'vitest'

import { sendViaResend, type SendEmailInput } from './resend'

function input(overrides: Partial<SendEmailInput> = {}): SendEmailInput {
  return {
    apiKey: 'key-1',
    from: 'hello@idoris.ai',
    to: 'alice@example.com',
    subject: 'Hi',
    text: 'body',
    ...overrides
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('sendViaResend', () => {
  it('posts to Resend with bearer auth and returns the message id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'msg-1' }))
    await expect(sendViaResend(input(), fetchImpl as never)).resolves.toEqual({ ok: true, id: 'msg-1' })

    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string>; body: string }]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.authorization).toBe('Bearer key-1')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ from: 'hello@idoris.ai', to: 'alice@example.com', subject: 'Hi', text: 'body' })
    expect(body).not.toHaveProperty('reply_to')
  })

  it('includes html and reply_to only when given', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ id: 'm' }))
    await sendViaResend(input({ html: '<b>x</b>', replyTo: 'r@x.com' }), fetchImpl as never)
    const body = JSON.parse((fetchImpl.mock.calls[0] as [string, { body: string }])[1].body)
    expect(body.html).toBe('<b>x</b>')
    expect(body.reply_to).toBe('r@x.com')
  })

  it('marks an explicit error response as safely retryable', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ message: 'bad domain' }, 422))
    await expect(sendViaResend(input(), fetchImpl as never)).resolves.toEqual({
      ok: false,
      error: 'send_failed_422',
      delivered: 'rejected'
    })
  })

  it('marks a thrown request as unknown, not retryable', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('socket hang up'))
    await expect(sendViaResend(input(), fetchImpl as never)).resolves.toEqual({
      ok: false,
      error: 'send_unknown',
      delivered: 'unknown'
    })
  })

  it('tolerates a response without an id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({}))
    await expect(sendViaResend(input(), fetchImpl as never)).resolves.toEqual({ ok: true, id: null })
  })
})
