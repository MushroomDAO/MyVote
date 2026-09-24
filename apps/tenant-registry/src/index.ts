/**
 * Registration uniqueness lock.
 *
 * KV has no compare-and-set, so two concurrent `/api/register` calls could both
 * pass the KV uniqueness check (see docs/registration-atomicity.md). Every claim
 * for a name runs through the same single-threaded object, so the read-then-write
 * in `/claim` cannot interleave with another claim for that name.
 *
 * The HTTP contract is mirrored by the Pages-side helper in
 * `apps/web/src/lib/tenantRegistry.ts` — keep the two in sync.
 */

type LockBody = { domain?: string; token?: string }

// Minimal local shapes for the two runtime values the object receives, so this
// file does not depend on a particular @cloudflare/workers-types version.
type DurableObjectStorage = {
  get<T>(key: string): Promise<T | undefined>
  put(key: string, value: string): Promise<void>
  delete(key: string): Promise<boolean>
}

type DurableObjectState = { storage: DurableObjectStorage }

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status })
}

export class TenantRegistry {
  private readonly storage: DurableObjectStorage

  constructor(state: DurableObjectState) {
    this.storage = state.storage
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/status') {
      const domain = url.searchParams.get('domain') ?? ''
      const token = await this.storage.get<string>(domain)
      return json({ token: token ?? null })
    }

    if (request.method !== 'POST') return json({ error: 'not found' }, 404)

    let body: LockBody
    try {
      body = (await request.json()) as LockBody
    } catch {
      return json({ error: 'invalid JSON body' }, 400)
    }

    const domain = body.domain?.trim() ?? ''
    const token = body.token?.trim() ?? ''
    if (!domain || !token) return json({ error: 'domain and token are required' }, 400)

    if (url.pathname === '/claim') {
      // No await between the read and the write: one name is one object, and the
      // object handles one request at a time, so a second claim cannot interleave.
      const held = await this.storage.get<string>(domain)
      if (held) return json({ ok: false, taken: true })
      await this.storage.put(domain, token)
      return json({ ok: true })
    }

    if (url.pathname === '/release') {
      const held = await this.storage.get<string>(domain)
      if (held === token) await this.storage.delete(domain)
      return json({ ok: true })
    }

    return json({ error: 'not found' }, 404)
  }
}

export default {
  async fetch(): Promise<Response> {
    // Direct traffic is not a supported interface: the Worker exists to host the
    // Durable Object that Pages binds to.
    return new Response('myvote tenant registry', { status: 200 })
  }
}
