import type { VercelRequest, VercelResponse } from "@vercel/node"

const dailyStore: Map<string, { count: number; date: string }> = new Map()
const tokenStore: Map<string, number> = new Map()
const FREE_DAILY_LIMIT = 5
const PRO_TOKEN_LIMIT = 100

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()

  const { user_id, tier, license_key, action } = req.body || req.query

  if (!user_id) {
    return res.status(400).json({ error: "user_id required" })
  }

  // Pro uses token-based tracking by license key
  if (tier === "pro") {
    const key = `pro_tokens:${license_key || user_id}`

    if (!tokenStore.has(key)) {
      tokenStore.set(key, PRO_TOKEN_LIMIT)
    }

    if (req.method === "GET" || action === "check") {
      const remaining = tokenStore.get(key)!
      return res.status(200).json({
        used: PRO_TOKEN_LIMIT - remaining,
        limit: PRO_TOKEN_LIMIT,
        remaining,
        canUpscale: remaining > 0,
      })
    }

    if (req.method === "POST" && action === "increment") {
      const current = tokenStore.get(key)!

      if (current <= 0) {
        return res.status(429).json({
          error: "All tokens used. Purchase more tokens to continue.",
          used: PRO_TOKEN_LIMIT,
          limit: PRO_TOKEN_LIMIT,
          remaining: 0,
          canUpscale: false,
        })
      }

      tokenStore.set(key, current - 1)
      return res.status(200).json({
        used: PRO_TOKEN_LIMIT - (current - 1),
        limit: PRO_TOKEN_LIMIT,
        remaining: current - 1,
        canUpscale: current - 1 > 0,
      })
    }
  }

  // Free uses daily tracking
  if (tier === "free" || !tier) {
    const today = new Date().toISOString().split("T")[0]
    const key = `${user_id}:${today}`

    if (req.method === "GET" || action === "check") {
      const usage = dailyStore.get(key)
      const count = usage?.date === today ? usage.count : 0
      return res.status(200).json({
        used: count,
        limit: FREE_DAILY_LIMIT,
        remaining: Math.max(0, FREE_DAILY_LIMIT - count),
        canUpscale: count < FREE_DAILY_LIMIT,
      })
    }

    if (req.method === "POST" && action === "increment") {
      const usage = dailyStore.get(key)
      const currentCount = usage?.date === today ? usage.count : 0

      if (currentCount >= FREE_DAILY_LIMIT) {
        return res.status(429).json({
          error: "Daily limit reached. Upgrade to Pro for 100 tokens.",
          used: currentCount,
          limit: FREE_DAILY_LIMIT,
          remaining: 0,
          canUpscale: false,
        })
      }

      dailyStore.set(key, { count: currentCount + 1, date: today })
      return res.status(200).json({
        used: currentCount + 1,
        limit: FREE_DAILY_LIMIT,
        remaining: Math.max(0, FREE_DAILY_LIMIT - currentCount - 1),
        canUpscale: currentCount + 1 < FREE_DAILY_LIMIT,
      })
    }
  }

  return res.status(400).json({ error: "Invalid action" })
}
