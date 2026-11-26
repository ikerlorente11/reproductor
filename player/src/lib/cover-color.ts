/** The colour of a cover (its average, darkened so white text reads on it), for the player's background on a phone.
 *  Null when it cannot be read (no cover, or one of another site that does not allow it). */
const known = new Map<string, string | null>()

export async function coverColor(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  if (known.has(url)) return known.get(url)!
  const color = await new Promise<string | null>((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = c.height = 12
        const g = c.getContext('2d', { willReadFrequently: true })!
        g.drawImage(img, 0, 0, 12, 12)
        const d = g.getImageData(0, 0, 12, 12).data
        let r = 0, gr = 0, b = 0, n = 0
        for (let i = 0; i < d.length; i += 4) {
          // the most saturated pixels weigh more: a white or black border does not wash the colour out
          const max = Math.max(d[i], d[i + 1], d[i + 2]), min = Math.min(d[i], d[i + 1], d[i + 2])
          const w = 1 + (max - min) / 32
          r += d[i] * w; gr += d[i + 1] * w; b += d[i + 2] * w; n += w
        }
        const k = Math.min(1, 150 / Math.max(1, Math.max(r, gr, b) / n))   // no brighter than 150 in its strongest channel
        const rgb = [r, gr, b].map((x) => (x / n) * k)
        // nor darker than 64 (a black cover would vanish on the dark background): lifted evenly, the hue kept
        const lift = Math.max(0, 64 - Math.max(...rgb))
        resolve(`rgb(${rgb.map((x) => Math.round(x + lift)).join(', ')})`)
      } catch (_) { resolve(null) }   // a cover of another site that does not allow reading it
    }
    img.onerror = () => resolve(null)
    img.src = url
  })
  if (known.size > 200) known.clear()
  known.set(url, color)
  return color
}
