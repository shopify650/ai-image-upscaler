import type { VercelRequest, VercelResponse } from "@vercel/node"

export const config = { maxDuration: 60 }

const PRO_MODEL_MAP: Record<string, string> = {
  "nano-banana-2": "google/gemini-flash-1.5",
  "nano-banana-pro": "google/gemini-pro-1.5",
  "riverflow": "anthropic/claude-3-5-sonnet",
}

const TOPAZ_MODEL_MAP: Record<string, string> = {
  general: "standard",
  photo: "standard",
  illustration: "art-illustration",
  text: "low-resolution",
}

// ─── HELPER: Poll Replicate until done ───────────────────────────────────────
async function pollReplicate(predictionId: string, token: string, maxSeconds = 55): Promise<any> {
  const pollUrl = `https://api.replicate.com/v1/predictions/${predictionId}`
  const maxAttempts = Math.floor(maxSeconds / 2)
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const res = await fetch(pollUrl, { headers: { Authorization: `Token ${token}` } })
    const result = await res.json()
    if (result.status === "succeeded") return result
    if (result.status === "failed") throw new Error(result.error || "Replicate prediction failed")
  }
  throw new Error(`Replicate timeout after ${maxSeconds}s`)
}

// ─── PRIMARY FREE ENGINE: nightmareai/real-esrgan (~$0.001/img) ──────────────
async function upscaleWithReplicate(
  res: VercelResponse,
  imageBase64: string,
  scale: number = 2,
  imageType: string = "general",
  faceEnhance: boolean = false
) {
  const KEY = process.env.REPLICATE_API_TOKEN
  if (!KEY) throw new Error("REPLICATE_API_TOKEN not configured")

  // Pass base64 directly as data URI — no blob upload needed
  const imageDataUri = `data:image/png;base64,${imageBase64}`

  const startRes = await fetch("https://api.replicate.com/v1/models/nightmareai/real-esrgan/predictions", {
    method: "POST",
    headers: { Authorization: `Token ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: {
        image: imageDataUri,
        scale: Math.min(scale, 4),
        face_enhance: faceEnhance,
      },
    }),
  })

  if (!startRes.ok) {
    const err = await startRes.json()
    throw new Error(`Replicate: ${JSON.stringify(err)}`)
  }

  const prediction = await startRes.json()
  const result = await pollReplicate(prediction.id, KEY)
  const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output

  return res.status(200).json({
    success: true,
    tier: "free",
    engine: "Real-ESRGAN (Replicate)",
    upscaledImageUrl: outputUrl,
  })
}


// ─── PRO REPLICATE ENGINE: topazlabs/image-upscale (professional grade) ──────
async function upscaleWithTopaz(
  res: VercelResponse,
  imageBase64: string,
  scale: number = 2,
  imageType: string = "general",
  enhanceMode: string = "general",
  faceEnhance: boolean = false
) {
  const KEY = process.env.REPLICATE_API_TOKEN
  if (!KEY) throw new Error("REPLICATE_API_TOKEN not configured")

  const topazModel = TOPAZ_MODEL_MAP[enhanceMode] || TOPAZ_MODEL_MAP[imageType] || "standard"
  const imageDataUri = `data:image/png;base64,${imageBase64}`

  const startRes = await fetch("https://api.replicate.com/v1/models/topazlabs/image-upscale/predictions", {
    method: "POST",
    headers: { Authorization: `Token ${KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input: {
        image: imageDataUri,
        model: topazModel,
        scale: Math.min(scale, 6),
        face_enhancement: faceEnhance,
      },
    }),
  })

  if (!startRes.ok) {
    const err = await startRes.json()
    throw new Error(`Topaz: ${JSON.stringify(err)}`)
  }

  const prediction = await startRes.json()
  const result = await pollReplicate(prediction.id, KEY)
  const outputUrl = Array.isArray(result.output) ? result.output[0] : result.output

  return res.status(200).json({
    success: true,
    tier: "pro",
    engine: `Topaz Image Upscale (${topazModel})`,
    upscaledImageUrl: outputUrl,
  })
}

