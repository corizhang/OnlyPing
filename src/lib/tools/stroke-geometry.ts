import type { FreehandAnnotation } from '../../types/index.ts'
import { distanceToSegment } from './geometry.ts'
type Point={x:number;y:number}
/** Windowed RDP bounds worst-case work while retaining each window's endpoints. */
export function simplifyStroke(points: Point[], tolerance=.6): Point[] {
  if(points.length<3)return points.map(p=>({...p}))
  const output:Point[]=[]
  for(let start=0;start<points.length-1;start+=127){const end=Math.min(start+127,points.length-1),keep=new Set([start,end]),stack=[[start,end]];while(stack.length){const [first,last]=stack.pop()!;let maximum=tolerance,index=-1;for(let i=first+1;i<last;i++){const d=distanceToSegment(points[i].x,points[i].y,points[first].x,points[first].y,points[last].x,points[last].y);if(d>maximum){maximum=d;index=i}}if(index!==-1){keep.add(index);stack.push([first,index],[index,last])}}for(const i of [...keep].sort((a,b)=>a-b)){if(output.length&&i===start)continue;output.push({...points[i]})}}
  return output
}
export function freehandPath(a: FreehandAnnotation): string {
  const p=a.points
  if(p.length<2)return ''
  if(!a.smoothed||p.length<3)return `M${p.map(v=>`${v.x} ${v.y}`).join(' L')}`
  let path=`M${p[0].x} ${p[0].y}`
  for(let i=1;i<p.length-1;i++)path+=` Q${p[i].x} ${p[i].y} ${(p[i].x+p[i+1].x)/2} ${(p[i].y+p[i+1].y)/2}`
  return `${path} L${p.at(-1)!.x} ${p.at(-1)!.y}`
}
