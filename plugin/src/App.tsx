import { framer } from "@framer/plugin"
import { useState, useEffect, useCallback } from "react"
import "./App.css"

const API_URL = "https://ai-image-upscaler-woad.vercel.app/api"

framer.showUI({ width: 320, height: 500, resizable: true })

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
  const [scaleFactor, setScaleFactor] = useState(2)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState("Ready")
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [originalSize, setOriginalSize] = useState<{ w: number; h: number } | null>(null)

  useEffect(() => {
    async function load() {
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
        body: JSON.stringify({
          imageBase64: base64,
          scaleFactor: scaleFactor,
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

      const newW = bitmap.width * scaleFactor
      const newH = bitmap.height * scaleFactor
      setStatus(`Done! ${newW}x${newH}px`)
    } catch (err: any) {
      setError(err.message)
      setStatus("Error")
    } finally {
      setIsProcessing(false)
    }
  }, [scaleFactor])

  return (
    <div className="plugin">
      <div className="header" style={{ paddingBottom: '16px', borderBottom: '1px solid #eee', marginBottom: '20px' }}>
        <h1 className="title" style={{ fontSize: '20px', fontWeight: 'bold' }}>Upscaler</h1>
        <p className="subtitle" style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>
          Improve your images with cutting-edge AI.
        </p>
      </div>

      <div className="preview" style={{ background: '#f5f5f5', borderRadius: '8px', padding: '20px', textAlign: 'center', marginBottom: '20px' }}>
        {previewUrl ? (
          <img src={previewUrl} alt="Preview" className="preview-img" style={{ maxWidth: '100%', maxHeight: '180px', borderRadius: '4px' }} />
        ) : (
          <div className="preview-empty" style={{ color: '#999', padding: '40px 0' }}>
            <span style={{ fontSize: '24px', display: 'block', marginBottom: '8px' }}>&#x1F4F7;</span>
            <p style={{ margin: 0 }}>Select an image on the canvas</p>
          </div>
        )}
      </div>

      {originalSize && (
        <div className="info-bar" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '12px', marginBottom: '20px', fontSize: '14px', color: '#666' }}>
          <span>{originalSize.w}x{originalSize.h}</span>
          <span>&rarr;</span>
          <span style={{ color: '#0055FF', fontWeight: '600' }}>
            {originalSize.w * scaleFactor}x{originalSize.h * scaleFactor}
          </span>
        </div>
      )}

      <div className="section" style={{ marginBottom: '24px' }}>
        <label className="label" style={{ display: 'block', marginBottom: '12px', fontSize: '14px', fontWeight: '500' }}>
          Scale Factor
        </label>
        <div className="btn-group" style={{ display: 'flex', gap: '8px' }}>
          {[2, 4, 6].map((s) => (
            <button
              key={s}
              style={{
                flex: 1,
                padding: '10px',
                border: scaleFactor === s ? '2px solid #0055FF' : '1px solid #ddd',
                background: scaleFactor === s ? '#F0F5FF' : '#fff',
                color: scaleFactor === s ? '#0055FF' : '#333',
                borderRadius: '6px',
                cursor: isProcessing ? 'not-allowed' : 'pointer',
                fontWeight: scaleFactor === s ? '600' : 'normal',
                opacity: isProcessing ? 0.6 : 1
              }}
              onClick={() => setScaleFactor(s)}
              disabled={isProcessing}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>

      {isProcessing && (
        <div className="progress" style={{ marginBottom: '16px' }}>
          <div className="progress-track" style={{ height: '6px', background: '#eee', borderRadius: '3px', overflow: 'hidden' }}>
            <div className="progress-fill" style={{ width: `${progress}%`, height: '100%', background: '#0055FF', transition: 'width 0.3s ease' }} />
          </div>
        </div>
      )}

      <div style={{ textAlign: 'center', fontSize: '13px', color: error ? '#ff3333' : '#666', marginBottom: '16px', minHeight: '18px' }}>
        {error || status}
      </div>

      <button
        style={{
          width: '100%',
          padding: '14px',
          background: isProcessing ? '#ccc' : '#0055FF',
          color: '#fff',
          border: 'none',
          borderRadius: '8px',
          fontSize: '15px',
          fontWeight: '600',
          cursor: isProcessing ? 'not-allowed' : 'pointer',
          transition: 'background 0.2s ease'
        }}
        onClick={handleUpscale}
        disabled={isProcessing}
      >
        {isProcessing ? 'Enhancing Image...' : 'Upscale Image'}
      </button>
    </div>
  )
}