// ─── PRO ENGINE: OpenRouter vision models ────────────────────────────────────
async function upscaleWithOpenRouter(
  res: VercelResponse,
  imageBase64: string,
  scale: number,
  enhanceMode: string,
  modelKey: string,
) {
  const KEY = process.env.OPENROUTER_API_KEY
  if (!KEY) throw new Error("OPENROUTER_API_KEY not configured")

  const model = PRO_MODEL_MAP[modelKey] || PRO_MODEL_MAP["nano-banana-2"]

  const prompts: Record<string, string> = {
    general: `Upscale this image to ${scale}x resolution. Enhance details, reduce noise, sharpen edges. DO NOT change content or add new elements. Output ONLY the enhanced image.`,
    photo: `Professionally upscale this photograph ${scale}x. Enhance skin tones, hair detail, fabric texture. Reduce noise and compression artifacts. DO NOT change content.`,
    illustration: `Upscale this illustration ${scale}x. Preserve flat colors, clean vector-like edges, line art. Remove aliasing. DO NOT change content.`,
    text: `Upscale this image ${scale}x focusing on text clarity. Sharpen character edges, enhance contrast. Remove blur. DO NOT change content.`,
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://framer.com",
      "X-Title": "AI Upscaler Plugin",
    },
    body: JSON.stringify({
      model,
      messages: [{
        role: "user",
        content: [
          { type: "text", text: prompts[enhanceMode] || prompts.general },
          { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
        ],
      }],
      modalities: ["text", "image"],
      max_tokens: 4096,
    }),
  })

  if (!response.ok) {
    const err = await response.json()
    throw new Error(`OpenRouter: ${JSON.stringify(err)}`)
  }

  const data = await response.json()
  let imageUrl: string | null = null
  let imageB64: string | null = null

  if (data.choices?.[0]?.message?.content) {
    const content = data.choices[0].message.content
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "image_url") {
          const url = part.image_url?.url
          if (url?.startsWith("data:")) imageB64 = url
          else imageUrl = url
          break
        }
      }
    }
  }

  if (!imageUrl && !imageB64) throw new Error("No image returned from OpenRouter")

  return res.status(200).json({
    success: true,
    tier: "pro",
    engine: `OpenRouter — ${modelKey}`,
    upscaledImageUrl: imageUrl,
    upscaledBase64: imageB64,
    usage: data.usage,
  })
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" })

  try {
    const {
      imageBase64,
      scaleFactor = 2,
      enhanceMode = "general",
      modelKey = "nano-banana-2",
      tier = "free",
      licenseKey = null,
      imageType = "general",
      faceEnhance = false,
    } = req.body

    if (!imageBase64) return res.status(400).json({ error: "No image provided" })

    const userId = (req.headers["x-user-id"] as string) || "anonymous"

    // ── Validate Pro license ─────────────────────────────────────────────────
    let validatedTier = "free"
    if (tier === "pro" && licenseKey) {
      try {
        const host = req.headers.host || "localhost:3000"
        const protocol = host.includes("localhost") ? "http" : "https"
        const licRes = await fetch(`${protocol}://${host}/api/validate-license`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ license_key: licenseKey }),
        })
        const licData = await licRes.json() as any
        if (licData.valid && licData.tier === "pro") validatedTier = "pro"
      } catch (_) {}
    }

    // ── PRO route ────────────────────────────────────────────────────────────
    if (validatedTier === "pro") {
      const host = req.headers.host || "localhost:3000"
      const protocol = host.includes("localhost") ? "http" : "https"

      const usageRes = await fetch(`${protocol}://${host}/api/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, tier: "pro", license_key: licenseKey, action: "check" }),
      })
      const usageData = await usageRes.json() as any

      if (!usageData.canUpscale) {
        return res.status(402).json({ error: usageData.error || "All 100 tokens used. Purchase more to continue." })
      }

      await upscaleWithOpenRouter(res, imageBase64, Math.min(scaleFactor, 4), enhanceMode, modelKey)

      await fetch(`${protocol}://${host}/api/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, tier: "pro", license_key: licenseKey, action: "increment" }),
      })
      return
    }

    // ── FREE route: Replicate (nightmareai/real-esrgan) ──────────────────────
    return await upscaleWithReplicate(res, imageBase64, Math.min(scaleFactor, 2), imageType, faceEnhance)
  } catch (error: any) {
    console.error("Upscale handler error:", error)
    return res.status(500).json({ error: error.message || "Internal server error" })
  }
}
