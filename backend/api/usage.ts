import type { VercelRequest, VercelResponse } from "@vercel/node"
import { kv } from "@vercel/kv"

const FREE_TRIAL_LIMIT = 5

// ─── User record shape ─────────────────────────────────────────────────────────
interface UserRecord {
  freeUsed: number        // how many free upscales used (never decrements)
  hasPurchased: boolean   // ever purchased? if true, no new free trial on cancel
  activeSub: boolean      // is subscription currently active?
  licenseKey?: string     // the license key tied to this device
}

async function getUser(deviceId: string): Promise<UserRecord> {
  const record = await kv.get<UserRecord>(`user:${deviceId}`)
  return record ?? { freeUsed: 0, hasPurchased: false, activeSub: false }
}

async function saveUser(deviceId: string, data: UserRecord): Promise<void> {
  await kv.set(`user:${deviceId}`, data)
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()

  try {
    const { deviceId, action, licenseKey } = req.body || {}

    if (!deviceId) {
      return res.status(400).json({ error: "deviceId is required" })
    }

    const user = await getUser(deviceId)

    // ── ACTION: check — returns current status ─────────────────────────────────
    if (action === "check") {
      if (user.activeSub) {
        return res.status(200).json({
          canUpscale: true,
          tier: "pro",
          freeUsed: user.freeUsed,
          hasPurchased: user.hasPurchased,
        })
      }

      // Canceled subscriber or trial exhausted — no new free trial
      if (user.hasPurchased && !user.activeSub) {
        return res.status(200).json({
          canUpscale: false,
          tier: "expired",
          reason: "subscription_cancelled",
          freeUsed: user.freeUsed,
          hasPurchased: true,
        })
      }

      // Free trial check
      const remaining = Math.max(0, FREE_TRIAL_LIMIT - user.freeUsed)
      return res.status(200).json({
        canUpscale: remaining > 0,
        tier: "free",
        freeUsed: user.freeUsed,
        freeRemaining: remaining,
        freeLimit: FREE_TRIAL_LIMIT,
        hasPurchased: false,
      })
    }

    // ── ACTION: increment — called after a successful upscale ──────────────────
    if (action === "increment") {
      if (!user.activeSub) {
        // Only increment free counter if they are not a paid subscriber
        user.freeUsed = user.freeUsed + 1
      }
      await saveUser(deviceId, user)
      return res.status(200).json({ success: true, freeUsed: user.freeUsed })
    }

    // ── ACTION: activate — called when a license key is verified ───────────────
    if (action === "activate") {
      if (!licenseKey) return res.status(400).json({ error: "licenseKey required" })
      user.activeSub = true
      user.hasPurchased = true
      user.licenseKey = licenseKey
      await saveUser(deviceId, user)
      // Also create a reverse lookup: licenseKey → deviceId (for webhooks)
      await kv.set(`license:${licenseKey}`, deviceId)
      return res.status(200).json({ success: true })
    }

    // ── ACTION: cancel — called by LemonSqueezy webhook ───────────────────────
    if (action === "cancel") {
      if (!licenseKey) return res.status(400).json({ error: "licenseKey required" })
      // Look up deviceId from license key
      const targetDeviceId = (await kv.get<string>(`license:${licenseKey}`)) || deviceId
      const targetUser = await getUser(targetDeviceId)
      targetUser.activeSub = false
      // hasPurchased stays true FOREVER — prevents free trial abuse on re-subscribe attempts
      await saveUser(targetDeviceId, targetUser)
      return res.status(200).json({ success: true })
    }

    return res.status(400).json({ error: "Invalid action" })
  } catch (error: any) {
    console.error("Usage handler error:", error)
    return res.status(500).json({ error: error.message || "Internal server error" })
  }
}
