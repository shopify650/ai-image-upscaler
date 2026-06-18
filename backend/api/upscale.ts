import type { VercelRequest, VercelResponse } from "@vercel/node"
import { put } from "@vercel/blob"

export const config = { maxDuration: 60 }

const FREE_ENGINES = ["real-esrgan", "imagerouter-free"] as const
type FreeEngine = (typeof FREE_ENGINES)[number]

const PRO_MODEL_MAP: Record<string, string> = {
  "nano-banana-2": "google/gemini-3.1-flash-image-preview",
  "nano-banana-pro": "google/gemini-3-pro-image-preview",
  "riverflow": "sourceful/riverflow-v2.5-pro",
}

// ModelsLab model IDs by image type
const ESRGAN_MODELS: Record<string, string> = {
  photo: "RealESRGAN_x4plus",
  anime: "RealESRGAN_x4plus_anime_6B",
  general: "realesr-general-x4v3",
}

async function uploadToBlob(imageBase64: string): Promise<string> {
  const buffer = Buffer.from(imageBase64, "base64")
  const blob = await put(`uploads/${Date.now()}.png`, buffer, {
    access: "public",
    addRandomSuffix: true,
    contentType: "image/png",
    token: process.env.BLOB_READ_WRITE_TOKEN,
  })
  return blob.url
}

async function upscaleWithModelsLab(res: VercelResponse, imageBase64: string, scale: number = 2, imageType: string = "general", faceEnhance: boolean = false) {
  const KEY = process.env.MODELSLAB_API_KEY
  if (!KEY) throw new Error("MODELSLAB_API_KEY not configured")

  const modelId = ESRGAN_MODELS[imageType] || ESRGAN_MODELS.general

  // ModelsLab requires a public URL (not data URL), so upload to Vercel Blob first
  const imageUrl = await uploadToBlob(imageBase64)

  const response = await fetch("https://modelslab.com/api/v6/image_editing/super_resolution", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: KEY,
      init_image: imageUrl,
      scale: scale,
      model_id: modelId,
      face_enhance: faceEnhance,
      webhook: null,
      track_id: null,
    }),
  })

  if (!response.ok) throw new Error(`ModelsLab: ${response.status}`)

  const data = await response.json()

  if (data.status === "processing" && data.fetch_result) {
    let result = data
    let attempts = 0
    while (result.status === "processing" && attempts < 30) {
      await new Promise((r) => setTimeout(r, 2000))
      const pollRes = await fetch(data.fetch_result, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: KEY }),
      })
      result = await pollRes.json()
      attempts++
    }
    if (result.status === "success" && result.output?.[0]) {
      return res.status(200).json({
        success: true, tier: "free",
        engine: "Real-ESRGAN (ModelsLab Free)",
        upscaledImageUrl: result.output[0],
      })
    }
    throw new Error("ModelsLab timeout")
  }

  if (data.output?.[0]) {
    return res.status(200).json({
      success: true, tier: "free",
      engine: "Real-ESRGAN (ModelsLab Free)",
      upscaledImageUrl: data.output[0],
    })
  }

  throw new Error("No output from ModelsLab")
}

async function upscaleWithImageRouter(res: VercelResponse, imageBase64: string) {
  const KEY = process.env.IMAGEROUTER_API_KEY
  if (!KEY) throw new Error("IMAGEROUTER_API_KEY not configured")

  const response = await fetch("https://api.imagerouter.io/v1/openai/images/edits", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "stabilityai/stable-diffusion-xl-base-1.0",
      prompt: "Enhance and upscale this image 2x. Improve sharpness, clarity, detail. Keep all content identical.",
      image: `data:image/png;base64,${imageBase64}`,
      size: "1024x1024",
      quality: "high",
      response_format: "url",
    }),
  })

  if (!response.ok) throw new Error(`ImageRouter: ${response.status}`)

  const data = await response.json()

  if (data.data?.[0]?.url) {
    return res.status(200).json({
      success: true, tier: "free",
      engine: "ImageRouter Free",
      upscaledImageUrl: data.data[0].url,
    })
  }

  throw new Error("No output from ImageRouter")
}

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
    general: `Upscale this image to ${scale}x resolution. Enhance details, reduce noise, sharpen. DO NOT change content. Output the enhanced image.`,
    photo: `Professionally enhance this photograph at ${scale}x. Enhance skin, hair, fabric texture. Reduce noise/artifacts. Improve color accuracy. DO NOT change content.`,
    illustration: `Upscale this illustration to ${scale}x. Preserve flat colors, clean edges, line art. Remove aliasing. DO NOT change content.`,
    text: `Upscale this image to ${scale}x focusing on text clarity. Sharpen edges, enhance contrast. Remove blur around text. DO NOT change content.`,
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://your-plugin.com",
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

  if (!imageUrl && !imageB64) throw new Error("No image from OpenRouter")

  return res.status(200).json({
    success: true,
    tier: "pro",
    engine: `OpenRouter — ${modelKey}`,
    upscaledImageUrl: imageUrl,
    upscaledBase64: imageB64,
    usage: data.usage,
  })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" })

  const { imageBase64, scaleFactor = 2, enhanceMode = "general", modelKey = "nano-banana-2", tier = "free", freeEngine = "real-esrgan", licenseKey = null, imageType = "general", faceEnhance = false } = req.body

  if (!imageBase64) return res.status(400).json({ error: "No image provided" })

  const userId = req.headers["x-user-id"] as string || "anonymous"

  // Pro license validation
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
      const licData = await licRes.json()
      if (licData.valid && licData.tier === "pro") validatedTier = "pro"
    } catch (_) {}
  }

  // PRO route
  if (validatedTier === "pro") {
    const host = req.headers.host || "localhost:3000"
    const protocol = host.includes("localhost") ? "http" : "https"

    const usageRes = await fetch(`${protocol}://${host}/api/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, tier: "pro", license_key: licenseKey, action: "check" }),
    })
    const usageData = await usageRes.json()

    if (!usageData.canUpscale) {
      return res.status(402).json({ error: usageData.error || "All 100 tokens used. Purchase more to continue." })
    }

    const cappedScale = Math.min(scaleFactor, 4)
    await upscaleWithOpenRouter(res, imageBase64, cappedScale, enhanceMode, modelKey)

    // Decrement token on success
    await fetch(`${protocol}://${host}/api/usage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, tier: "pro", license_key: licenseKey, action: "increment" }),
    })
    return
  }

   // FREE route with fallback chain — Real-ESRGAN is primary (free 100/day)
  const engineOrder: FreeEngine[] = ["real-esrgan", "imagerouter-free"]
  const startIndex = engineOrder.indexOf(freeEngine as FreeEngine)
  const orderedEngines = startIndex >= 0
    ? [...engineOrder.slice(startIndex), ...engineOrder.slice(0, startIndex)]
    : engineOrder

  const errors: string[] = []

  for (const engine of orderedEngines) {
    try {
      if (engine === "real-esrgan") {
        const cappedScale = Math.min(scaleFactor, 2)
        return await upscaleWithModelsLab(res, imageBase64, cappedScale, imageType, faceEnhance)
      }
      if (engine === "imagerouter-free") return await upscaleWithImageRouter(res, imageBase64)
    } catch (err: any) {
      errors.push(`${engine}: ${err.message}`)
      continue
    }
  }

  return res.status(500).json({ error: `All free engines failed: ${errors.join("; ")}` })
}
