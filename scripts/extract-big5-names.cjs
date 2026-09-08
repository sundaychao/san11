const fs = require('fs')

const dec = new TextDecoder('big5')

function extractSegments(buf, start, end, minLen) {
  const results = []
  let i = start
  while (i < end) {
    const hi = buf[i]
    if (hi >= 0xa1 && hi <= 0xf9 && i + 1 < end) {
      const segStart = i
      const bytes = []
      while (i + 1 < end) {
        const h = buf[i]
        const lo = buf[i + 1]
        if (h >= 0xa1 && h <= 0xf9 && (lo >= 0x40 && lo <= 0x7e || lo >= 0xa1 && lo <= 0xfe)) {
          bytes.push(h, lo)
          i += 2
        } else {
          break
        }
      }
      if (bytes.length === 0) {
        i++
        continue
      }
      if (bytes.length >= minLen * 2) {
        const s = dec.decode(Buffer.from(bytes))
        const cleaned = s.replace(/[^一-龥]/g, '')
        if (cleaned.length >= minLen) {
          results.push({ off: segStart, hex: '0x' + segStart.toString(16), text: cleaned })
        }
      }
    } else {
      i++
    }
  }
  return results
}

const targets = process.argv.slice(2)
for (const t of targets) {
  const buf = fs.readFileSync(t)
  console.log('='.repeat(60))
  console.log(t, 'size', buf.length)
  const segs = extractSegments(buf, 0, buf.length, 2)
  console.log('total segments >=2 cjk chars:', segs.length)
  for (const s of segs) {
    console.log(s.hex, JSON.stringify(s.text))
  }
}
