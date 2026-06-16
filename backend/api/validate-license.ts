import type { VercelRequest, VercelResponse } from "@vercel/node"

const YOUR_STORE_ID = 12345
const YOUR_PRODUCT_ID = 67890
const YOUR_PRO_VARIANT_IDS = [111, 222]

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()

  const { license_key, instance_id } = req.body

  if (!license_key) {
    return res.status(400).json({ valid: false, tier: "free", error: "No license key provided" })
  }

  try {
    const formData = new URLSearchParams()
    formData.append("license_key", license_key)
    if (instance_id) formData.append("instance_id", instance_id)

    const response = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    })

    const data = await response.json()

    if (!data.valid) {
      return res.status(200).json({ valid: false, tier: "free", error: data.error || "Invalid license key" })
    }

    const meta = data.meta
    if (meta.store_id !== YOUR_STORE_ID || meta.product_id !== YOUR_PRODUCT_ID) {
      return res.status(200).json({ valid: false, tier: "free", error: "License key does not belong to this product" })
    }

    const isPro = YOUR_PRO_VARIANT_IDS.includes(meta.variant_id)
    const licenseKey = data.license_key
    const isActive = licenseKey.status === "active"
    const isExpired = licenseKey.expires_at ? new Date(licenseKey.expires_at) < new Date() : false

    if (!isActive || isExpired) {
      return res.status(200).json({
        valid: false,
        tier: "free",
        error: isExpired ? "License expired. Please renew your subscription." : "License is not active.",
      })
    }

    return res.status(200).json({
      valid: true,
      tier: isPro ? "pro" : "free",
      customer: { name: meta.customer_name, email: meta.customer_email },
      license: {
        id: licenseKey.id,
        status: licenseKey.status,
        expires_at: licenseKey.expires_at,
        activation_limit: licenseKey.activation_limit,
        activation_usage: licenseKey.activation_usage,
      },
      variant: meta.variant_name,
    })
  } catch (_) {
    return res.status(500).json({ valid: false, tier: "free", error: "Server error validating license" })
  }
}
