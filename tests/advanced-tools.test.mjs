import test from 'node:test'
import assert from 'node:assert/strict'
import { arrowControl, arrowCurvePoint, controlFromBend, arrowGeometry, pointInArrow } from '../src/lib/tools/arrow-geometry.ts'
import { calloutPath, calloutTail } from '../src/lib/tools/callout-geometry.ts'
import { translateAnnotation, duplicateAnnotation, cropAnnotation } from '../src/lib/tools/annotation-geometry.ts'
import { snapEndpoint, drawingRect } from '../src/lib/tools/interaction-geometry.ts'
import { simplifyStroke, freehandPath } from '../src/lib/tools/stroke-geometry.ts'
import { createMagnifierSourceCache } from '../src/lib/magnifier-source.ts'
const curve={id:'a',kind:'arrow',x1:0,y1:0,x2:100,y2:0,color:'#ef4444',width:5,arrowStyle:'curved',control:{x:50,y:200}}
test('curve bend handles invert the quadratic curve and filled geometry contains the curve, not the chord',()=>{
  const mid=arrowCurvePoint(curve,.5)
  assert.deepEqual(mid,{x:50,y:100});assert.deepEqual(controlFromBend(curve,mid.x,mid.y),curve.control)
  assert.equal(pointInArrow(curve,50,100),true);assert.equal(pointInArrow(curve,50,0),false)
  const geometry=arrowGeometry(curve)
  assert.ok(geometry.points.some(p=>p.x===100&&p.y===0));assert.ok(!/NaN|Infinity/.test(geometry.path))
  assert.ok(Number.isFinite(arrowControl({...curve,control:undefined}).x))
})
test('control points and callout targets translate, duplicate and crop with their annotations',()=>{
  const moved=translateAnnotation(curve,20,30);assert.deepEqual(moved.control,{x:70,y:230});assert.deepEqual(translateAnnotation(moved,-20,-30),curve)
  const copy=duplicateAnnotation(curve,'copy');copy.control.x=999;assert.equal(curve.control.x,50)
  const cropped=cropAnnotation(curve,{x:40,y:90,w:20,h:20});assert.ok(cropped);assert.deepEqual(cropped.control,{x:10,y:110})
  const bubble={id:'b',kind:'callout',x:0,y:0,w:80,h:40,text:'说明',color:'#2563eb',tail:{x:150,y:90}}
  assert.deepEqual(translateAnnotation(bubble,10,20).tail,{x:160,y:110})
  const croppedBubble=cropAnnotation(bubble,{x:140,y:80,w:30,h:30});assert.ok(croppedBubble);assert.deepEqual(croppedBubble.tail,{x:10,y:10});assert.equal(croppedBubble.w,80)
})
test('callout tails support all sides and targets inside the body hide the tail',()=>{
  const a={id:'b',kind:'callout',x:20,y:20,w:100,h:80,text:'说明',color:'#2563eb'}
  assert.deepEqual(calloutTail(a),{x:28,y:112})
  for(const tail of [{x:70,y:0},{x:140,y:60},{x:70,y:130},{x:0,y:60}]){const path=calloutPath({...a,tail});assert.ok(path.includes(`L${tail.x} ${tail.y}`));assert.ok(!/NaN|Infinity/.test(path))}
  assert.equal(calloutPath({...a,tail:{x:70,y:60}}).includes('L70 60'),false)
})
test('Shift constraints preserve line length and square proportions within image bounds',()=>{
  const p=snapEndpoint(0,0,100,80);assert.ok(Math.abs(p.x-p.y)<1e-8);assert.ok(Math.abs(Math.hypot(p.x,p.y)-Math.hypot(100,80))<1e-8)
  assert.deepEqual(snapEndpoint(10,10,99,30,{w:100,h:100}),{x:100,y:10})
  const clipped=snapEndpoint(90,90,120,115,{w:100,h:100});assert.ok(Math.abs(clipped.x-clipped.y)<1e-8);assert.ok(clipped.x<=100&&clipped.y<=100)
  assert.deepEqual(drawingRect(90,90,20,60,{w:100,h:100},true),{x:20,y:20,w:70,h:70})
  assert.deepEqual(drawingRect(90,90,200,200,{w:100,h:100},true),{x:90,y:90,w:10,h:10})
  assert.deepEqual(drawingRect(90,90,20,60,{w:100,h:100}),{x:20,y:60,w:70,h:30})
})
test('bounded stroke simplification retains endpoints, corners and source arrays',()=>{
  const input=Array.from({length:5000},(_,i)=>({x:i/2,y:Math.sin(i/10)*.2})),copy=structuredClone(input),reduced=simplifyStroke(input)
  assert.ok(reduced.length<100);assert.deepEqual(reduced[0],input[0]);assert.deepEqual(reduced.at(-1),input.at(-1));assert.deepEqual(input,copy)
  const corner=[{x:0,y:0},{x:10,y:0},{x:10,y:10}];assert.deepEqual(simplifyStroke(corner),corner)
  assert.match(freehandPath({points:corner,smoothed:true}),/Q/);assert.doesNotMatch(freehandPath({points:corner}),/Q/)
})
test('moving, resizing and adding lenses reuse the source, visible content changes invalidate it',()=>{
  const cache=createMagnifierSourceCache(),mark={id:'a',kind:'box',x:0,y:0,w:20,h:20,color:'#f00'},lens={id:'m',kind:'magnifier',x:0,y:0,w:30,h:30,zoom:2}
  const source=cache([mark,lens]);assert.equal(cache([mark,{...lens,x:100,zoom:3}]),source);assert.equal(cache([mark]),source)
  const next=cache([{...mark,color:'#00f'},lens]);assert.notEqual(next,source)
  assert.equal(cache([next[0],{...mark,id:'hidden',hidden:true},lens]),next)
  assert.deepEqual(cache([]),[])
})
