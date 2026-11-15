import { z } from 'zod'

const coordinate = z.number().finite()
const clamp = (n: number) => Math.min(1, Math.max(0, n))
const point = z.object({ x: coordinate, y: coordinate }).transform(p => ({ x: clamp(p.x), y: clamp(p.y) }))
const region = z.object({ x: coordinate, y: coordinate, w: coordinate.nonnegative(), h: coordinate.nonnegative() }).transform(r => {
  const x = clamp(r.x), y = clamp(r.y)
  return { x, y, w: Math.max(0, clamp(r.x + r.w) - x), h: Math.max(0, clamp(r.y + r.h) - y) }
})
const regions = z.array(region).max(200).transform(items => items.filter(r => r.w > .005 && r.h > .005))
const points = z.array(point).max(200).transform(items => items.slice(0, 12))
const annotation = z.object({ boxes: regions.transform(items => items.slice(0, 12)), points })
const mosaics = z.object({ regions: regions.transform(items => items.slice(0, 100)) })
const numbers = z.object({ points })
const privacy = z.object({ issues: z.array(z.object({ type: z.string().max(100).default('隐私信息'), reason: z.string().max(1000).default(''), region })).max(200) }).transform(data => data.issues.filter(i => i.region.w > .005 && i.region.h > .005).slice(0, 10))

function parseResponse<T>(raw: string, schema: z.ZodType<T>): T {
  if (raw.length > 256_000) throw new Error('AI 返回过长，请减少单次处理内容后重试')
  const start = raw.indexOf('{'), end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('AI 未返回有效 JSON，请重试')
  let value: unknown
  try { value = JSON.parse(raw.slice(start, end + 1)) } catch { throw new Error('AI 返回 JSON 格式错误，请重试') }
  const result = schema.safeParse(value)
  if (!result.success) throw new Error(`AI 返回数据不符合要求（${result.error.issues[0]?.path.join('.') || '结构'}），未应用结果`)
  return result.data
}

export const parseAIAnnotations = (raw: string) => parseResponse(raw, annotation)
export const parseAIMosaics = (raw: string) => parseResponse(raw, mosaics).regions
export const parseAINumbers = (raw: string) => parseResponse(raw, numbers).points
export const parseAIPrivacy = (raw: string) => parseResponse(raw, privacy)
export function parseAIContent(data: unknown): string {
  const result = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().trim().min(1).max(256_000) }) })).min(1).max(10) }).safeParse(data)
  if (!result.success) throw new Error('AI 接口响应格式错误或内容为空')
  return result.data.choices[0].message.content
}
