import { framer } from "@framer/plugin"
import { useState, useEffect, useCallback } from "react"
import "./App.css"

const API_URL = "https://ai-image-upscaler-woad.vercel.app/api"
const LEMONSQUEEZY_CHECKOUT_URL = "https://your-store.lemonsqueezy.com/buy/your-product-id"
const FREE_TRIAL_LIMIT = 5

framer.showUI({ width: 320, height: 540, resizable: true })

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function getOrCreateDeviceId(): Promise<string> {
  let id = await framer.getPluginData("deviceId").catch(() => null)
  if (!id) {
    id = crypto.randomUUID()
    await framer.setPluginData("deviceId", id).catch(() => {})
  }
  return id!
}

async function bitmapToBase64(bitmap: ImageBitmap): Promise<string> {
  const canvas = document.createElement("canvas")
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0)
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

// ─── App ──────────────────────────────────────────────────────────────────────
type Screen = "main" | "upgrade"

export function App() {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>("main")

  // Usage state
  const [freeUsed, setFreeUsed] = useState(0)
  const [isActiveSub, setIsActiveSub] = useState(false)
  const [hasPurchased, setHasPurchased] = useState(false)
  const [usageLoaded, setUsageLoaded] = useState(false)

  // License
  const [licenseInput, setLicenseInput] = useState("")
  const [isValidating, setIsValidating] = useState(false)
  const [licenseError, setLicenseError] = useState<string | null>(null)

  // Upscale
  const [scaleFactor, setScaleFactor] = useState(2)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState("Ready")
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [originalSize, setOriginalSize] = useState<{ w: number; h: number } | null>(null)

  // ── On mount: get deviceId, load preview, check usage ─────────────────────
  useEffect(() => {
    async function init() {
      const id = await getOrCreateDeviceId()
      setDeviceId(id)

      // Check usage from server
      try {
        const res = await fetch(`${API_URL}/usage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deviceId: id, action: "check" }),
        })
        const data = await res.json()
        setFreeUsed(data.freeUsed ?? 0)
        setIsActiveSub(data.tier === "pro")
        setHasPurchased(data.hasPurchased ?? false)
      } catch (_) {}

      setUsageLoaded(true)

      // Load image preview
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
    init()
  }, [])

  // ── Progress animation ────────────────────────────────────────────────────
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>
    if (isProcessing && progress < 90) {
      interval = setInterval(() => {
        setProgress((p) => Math.min(p + (p < 30 ? 3 : p < 60 ? 2 : 1), 90))
      }, 500)
    }
    return () => clearInterval(interval)
  }, [isProcessing, progress])

  // ── License activation ────────────────────────────────────────────────────
  async function activateLicense() {
    if (!licenseInput.trim() || !deviceId) return
    setIsValidating(true)
    setLicenseError(null)
    try {
      // 1. Validate with LemonSqueezy
      const res = await fetch(`${API_URL}/validate-license`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ license_key: licenseInput }),
      })
      const data = await res.json()

      if (!data.valid) {
        setLicenseError(data.error || "Invalid license key. Please check and try again.")
        return
      }

      // 2. Activate in our database
      await fetch(`${API_URL}/usage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceId, action: "activate", licenseKey: licenseInput }),
      })

      // 3. Save license key locally
      await framer.setPluginData("licenseKey", licenseInput).catch(() => {})

      setIsActiveSub(true)
      setHasPurchased(true)
      setScreen("main")
      setLicenseInput("")
    } catch (_) {
      setLicenseError("Connection error. Please try again.")
    } finally {
      setIsValidating(false)
    }
  }

  // ── Upscale handler ───────────────────────────────────────────────────────
  const handleUpscale = useCallback(async () => {
    if (!deviceId) return

    // Client-side pre-check to avoid hitting the server unnecessarily
    if (!isActiveSub && freeUsed >= FREE_TRIAL_LIMIT) {
      setScreen("upgrade")
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

      setStatus("AI enhancing...")
      setProgress(25)

      const response = await fetch(`${API_URL}/upscale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64: base64, scaleFactor, deviceId }),
      })

      setProgress(75)

      if (!response.ok) {
        const err = await response.json()
        // Trial exhausted — show upgrade screen
        if (err.reason === "trial_exhausted" || err.reason === "subscription_cancelled") {
          setScreen("upgrade")
          return
        }
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

      // Increment local counter
      if (!isActiveSub) setFreeUsed((prev) => Math.min(prev + 1, FREE_TRIAL_LIMIT))

      const newW = bitmap.width * scaleFactor
      const newH = bitmap.height * scaleFactor
      setStatus(`Done! ${newW}×${newH}px`)
    } catch (err: any) {
      setError(err.message)
      setStatus("Error")
    } finally {
      setIsProcessing(false)
    }
  }, [deviceId, scaleFactor, isActiveSub, freeUsed])

  const freeRemaining = Math.max(0, FREE_TRIAL_LIMIT - freeUsed)
  const canUpscale = isActiveSub || freeRemaining > 0

  // ── UPGRADE SCREEN ────────────────────────────────────────────────────────
  if (screen === "upgrade") {
    return (
      <div className="plugin" style={{ padding: "24px" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ fontSize: "40px", marginBottom: "12px" }}>⚡</div>
          <h2 style={{ fontSize: "18px", fontWeight: "700", margin: "0 0 8px" }}>
            {hasPurchased ? "Subscription Expired" : "Free Trial Ended"}
          </h2>
          <p style={{ fontSize: "13px", color: "#666", margin: 0 }}>
            {hasPurchased
              ? "Your subscription was cancelled. Re-subscribe to continue."
              : `You've used all ${FREE_TRIAL_LIMIT} free upscales. Subscribe to get unlimited access.`}
          </p>
        </div>

        <a
          href={LEMONSQUEEZY_CHECKOUT_URL}
          target="_blank"
          rel="noopener"
          style={{
            display: "block", width: "100%", padding: "14px", background: "#0055FF",
            color: "#fff", border: "none", borderRadius: "8px", fontSize: "15px",
            fontWeight: "600", textAlign: "center", textDecoration: "none",
            marginBottom: "20px", boxSizing: "border-box"
          }}
        >
          Subscribe — $7/mo
        </a>

        <div style={{ borderTop: "1px solid #eee", paddingTop: "20px" }}>
          <p style={{ fontSize: "13px", color: "#666", marginBottom: "12px" }}>
            Already subscribed? Enter your license key:
          </p>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="text"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              value={licenseInput}
              onChange={(e) => setLicenseInput(e.target.value)}
              disabled={isValidating}
              style={{
                flex: 1, padding: "10px 12px", border: "1px solid #ddd",
                borderRadius: "6px", fontSize: "13px", outline: "none"
              }}
            />
            <button
              onClick={activateLicense}
              disabled={isValidating || !licenseInput.trim()}
              style={{
                padding: "10px 16px", background: "#0055FF", color: "#fff",
                border: "none", borderRadius: "6px", cursor: "pointer",
                fontSize: "13px", fontWeight: "600", opacity: isValidating ? 0.6 : 1
              }}
            >
              {isValidating ? "..." : "Activate"}
            </button>
          </div>
          {licenseError && (
            <p style={{ fontSize: "12px", color: "#ff3333", marginTop: "8px" }}>{licenseError}</p>
          )}
        </div>

        <button
          onClick={() => setScreen("main")}
          style={{
            marginTop: "16px", width: "100%", padding: "10px", background: "transparent",
            color: "#999", border: "1px solid #eee", borderRadius: "6px",
            fontSize: "13px", cursor: "pointer"
          }}
        >
          ← Back
        </button>
      </div>
    )
  }

  // ── MAIN SCREEN ───────────────────────────────────────────────────────────
  return (
    <div className="plugin" style={{ padding: "20px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        <div>
          <h1 style={{ fontSize: "18px", fontWeight: "700", margin: "0 0 4px" }}>Upscaler</h1>
          <p style={{ fontSize: "12px", color: "#888", margin: 0 }}>
            Improve images with cutting-edge AI
          </p>
        </div>
        {/* Trial / Pro badge */}
        {usageLoaded && (
          isActiveSub ? (
            <span style={{
              padding: "4px 10px", background: "#0055FF", color: "#fff",
              borderRadius: "20px", fontSize: "11px", fontWeight: "700"
            }}>PRO</span>
          ) : (
            <button
              onClick={() => setScreen("upgrade")}
              style={{
                padding: "4px 10px", background: "#FFF3E0", color: "#E65100",
                border: "1px solid #FFB74D", borderRadius: "20px", fontSize: "11px",
                fontWeight: "700", cursor: "pointer"
              }}
            >
              {freeRemaining} / {FREE_TRIAL_LIMIT} free left
            </button>
          )
        )}
      </div>

      {/* Preview */}
      <div style={{
        background: "#F5F5F5", borderRadius: "10px", padding: "16px",
        textAlign: "center", marginBottom: "20px", minHeight: "140px",
        display: "flex", alignItems: "center", justifyContent: "center"
      }}>
        {previewUrl ? (
          <img src={previewUrl} alt="Preview" style={{ maxWidth: "100%", maxHeight: "160px", borderRadius: "6px" }} />
        ) : (
          <div style={{ color: "#aaa" }}>
            <div style={{ fontSize: "28px", marginBottom: "8px" }}>🖼️</div>
            <p style={{ margin: 0, fontSize: "13px" }}>Select an image on the canvas</p>
          </div>
        )}
      </div>

      {/* Size info */}
      {originalSize && (
        <div style={{
          display: "flex", justifyContent: "center", alignItems: "center",
          gap: "10px", marginBottom: "20px", fontSize: "13px", color: "#666"
        }}>
          <span>{originalSize.w}×{originalSize.h}</span>
          <span>→</span>
          <span style={{ color: "#0055FF", fontWeight: "600" }}>
            {originalSize.w * scaleFactor}×{originalSize.h * scaleFactor}
          </span>
        </div>
      )}

      {/* Scale Factor */}
      <div style={{ marginBottom: "20px" }}>
        <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "#444", marginBottom: "10px" }}>
          Scale Factor
        </label>
        <div style={{ display: "flex", gap: "8px" }}>
          {[2, 4, 6].map((s) => (
            <button
              key={s}
              onClick={() => setScaleFactor(s)}
              disabled={isProcessing}
              style={{
                flex: 1, padding: "10px", fontSize: "14px", fontWeight: "600",
                border: scaleFactor === s ? "2px solid #0055FF" : "1px solid #E0E0E0",
                background: scaleFactor === s ? "#EEF3FF" : "#FAFAFA",
                color: scaleFactor === s ? "#0055FF" : "#444",
                borderRadius: "8px", cursor: "pointer",
                opacity: isProcessing ? 0.5 : 1
              }}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* Progress bar */}
      {isProcessing && (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ height: "4px", background: "#EEEEEE", borderRadius: "2px", overflow: "hidden" }}>
            <div style={{
              width: `${progress}%`, height: "100%", background: "#0055FF",
              borderRadius: "2px", transition: "width 0.4s ease"
            }} />
          </div>
        </div>
      )}

      {/* Status */}
      <div style={{
        fontSize: "12px", textAlign: "center", marginBottom: "14px",
        color: error ? "#E53935" : "#888", minHeight: "16px"
      }}>
        {error || status}
      </div>

      {/* Upscale button */}
      <button
        onClick={canUpscale ? handleUpscale : () => setScreen("upgrade")}
        disabled={isProcessing}
        style={{
          width: "100%", padding: "14px", fontSize: "15px", fontWeight: "700",
          background: isProcessing ? "#BDBDBD" : canUpscale ? "#0055FF" : "#E53935",
          color: "#fff", border: "none", borderRadius: "10px",
          cursor: isProcessing ? "not-allowed" : "pointer",
          transition: "background 0.2s"
        }}
      >
        {isProcessing ? "Enhancing..." : canUpscale ? "Upscale Image" : "Trial Ended — Subscribe"}
      </button>

      {/* Footer */}
      {!isActiveSub && usageLoaded && (
        <p style={{ textAlign: "center", fontSize: "11px", color: "#BBB", marginTop: "12px" }}>
          {freeRemaining > 0
            ? `${freeRemaining} free upscale${freeRemaining !== 1 ? "s" : ""} remaining`
            : "Free trial used up."}{" "}
          <button
            onClick={() => setScreen("upgrade")}
            style={{ color: "#0055FF", background: "none", border: "none", cursor: "pointer", fontSize: "11px", padding: 0 }}
          >
            Upgrade →
          </button>
        </p>
      )}
    </div>
  )
}
