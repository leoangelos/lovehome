// ==========================================
// Redis Message Buffer — debounce logic
// ==========================================

import { redis } from '@/lib/redis/client'

const BUFFER_PREFIX = 'msgbuf:'
const DEBOUNCE_TTL = 5 // seconds
const PROCESSING_PREFIX = 'processing:'

/**
 * Push a message to the user's buffer in Redis
 */
export async function pushToBuffer(phoneKey: string, message: string): Promise<void> {
  const key = `${BUFFER_PREFIX}${phoneKey}`
  
  // Push to list and set TTL
  await redis.rpush(key, message)
  await redis.expire(key, DEBOUNCE_TTL + 60) // Extra 60s buffer for processing
}

/**
 * Get all buffered messages for a user
 */
export async function getBuffer(phoneKey: string): Promise<string[]> {
  const key = `${BUFFER_PREFIX}${phoneKey}`
  const messages = await redis.lrange(key, 0, -1)
  return messages as string[]
}

/**
 * Clear the buffer for a user
 */
export async function clearBuffer(phoneKey: string): Promise<void> {
  const key = `${BUFFER_PREFIX}${phoneKey}`
  await redis.del(key)
}

/**
 * Set a debounce timer for a phone key.
 * Returns true if this is the first message or if the timer was extended.
 */
export async function setDebounceTimer(phoneKey: string): Promise<string> {
  const timerKey = `${BUFFER_PREFIX}timer:${phoneKey}`
  const timerId = crypto.randomUUID()
  
  // Set the timer ID with TTL = debounce window
  await redis.set(timerKey, timerId, { ex: DEBOUNCE_TTL })
  
  return timerId
}

/**
 * Check if this timer ID is still the latest (meaning debounce expired and no new msgs came)
 */
export async function isLatestTimer(phoneKey: string, timerId: string): Promise<boolean> {
  const timerKey = `${BUFFER_PREFIX}timer:${phoneKey}`
  const currentTimerId = await redis.get(timerKey)
  return currentTimerId === timerId
}

/**
 * Set processing lock to prevent duplicate processing
 */
export async function setProcessingLock(phoneKey: string): Promise<boolean> {
  const key = `${PROCESSING_PREFIX}${phoneKey}`
  // SETNX with TTL for idempotency
  const result = await redis.set(key, '1', { ex: 120, nx: true })
  return result === 'OK'
}

/**
 * Release processing lock
 */
export async function releaseProcessingLock(phoneKey: string): Promise<void> {
  const key = `${PROCESSING_PREFIX}${phoneKey}`
  await redis.del(key)
}
