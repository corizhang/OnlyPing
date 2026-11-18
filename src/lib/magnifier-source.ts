import type { Annotation } from '../types/index.ts'
/** Moving lenses reuses the same immutable, visible non-lens source list. */
export function createMagnifierSourceCache(){let previous:Annotation[]=[];return (annotations:Annotation[])=>{const next=annotations.filter(a=>a.kind!=='magnifier'&&!a.hidden);if(next.length!==previous.length||next.some((a,i)=>a!==previous[i]))previous=next;return previous}}
