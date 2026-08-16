// ==========================================
// Web widget adapter — synchronous request/response.
// The widget POSTs a message and the agent reply comes back in the same
// HTTP response. Follow-ups delivered on next POST or via polling endpoint.
// ==========================================

import { createAdminClient } from '@/lib/supabase/admin'
import { redis } from '@/lib/redis/client'
import type { ChannelAdapter, IncomingMessage, OutgoingMessage } from './types'

const REPLY_TTL_SECONDS = 300 // 5 min

/**
 * "Sending" via widget means queueing the reply so the HTTP response
 * picks it up. Redis is used as the queue so follow-up cron messages
 * (async, outside the request scope) can also reach the widget.
 */
export const widgetAdapter: ChannelAdapter = {
  channel: 'widget',
  async send(msg: OutgoingMessage) {
    const payload = JSON.stringify({
      text: msg.text,
      displayName: msg.displayName || null,
      timestamp: new Date().toISOString(),
    })
    await redis.rpush(widgetQueueKey(msg.externalId), payload)
    await redis.expire(widgetQueueKey(msg.externalId), REPLY_TTL_SECONDS)
  },
}

export function widgetQueueKey(sessionToken: string) {
  return `widget:reply:${sessionToken}`
}

/**
 * Drain queued replies for a session (FIFO).
 * Called at the end of POST /api/widget/message and by GET /api/widget/poll.
 */
export async function drainWidgetReplies(sessionToken: string): Promise<Array<{
  text: string
  displayName: string | null
  timestamp: string
}>> {
  const key = widgetQueueKey(sessionToken)
  const raw = await redis.lrange<string>(key, 0, -1)
  if (!raw || raw.length === 0) return []
  await redis.del(key)
  return raw.map((r) => {
    try {
      return typeof r === 'string' ? JSON.parse(r) : r
    } catch {
      return { text: String(r), displayName: null, timestamp: new Date().toISOString() }
    }
  })
}

// ==========================================
// Session management
// ==========================================

export interface WidgetSession {
  id: string
  session_token: string
  contact_id: string | null
  site_id: string | null
  visitor_name: string | null
  visitor_email: string | null
  landing_url: string | null
  referrer_url: string | null
  current_url: string | null
}

/**
 * Resolve a session by token. Updates last_seen_at.
 * Returns null if the session doesn't exist.
 */
export async function getWidgetSession(token: string): Promise<WidgetSession | null> {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('widget_sessions')
    .select('id, session_token, contact_id, site_id, visitor_name, visitor_email, landing_url, referrer_url, current_url')
    .eq('session_token', token)
    .single()

  if (!data) return null

  // Touch last_seen (fire-and-forget)
  supabase
    .from('widget_sessions')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('session_token', token)
    .then(() => {})

  return data as WidgetSession
}

/**
 * Create a new widget session. Called on first message from widget.
 */
export async function createWidgetSession(params: {
  sessionToken: string
  siteId: string | null
  userAgent: string | null
  ipHash: string | null
  landingUrl?: string | null
  referrerUrl?: string | null
}): Promise<WidgetSession> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('widget_sessions')
    .insert({
      session_token: params.sessionToken,
      site_id: params.siteId,
      user_agent: params.userAgent,
      ip_hash: params.ipHash,
      landing_url: truncateUrl(params.landingUrl),
      referrer_url: truncateUrl(params.referrerUrl),
      current_url: truncateUrl(params.landingUrl),
    })
    .select('id, session_token, contact_id, site_id, visitor_name, visitor_email, landing_url, referrer_url, current_url')
    .single()

  if (error || !data) {
    throw new Error(`Failed to create widget session: ${error?.message}`)
  }
  return data as WidgetSession
}

/**
 * Update the page URL a session is currently on. Best-effort (we don't
 * throw if the update fails — keeping the request flow simple).
 */
export async function touchWidgetCurrentUrl(
  sessionToken: string,
  currentUrl: string | null,
): Promise<void> {
  if (!currentUrl) return
  const normalized = truncateUrl(currentUrl)
  if (!normalized) return
  const supabase = createAdminClient()
  await supabase
    .from('widget_sessions')
    .update({ current_url: normalized })
    .eq('session_token', sessionToken)
}

// URLs can be unbounded (embedded analytics params, etc.) — cap at 1KB to
// keep the row tidy and avoid blowing up logs or the admin UI.
function truncateUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const trimmed = String(raw).trim()
  if (!trimmed) return null
  return trimmed.length > 1024 ? trimmed.slice(0, 1024) : trimmed
}

/**
 * Build an IncomingMessage from a widget POST payload.
 */
export function buildWidgetIncoming(params: {
  sessionToken: string
  text: string
  messageId: string
}): IncomingMessage {
  return {
    channel: 'widget',
    externalId: params.sessionToken,
    messageId: params.messageId,
    messageType: 'text',
    content: params.text,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Verify that the request origin is allowed for a given site_id.
 * Returns the matched origin header if allowed, otherwise null.
 *
 * Admin input is forgiving: we normalize the stored value so common mistakes
 * (trailing slash, "/*" suffix, path segment, casing) don't lock people out.
 * Browsers only ever send `scheme://host[:port]` as Origin, so we compare
 * against that shape.
 */
export async function validateWidgetOrigin(
  siteId: string | null,
  origin: string | null
): Promise<string | null> {
  if (!siteId || !origin) return null
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('widget_sites')
    .select('origin')
    .eq('site_id', siteId)
    .eq('is_active', true)
    .single()

  if (!data) return null

  const stored = String(data.origin || '').trim()
  if (stored === '*') return origin

  const storedNorm = normalizeOriginInput(stored)
  const incomingNorm = normalizeOriginInput(origin)
  if (storedNorm && storedNorm === incomingNorm) return origin
  return null
}

/**
 * Reduce a user-typed origin (or a real Origin header) to `scheme://host[:port]`
 * — lowercase, no path, no trailing slash, no "/*" suffix.
 */
function normalizeOriginInput(value: string): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return ''
  try {
    // Works for full URLs and for `scheme://host/path/*` admin inputs alike.
    const url = new URL(raw.replace(/\/\*$/, ''))
    return `${url.protocol}//${url.host}`
  } catch {
    // Fallback: strip trailing `/*`, then trailing `/`
    return raw.replace(/\/\*$/, '').replace(/\/+$/, '')
  }
}
