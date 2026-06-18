import type { VercelRequest, VercelResponse } from "@vercel/node"
import crypto from "crypto"

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") return res.status(405).end()

  try {
    // ── Verify LemonSqueezy webhook signature ─────────────────────────────────
    const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET
    if (secret) {
      const signature = req.headers["x-signature"] as string
      const rawBody = JSON.stringify(req.body)
      const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex")
      if (signature !== expected) {
        return res.status(401).json({ error: "Invalid signature" })
      }
    }

    const event = req.headers["x-event-name"] as string
    const licenseKey = req.body?.data?.attributes?.first_order_item?.variant_name
      || req.body?.meta?.custom_data?.license_key
      || req.body?.data?.attributes?.identifier
      || ""

    console.log(`LemonSqueezy webhook: ${event}`, { licenseKey })

    // ── Handle subscription cancellation ─────────────────────────────────────
    if (
      event === "subscription_cancelled" ||
      event === "subscription_expired" ||
      event === "subscription_paused"
    ) {
      const host = req.headers.host || "localhost:3000"
      const protocol = host.includes("localhost") ? "http" : "https"

      await fetch(`${protocol}://${host}/api/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          deviceId: "webhook",
          licenseKey,
          action: "cancel",
        }),
      })

      console.log(`Subscription cancelled for license: ${licenseKey}`)
    }

    return res.status(200).json({ received: true })
  } catch (error: any) {
    console.error("Webhook error:", error)
    return res.status(500).json({ error: error.message })
  }
}
