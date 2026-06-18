import { framer } from "@framer/plugin"
import { useState, useEffect, useCallback } from "react"
import "./App.css"

const API_URL = "https://ai-image-upscaler-woad.vercel.app/api"
const LEMONSQUEEZY_CHECKOUT_URL = "https://your-store.lemonsqueezy.com/buy/your-product-id"

framer.showUI({ width: 350, height: 640, resizable: true })

type Tier = "free" | "pro"
type EnhanceMode = "general" | "photo" | "illustration" | "text"
type ImageType = "general" | "photo" | "anime" | "illustration"

interface ProModel {
  key: string
  label: string
  description: string
  badge: string
}

const PRO_MODELS: ProModel[] = [
  { key: "nano-banana-2", label: "Nano Banana 2", description: "Fast + Great quality", badge: "POPULAR" },
  { key: "nano-banana-pro", label: "Nano Banana Pro", description: "Highest quality, 4K output", badge: "BEST" },
  { key: "riverflow", label: "Riverflow 2.5 Pro", description: "Multi-step reasoning edits", badge: "NEW" },
]

async function bitmapToBase64(bitmap: ImageBitmap): Promise<string> {
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const ctx = canvas.getContext("2d")!
  ctx.drawImage(bitmap, 0, 0)
  return canvas.toDataURL("image/png").split(",")[1]
}

async function imageToBytes(src: string): Promise<Uint8Array> {
  if (src.startsWith("data:")) {
    const b = atob(src.split(",")[1])
    const a = new Uint8Array(b.length)
    for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i)
    return a
  }
  const r = await fetch(src)
  return new Uint8Array(await r.arrayBuffer())
}

