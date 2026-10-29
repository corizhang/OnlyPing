import type { ContentTool } from './types'
import { rectHit } from './types'

export const magnifierTool: ContentTool<'magnifier'> = {
  kind: 'magnifier',
  create: (id, x, y) => ({ id, kind: 'magnifier', x, y, w: 0, h: 0, zoom: 2.5 }),
  hit: rectHit,
  draw: (ctx, a, canvas) => {
    const cx = a.x + a.w / 2
    const cy = a.y + a.h / 2
    const radius = Math.min(a.w, a.h) / 2
    const zoom = Math.min(4, Math.max(1.2, a.zoom || 2.5))
    const sourceW = Math.max(1, Math.ceil(a.w / zoom))
    const sourceH = Math.max(1, Math.ceil(a.h / zoom))
    const snapshot = document.createElement('canvas')
    snapshot.width = sourceW
    snapshot.height = sourceH
    snapshot.getContext('2d')!.drawImage(canvas, cx - sourceW / 2, cy - sourceH / 2, sourceW, sourceH, 0, 0, sourceW, sourceH)
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, radius, 0, Math.PI * 2)
    ctx.clip()
    ctx.drawImage(snapshot, a.x, a.y, a.w, a.h)
    ctx.restore()
    ctx.save()
    ctx.beginPath()
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2)
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = 6
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2)
    ctx.strokeStyle = 'rgba(31,41,55,0.7)'
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.restore()
  },
  view: (a, { selected, scale, magnifierSource, pageWidth, pageHeight }) => {
    const zoom = Math.min(4, Math.max(1.2, a.zoom || 2.5))
    const radius = Math.min(a.w, a.h) / 2
    const cx = a.x + a.w / 2
    const cy = a.y + a.h / 2
    const clipId = `magnifier-${a.id}`
    return (
      <>
        <defs><clipPath id={clipId}><circle cx={cx} cy={cy} r={radius - 2} /></clipPath></defs>
        {magnifierSource && <image href={magnifierSource} x={cx * (1 - zoom)} y={cy * (1 - zoom)} width={pageWidth * zoom} height={pageHeight * zoom} preserveAspectRatio="none" clipPath={`url(#${clipId})`} />}
        <circle cx={cx} cy={cy} r={radius - 1} fill="none" stroke="#fff" strokeWidth={6 / scale} />
        <circle cx={cx} cy={cy} r={radius - 1} fill="none" stroke="#1f2937" strokeOpacity={0.7} strokeWidth={2 / scale} />
        {selected && <circle cx={cx} cy={cy} r={radius + 5 / scale} fill="none" stroke="#2563eb" strokeWidth={2 / scale} strokeDasharray={`${6 / scale} ${4 / scale}`} />}
      </>
    )
  },
}
