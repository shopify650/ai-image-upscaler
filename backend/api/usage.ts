import type { VercelRequest, VercelResponse } from "@vercel/node"

const usageStore: Map<string, { count: number; date: string }> = new Map()
const FREE_DAILY_LIMIT = 5
const PRO_DAILY_LIMIT = 999999

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()

  const { user_id, tier, action } = req.body || req.query

  if (!user_id) {
    return res.status(400).json({ error: "user_id required" })
  }

  const today = new Date().toISOString().split("T")[0]
  const key = `${user_id}:${today}`
  const limit = tier === "pro" ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT

  if (req.method === "GET" || action === "check") {
    const usage = usageStore.get(key)
    const count = usage?.date === today ? usage.count : 0
    return res.status(200).json({ used: count, limit, remaining: Math.max(0, limit - count), canUpscale: count < limit })
  }

  if (req.method === "POST" && action === "increment") {
    const usage = usageStore.get(key)
    const currentCount = usage?.date === today ? usage.count : 0

    if (currentCount >= limit) {
      return res.status(429).json({
        error: "Daily limit reached",
        used: currentCount,
        limit,
        remaining: 0,
        canUpscale: false,
        upgradeMessage: tier === "free" ? "Upgrade to Pro for unlimited upscales!" : "You've reached your daily limit.",
      })
    }

    usageStore.set(key, { count: currentCount + 1, date: today })
    return res.status(200).json({ used: currentCount + 1, limit, remaining: Math.max(0, limit - currentCount - 1), canUpscale: currentCount + 1 < limit })
  }

  return res.status(400).json({ error: "Invalid action" })
}
