import type { CalloutAnnotation } from '../../types/index.ts'
export const calloutTail = (a: CalloutAnnotation) => a.tail ?? { x:a.x+8, y:a.y+a.h+Math.min(18,Math.max(10,a.w*.12)) }
export function calloutPath(a: CalloutAnnotation): string {
  const {x,y,w,h}=a, tip=calloutTail(a), r=Math.min(a.textStyle?.radius??10,w/4,h/4)
  if(!a.tail) {const tail=tip.y-y-h;return `M${x+r} ${y} H${x+w-r} Q${x+w} ${y} ${x+w} ${y+r} V${y+h-r} Q${x+w} ${y+h} ${x+w-r} ${y+h} H${x+tail+16} L${tip.x} ${tip.y} L${x+12} ${y+h} H${x+r} Q${x} ${y+h} ${x} ${y+h-r} V${y+r} Q${x} ${y} ${x+r} ${y} Z`}
  const inside=tip.x>=x&&tip.x<=x+w&&tip.y>=y&&tip.y<=y+h, dx=(tip.x-x-w/2)/(w/2||1),dy=(tip.y-y-h/2)/(h/2||1)
  const side=inside?'none':Math.abs(dx)>Math.abs(dy)?dx>0?'right':'left':dy>0?'bottom':'top'
  const size=side==='top'||side==='bottom'?w:h, half=Math.min(14,Math.max(2,(size-2*r)/4)), raw=side==='top'||side==='bottom'?tip.x-x:tip.y-y, center=Math.max(r+half,Math.min(size-r-half,raw))
  const top=side==='top'?`H${x+center-half} L${tip.x} ${tip.y} L${x+center+half} ${y}`:''
  const right=side==='right'?`V${y+center-half} L${tip.x} ${tip.y} L${x+w} ${y+center+half}`:''
  const bottom=side==='bottom'?`H${x+center+half} L${tip.x} ${tip.y} L${x+center-half} ${y+h}`:''
  const left=side==='left'?`V${y+center+half} L${tip.x} ${tip.y} L${x} ${y+center-half}`:''
  return `M${x+r} ${y} ${top} H${x+w-r} Q${x+w} ${y} ${x+w} ${y+r} ${right} V${y+h-r} Q${x+w} ${y+h} ${x+w-r} ${y+h} ${bottom} H${x+r} Q${x} ${y+h} ${x} ${y+h-r} ${left} V${y+r} Q${x} ${y} ${x+r} ${y} Z`
}
