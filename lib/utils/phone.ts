// ==========================================
// Phone normalization for Brazilian numbers
// ==========================================
//
// Problem: Brazilian mobile numbers migrated from 8 to 9 digits,
// but WhatsApp may store either format:
//   5511999999999 (13 digits — with 9th digit)
//   551199999999  (12 digits — without 9th digit)
//
// Both represent the same person. We normalize by extracting the
// last 8 digits of the local number, which is the stable part
// that never changed during the migration.
//
// Structure of a BR number: +55 (country) + DD (2-digit area) + NUMBER (8 or 9 digits)
// The 9th digit (always "9") was prepended to the original 8-digit number.

/**
 * Extracts the last 8 digits from a phone number.
 * This is the canonical "phone key" used for matching.
 *
 * Examples:
 *   "5511999999999"  → "99999999"
 *   "551199999999"   → "99999999"
 *   "+55 (11) 99999-9999" → "99999999"
 */
export function extractPhoneKey(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-8)
}

/**
 * Checks if two phone numbers refer to the same person.
 * Handles the 8-vs-9 digit Brazilian mobile number issue.
 */
export function phonesMatch(a: string, b: string): boolean {
  return extractPhoneKey(a) === extractPhoneKey(b)
}

/**
 * Normalizes a phone for display: digits only, no formatting.
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, '')
}

/**
 * Assume BR country code when a user types a raw DDD+number without "55".
 * - "11987654321" (11 digits) → "5511987654321"
 * - "1133334444"  (10 digits) → "551133334444"
 * - Leaves other inputs alone (already has 55, or not a BR-shaped length).
 *
 * This is a BR-first heuristic — a US "1xxxxxxxxxx" (11 digits) would also
 * be rewritten, but that's acceptable for this app (BR-only audience) and
 * won't match anything in wa_users anyway if the number is really US.
 */
export function ensureBrCountryCode(digits: string): string {
  const clean = digits.replace(/\D/g, '')
  if (clean.startsWith('55') && (clean.length === 12 || clean.length === 13)) return clean
  if (clean.length === 10 || clean.length === 11) return '55' + clean
  return clean
}

/**
 * Given a phone number, returns both the 8-digit and 9-digit
 * local variants for SQL matching. Useful for OR queries.
 *
 * Input: "5511999999999" or "551199999999"
 * Returns: { key8: "99999999", withNine: "5511999999999", withoutNine: "551199999999" }
 */
export function phoneVariants(phone: string): {
  key8: string
  withNine: string | null
  withoutNine: string | null
} {
  const digits = phone.replace(/\D/g, '')
  const key8 = digits.slice(-8)

  // Can only generate variants for BR numbers (start with 55, 12-13 digits)
  if (!digits.startsWith('55') || digits.length < 12 || digits.length > 13) {
    return { key8, withNine: null, withoutNine: null }
  }

  const countryCode = '55'
  const areaCode = digits.slice(2, 4) // e.g. "61"

  if (digits.length === 13) {
    // Has 9th digit: 55 + DD + 9XXXXXXXX (9 digits)
    const localNumber = digits.slice(4) // "999999999"
    return {
      key8,
      withNine: digits,
      withoutNine: countryCode + areaCode + localNumber.slice(1), // remove the leading 9
    }
  }

  if (digits.length === 12) {
    // Missing 9th digit: 55 + DD + XXXXXXXX (8 digits)
    const localNumber = digits.slice(4) // "99999999"
    return {
      key8,
      withNine: countryCode + areaCode + '9' + localNumber, // add leading 9
      withoutNine: digits,
    }
  }

  return { key8, withNine: null, withoutNine: null }
}
