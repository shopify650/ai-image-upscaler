import type { VercelRequest, VercelResponse } from "@vercel/node"

export const config = { maxDuration: 60 }

const MODELS = {
  free: {
    "nano-banana-free": {
      id: "google/gemini-2.5-flash-image:free",
      name: "Nano Banana (Free)",
      maxScale: 2,
      cost: 0,
    },
  },
  pro: {
    "nano-banana-2": {
      id: "google/gemini-3.1-flash-image-preview",
      name: "Nano Banana 2 (Fast)",
      maxScale: 4,
      cost: 0.03,
    },
    "nano-banana-pro": {
      id: "google/gemini-3-pro-image-preview",
      name: "Nano Banana Pro (Best)",
      maxScale: 4,
      cost: 0.13,
    },
    "riverflow": {
      id: "sourceful/riverflow-v2.5-pro",
      name: "Riverflow 2.5 Pro (Ultra)",
      maxScale: 4,
      cost: 0.04,
    },
  },
}

const PROMPTS: Record<string, (scale: number) => string> = {
  general: (scale: number) =>
    `Upscale this image to ${scale}x resolution. Enhance details, reduce noise, sharpen the image, improve visual quality. DO NOT add, remove, or change any content. Only enhance quality. Output the enhanced image.`,
  photo: (scale: number) =>
    `Professionally enhance and upscale this photograph to ${scale}x resolution. Enhance skin texture, hair detail, fabric detail, and foliage. Reduce noise and JPEG artifacts. Improve color accuracy and dynamic range. DO NOT change any content. Output the enhanced image.`,
  illustration: (scale: number) =>
    `Upscale this illustration/graphic to ${scale}x resolution. Preserve flat colors, clean sharp edges, and line art quality. Remove aliasing and pixelation. Maintain exact composition and style. Output the enhanced image.`,
  text: (scale: number) =>
    `Upscale this image to ${scale}x resolution focusing on making all text crystal clear and readable. Sharpen edges, enhance contrast for legibility. Remove blur and compression artifacts around text. DO NOT change any content. Output the enhanced image.`,
}

async function processUpscale(res: VercelResponse, imageBase64: string, scale: number, mode: string, model: any, tier: string) {
  const promptFn = PROMPTS[mode]
  const prompt = promptFn ? promptFn(scale) : PROMPTS.general(scale)

  try {
    const openRouterRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://your-plugin.com",
        "X-Title": "AI Upscaler Plugin",
      },
      body: JSON.stringify({
        model: model.id,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:image/png;base64,${imageBase64}` } },
            ],
          },
        ],
        modalities: ["text", "image"],
        max_tokens: 4096,
      }),
    })

    if (!openRouterRes.ok) {
      const err = await openRouterRes.json()
      return res.status(500).json({ error: "AI processing failed", details: err })
    }

    const data = await openRouterRes.json()

    let imageUrl: string | null = null
    let imageBase64Result: string | null = null

    if (data.choices?.[0]?.message?.content) {
      const content = data.choices[0].message.content
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part.type === "image_url") {
            const url = part.image_url?.url
            if (url?.startsWith("data:")) {
              imageBase64Result = url
            } else {
              imageUrl = url
            }
            break
          }
        }
      }
    }

    if (!imageUrl && !imageBase64Result) {
      return res.status(500).json({ error: "No image in AI response" })
    }

    return res.status(200).json({
      success: true,
      tier,
      model: model.name,
      scale,
      upscaledImageUrl: imageUrl,
      upscaledBase64: imageBase64Result,
      usage: data.usage,
    })
  } catch (error: any) {
    return res.status(500).json({ error: error.message })
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*")
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
  res.setHeader("Access-Control-Allow-Headers", "Content-Type")
  if (req.method === "OPTIONS") return res.status(200).end()
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" })

  const { imageBase64, scaleFactor = 2, enhanceMode = "general", modelKey = "nano-banana-free", tier = "free", licenseKey = null } = req.body

  if (!imageBase64) {
    return res.status(400).json({ error: "No image provided" })
  }

  let validatedTier = "free"

  if (tier === "pro" && licenseKey) {
    try {
      const host = req.headers.host || "localhost:3000"
      const protocol = host.includes("localhost") ? "http" : "https"
      const licenseRes = await fetch(`${protocol}://${host}/api/validate-license`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: licenseKey }),
      })
      const licenseData = await licenseRes.json()
      if (licenseData.valid && licenseData.tier === "pro") {
        validatedTier = "pro"
      }
    } catch (_) {}
  }

  if (validatedTier === "free") {
    const freeModel = MODELS.free["nano-banana-free"]
    const cappedScale = Math.min(scaleFactor, freeModel.maxScale)
    return await processUpscale(res, imageBase64, cappedScale, "general", freeModel, "free")
  }

  if (validatedTier === "pro") {
    const proModels = MODELS.pro as Record<string, any>
    const proModel = proModels[modelKey] || proModels["nano-banana-2"]
    const cappedScale = Math.min(scaleFactor, proModel.maxScale)
    return await processUpscale(res, imageBase64, cappedScale, enhanceMode, proModel, "pro")
  }
}