export function App() {
  const [tier, setTier] = useState<Tier>("free")
  const [licenseKey, setLicenseKey] = useState("")
  const [licenseInput, setLicenseInput] = useState("")
  const [isValidating, setIsValidating] = useState(false)
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [customerName, setCustomerName] = useState<string | null>(null)
  const [showLicensePanel, setShowLicensePanel] = useState(false)

  const [scaleFactor, setScaleFactor] = useState(2)
  const [enhanceMode, setEnhanceMode] = useState<EnhanceMode>("general")
  const [imageType, setImageType] = useState<ImageType>("general")
  const [faceEnhance, setFaceEnhance] = useState(false)
  const [selectedModel, setSelectedModel] = useState("nano-banana-2")
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState("Ready")
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [originalSize, setOriginalSize] = useState<{ w: number; h: number } | null>(null)

  const [usageRemaining, setUsageRemaining] = useState(5)
  const [usageLimit, setUsageLimit] = useState(5)

  useEffect(() => {
    async function load() {
      try {
        const savedKey = await framer.getPluginData("license_key")
        if (savedKey) {
          setLicenseKey(savedKey)
          await validateLicense(savedKey)
        }
      } catch (_) {}

      try {
        if (framer.mode === "editImage") {
          const image = await framer.getImage()
          if (image) {
            const bitmap = await image.loadBitmap()
            setOriginalSize({ w: bitmap.width, h: bitmap.height })
            const canvas = document.createElement("canvas")
            canvas.width = bitmap.width
            canvas.height = bitmap.height
            canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
            setPreviewUrl(canvas.toDataURL("image/png"))
          }
        }
      } catch (_) {}
    }
    load()
  }, [])

  async function validateLicense(key: string) {
    setIsValidating(true)
    setLicenseError(null)
    try {
      const res = await fetch(`${API_URL}/validate-license`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: key }),
      })
      const data = await res.json()
      if (data.valid && data.tier === "pro") {
        setTier("pro")
        setLicenseKey(key)
        setCustomerName(data.customer?.name || "Pro User")
        setUsageLimit(100)
        setUsageRemaining(100)
        await framer.setPluginData("license_key", key)
        setShowLicensePanel(false)
      } else {
        setLicenseError(data.error || "Invalid license key")
      }
    } catch (_) {
      setLicenseError("Failed to validate. Check your connection.")
    } finally {
      setIsValidating(false)
    }
  }

  async function deactivateLicense() {
    setTier("free")
    setLicenseKey("")
    setCustomerName(null)
    setUsageLimit(5)
    setUsageRemaining(5)
    await framer.setPluginData("license_key", "")
  }

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    if (isProcessing && progress < 90) {
      interval = setInterval(() => {
        setProgress((p) => Math.min(p + (p < 30 ? 3 : p < 60 ? 2 : 1), 90))
      }, 500)
    }
    return () => clearInterval(interval)
  }, [isProcessing, progress])

  const handleUpscale = useCallback(async () => {
    if (usageRemaining <= 0) {
      setError(tier === "free" ? "Daily limit reached! Upgrade to Pro for 100 tokens." : "All 100 tokens used. Purchase more to continue.")
      return
    }

    setIsProcessing(true)
    setError(null)
    setProgress(0)

    try {
      setStatus("Getting image...")
      const image = await framer.getImage()
      if (!image) throw new Error("No image selected on canvas.")

      setStatus("Preparing...")
      setProgress(10)
      const bitmap = await image.loadBitmap()
      setOriginalSize({ w: bitmap.width, h: bitmap.height })
      const base64 = await bitmapToBase64(bitmap)

      setStatus(tier === "pro" ? "AI enhancing (Pro model)..." : "AI enhancing (Free)...")
      setProgress(25)

      const response = await fetch(`${API_URL}/upscale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: base64,
          scaleFactor: tier === "free" ? 2 : scaleFactor,
          enhanceMode: tier === "free" ? "general" : enhanceMode,
          imageType: tier === "free" ? "general" : imageType,
          faceEnhance: faceEnhance,
          modelKey: tier === "free" ? "nano-banana-free" : selectedModel,
          tier: tier,
          licenseKey: licenseKey || null,
        }),
      })

      setProgress(75)

      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.error || "Upscale failed")
      }

      const data = await response.json()
      const imgSrc = data.upscaledBase64 || data.upscaledImageUrl
      if (!imgSrc) throw new Error("No image returned")

      setStatus("Applying to canvas...")
      setProgress(90)

      const bytes = await imageToBytes(imgSrc)
      await framer.setImage({ image: { bytes, mimeType: "image/png" } })

      setProgress(100)
      setPreviewUrl(imgSrc)

      setUsageRemaining((prev) => Math.max(0, prev - 1))

      const newW = bitmap.width * (tier === "free" ? 2 : scaleFactor)
      const newH = bitmap.height * (tier === "free" ? 2 : scaleFactor)
      setStatus(`Done! ${newW}x${newH}px (${data.engine || data.model || ""})`)
    } catch (err: any) {
      setError(err.message)
      setStatus("Error")
    } finally {
      setIsProcessing(false)
    }
  }, [tier, scaleFactor, enhanceMode, imageType, faceEnhance, selectedModel, licenseKey, usageRemaining])

  return (
    <div className="plugin">
      <div className="header">
        <div className="header-left">
          <span className="logo">&#x1F50D;</span>
          <div>
            <h1 className="title">AI Upscaler</h1>
            <p className="subtitle">
              {tier === "pro" ? `Pro · ${usageRemaining}/100 tokens` : "Free Plan · 5 upscales/day"}
            </p>
          </div>
        </div>
        <button
          className={`tier-badge ${tier}`}
          onClick={() => setShowLicensePanel(!showLicensePanel)}
        >
          {tier === "pro" ? "PRO" : "FREE"}
        </button>
      </div>

      {showLicensePanel && (
        <div className="license-panel">
          {tier === "pro" ? (
            <>
              <p className="license-info">Licensed to: {customerName}</p>
              <button className="btn-deactivate" onClick={deactivateLicense}>
                Deactivate License
              </button>
            </>
          ) : (
            <>
              <p className="license-info">Enter your license key to unlock Pro:</p>
              <div className="license-input-row">
                <input
                  type="text"
                  className="license-input"
                  placeholder="XXXX-XXXX-XXXX-XXXX"
                  value={licenseInput}
                  onChange={(e) => setLicenseInput(e.target.value)}
                  disabled={isValidating}
                />
                <button
                  className="btn-activate"
                  onClick={() => validateLicense(licenseInput)}
                  disabled={isValidating || !licenseInput}
                >
                  {isValidating ? "..." : "Activate"}
                </button>
              </div>
              {licenseError && <p className="license-error">{licenseError}</p>}
              <a
                href={LEMONSQUEEZY_CHECKOUT_URL}
                target="_blank"
                rel="noopener"
                className="btn-buy"
              >
                Get Pro — $7/mo or $49 lifetime
              </a>
            </>
          )}
        </div>
      )}

      <div className="preview">
        {previewUrl ? (
          <img src={previewUrl} alt="Preview" className="preview-img" />
        ) : (
          <div className="preview-empty">
            <span>&#x1F4F7;</span>
            <p>Select an image on the canvas</p>
          </div>
        )}
      </div>

      {originalSize && (
        <div className="info-bar">
          <span>{originalSize.w}x{originalSize.h}</span>
          <span className="info-arrow">&rarr;</span>
          <span className="info-highlight">
            {originalSize.w * (tier === "free" ? 2 : scaleFactor)}x
            {originalSize.h * (tier === "free" ? 2 : scaleFactor)}
          </span>
        </div>
      )}

      <div className="section">
        <label className="label">
          Scale Factor
          {tier === "free" && <span className="pro-lock">Pro: up to 4x</span>}
        </label>
        <div className="btn-group">
          {[2, 3, 4].map((s) => {
            const locked = tier === "free" && s > 2
            return (
              <button
                key={s}
                className={`btn-opt ${scaleFactor === s && !locked ? "active" : ""} ${locked ? "locked" : ""}`}
                onClick={() => !locked && setScaleFactor(s)}
                disabled={isProcessing || locked}
              >
                {s}x{locked && " locked"}
              </button>
            )
          })}
        </div>
      </div>

      <div className="section">
        <label className="label">
          AI Model
          {tier === "free" && <span className="pro-lock">Pro only</span>}
        </label>
        {tier === "pro" ? (
          <div className="model-list">
            {PRO_MODELS.map((m) => (
              <button
                key={m.key}
                className={`model-card ${selectedModel === m.key ? "active" : ""}`}
                onClick={() => setSelectedModel(m.key)}
                disabled={isProcessing}
              >
                <div className="model-card-top">
                  <span className="model-name">{m.label}</span>
                  <span className={`model-badge ${m.badge.toLowerCase()}`}>{m.badge}</span>
                </div>
                <span className="model-desc">{m.description}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="locked-section">
            <p>Using: Nano Banana (Free Model)</p>
            <p className="locked-hint">Upgrade to Pro for premium AI models</p>
          </div>
        )}
      </div>

      <div className="section">
        <label className="label">
          Image Type
          {tier === "free" && <span className="pro-lock">Pro: all types</span>}
        </label>
        <div className="btn-group four">
          {[
            { id: "general", icon: "\uD83C\uDFAF", label: "General" },
            { id: "photo", icon: "\uD83D\uDCF8", label: "Photo" },
            { id: "anime", icon: "\uD83C\uDFA8", label: "Anime" },
            { id: "illustration", icon: "\uD83C\uDFAD", label: "Illust." },
          ].map((m) => {
            const locked = tier === "free" && m.id !== "general"
            return (
              <button
                key={m.id}
                className={`btn-opt small ${imageType === m.id && !locked ? "active" : ""} ${locked ? "locked" : ""}`}
                onClick={() => !locked && setImageType(m.id as ImageType)}
                disabled={isProcessing || locked}
              >
                <span>{m.icon}</span>
                <span className="btn-label">{m.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {tier === "pro" && (
        <div className="section">
          <label className="label">
            Enhancement Mode
          </label>
          <div className="btn-group four">
            {[
              { id: "general", icon: "\uD83C\uDFAF", label: "General" },
              { id: "photo", icon: "\uD83D\uDCF8", label: "Photo" },
              { id: "illustration", icon: "\uD83C\uDFA8", label: "Art" },
              { id: "text", icon: "\uD83D\uDCDD", label: "Text" },
            ].map((m) => (
              <button
                key={m.id}
                className={`btn-opt small ${enhanceMode === m.id ? "active" : ""}`}
                onClick={() => setEnhanceMode(m.id as EnhanceMode)}
                disabled={isProcessing}
              >
                <span>{m.icon}</span>
                <span className="btn-label">{m.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="section">
        <label className="label">
          <span>Face Enhancement</span>
        </label>
        <button
          className={`btn-opt ${faceEnhance ? "active" : ""}`}
          onClick={() => setFaceEnhance(!faceEnhance)}
          disabled={isProcessing}
          style={{ maxWidth: 120 }}
        >
          {faceEnhance ? "ON" : "OFF"}
        </button>
      </div>

      <div className="usage-bar">
        <div className="usage-header">
          <span>{tier === "pro" ? "Tokens Remaining" : "Daily Usage"}</span>
          <span>{usageRemaining}/{usageLimit} used</span>
        </div>
        <div className="usage-track">
          <div
            className="usage-fill"
            style={{ width: `${((usageLimit - usageRemaining) / usageLimit) * 100}%` }}
          />
        </div>
        {usageRemaining <= 1 && (
          <p className="usage-warning">
            {usageRemaining === 0
              ? tier === "pro" ? "All tokens used! Purchase more." : "No upscales remaining!"
              : "1 left!"}
            {" "}
            <a href={LEMONSQUEEZY_CHECKOUT_URL} target="_blank" rel="noopener">{tier === "pro" ? "Buy more &rarr;" : "Upgrade &rarr;"}</a>
          </p>
        )}
      </div>

      {isProcessing && (
        <div className="progress">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <span className="progress-text">{Math.round(progress)}%</span>
        </div>
      )}

      <div className={`status ${error ? "error" : ""}`}>
        {error || status}
      </div>

      <button
        className={`btn-upscale ${isProcessing ? "loading" : ""} ${tier}`}
        onClick={handleUpscale}
        disabled={isProcessing || usageRemaining <= 0}
      >
        {isProcessing ? (
          <><span className="spinner" /> Enhancing...</>
        ) : usageRemaining <= 0 ? (
          <>{tier === "pro" ? "Buy More Tokens" : "Upgrade to Pro"}</>
        ) : (
          <>Upscale {tier === "free" ? "2" : scaleFactor}x{tier === "pro" && ` (${usageRemaining} tokens)`}</>
        )}
      </button>

      {tier === "free" && (
        <div className="upgrade-cta">
          <p className="upgrade-title">Unlock Pro Features</p>
          <ul className="upgrade-features">
            <li>Unlimited upscales (no daily limit)</li>
            <li>Up to 4x scale (vs 2x free)</li>
            <li>Premium AI models (4K output)</li>
            <li>Photo, Art & Text enhancement modes</li>
            <li>No watermark</li>
          </ul>
          <a
            href={LEMONSQUEEZY_CHECKOUT_URL}
            target="_blank"
            rel="noopener"
            className="btn-upgrade"
          >
            Upgrade to Pro — $7/mo
          </a>
        </div>
      )}

      <div className="footer">
        <span>v2.0</span>
      </div>
    </div>
  )
}
