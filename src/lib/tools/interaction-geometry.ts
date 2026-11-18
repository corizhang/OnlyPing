export function snapEndpoint(x1:number,y1:number,x2:number,y2:number,bounds?:{w:number;h:number}){
  let length=Math.hypot(x2-x1,y2-y1)
  const angle=Math.round(Math.atan2(y2-y1,x2-x1)/(Math.PI/4))*Math.PI/4,dx=Math.cos(angle),dy=Math.sin(angle)
  if(bounds){if(Math.abs(dx)>1e-8)length=Math.min(length,Math.max(0,(dx>0?bounds.w-x1:-x1)/dx));if(Math.abs(dy)>1e-8)length=Math.min(length,Math.max(0,(dy>0?bounds.h-y1:-y1)/dy))}
  return {x:x1+dx*length,y:y1+dy*length}
}
export function drawingRect(sx:number,sy:number,x:number,y:number,bounds:{w:number;h:number},square=false){
  x=Math.max(0,Math.min(bounds.w,x));y=Math.max(0,Math.min(bounds.h,y))
  if(square){const dx=x<sx?-1:1,dy=y<sy?-1:1,size=Math.min(Math.max(Math.abs(x-sx),Math.abs(y-sy)),dx>0?bounds.w-sx:sx,dy>0?bounds.h-sy:sy);x=sx+dx*size;y=sy+dy*size}
  return {x:Math.min(sx,x),y:Math.min(sy,y),w:Math.abs(x-sx),h:Math.abs(y-sy)}
}
