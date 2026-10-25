import type { AIConfig, Page, Rect } from '@/types'

const DEFAULT_DEMO = true

export function loadAIConfig(): AIConfig & { demo: boolean } {
  try {
    const raw = localStorage.getItem('mbz-ai-config')
    if (raw) return { ...JSON.parse(raw), demo: false }
  } catch {
    /* ignore */
  }
  return {
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKey: '',
    model: 'moonshot-v1-8k-vision-preview',
    demo: DEFAULT_DEMO,
  }
}

export function saveAIConfig(cfg: AIConfig & { demo: boolean }) {
  localStorage.setItem('mbz-ai-config', JSON.stringify(cfg))
}

interface ChatMessage {
  role: 'system' | 'user'
  content: string | { type: string; text?: string; image_url?: { url: string } }[]
}

const TIMEOUT_MS = 90000

class APIError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function chatOnce(config: AIConfig, messages: ChatMessage[], jsonMode: boolean): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  return fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.3,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: controller.signal,
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = (await res.text()).slice(0, 300)
        throw new APIError(res.status, `API 请求失败（${res.status}）：${body}`)
      }
      return res.json()
    })
    .then((data) => {
      const content = data?.choices?.[0]?.message?.content
      if (!content) throw new Error('API 返回为空')
      return typeof content === 'string' ? content : JSON.stringify(content)
    })
    .finally(() => clearTimeout(timer))
}

async function chat(config: AIConfig, messages: ChatMessage[], jsonMode: boolean): Promise<string> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await chatOnce(config, messages, jsonMode)
    } catch (err) {
      lastErr = err
      const retryable = err instanceof APIError && (err.status === 429 || err.status >= 500)
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      if (!retryable && !aborted) throw err
      if (attempt === 0) await new Promise((r) => setTimeout(r, 1500))
    }
  }
  if (lastErr instanceof DOMException && lastErr.name === 'AbortError') {
    throw new Error('API 请求超时（90 秒无响应），请检查接口连通性')
  }
  throw lastErr
}

function visionUser(text: string, image: string): ChatMessage {
  return {
    role: 'user',
    content: [
      { type: 'text', text },
      { type: 'image_url', image_url: { url: image } },
    ],
  }
}

function parseJSON<T>(raw: string): T {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error(`无法解析 AI 返回：${raw.slice(0, 120)}`)
  return JSON.parse(cleaned.slice(start, end + 1)) as T
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 生成本页说明时可携带的标注上下文（序号使用全局累计编号） */
function annotationContext(page: Page, numberStart: number): string {
  const numbers = page.annotations.filter((a) => a.kind === 'number')
  const boxes = page.annotations.filter((a) => a.kind === 'box' || a.kind === 'ellipse' || a.kind === 'highlight')
  const parts: string[] = []
  if (numbers.length) {
    const pos = numbers
      .map(
        (n, i) =>
          `序号${numberStart + i + 1}约在图中(${Math.round((n.x / page.width) * 100)}%, ${Math.round((n.y / page.height) * 100)}%)处`
      )
      .join('；')
    parts.push(
      `图中已有 ${numbers.length} 个红色序号标注，全局编号为 ${numberStart + 1} 到 ${numberStart + numbers.length}（${pos}）。说明文字必须与这些全局序号对应，引用格式如"点击②处按钮"，绝不能从 1 重新数起。`
    )
  }
  if (boxes.length) {
    parts.push(`图中另有 ${boxes.length} 个红框高亮区域，说明应围绕这些区域展开。`)
  }
  return parts.join('')
}

/** 为本页截图生成操作说明文字 */
export async function aiGenerateDescription(
  config: AIConfig & { demo: boolean },
  page: Page,
  index: number,
  total: number,
  prevNotes: string,
  numberStart = 0
): Promise<string> {
  if (config.demo || !config.apiKey) {
    const nums = page.annotations.filter((a) => a.kind === 'number').length
    return `（演示模式）第 ${index + 1} 步：${nums ? `按图中序号 ${numberStart + 1} 到 ${numberStart + nums} 的顺序操作，` : '在页面中找到标注位置，'}完成本步后进入下一步。配置 API Key 后，AI 将结合截图与标注生成真实说明。`
  }
  const text = [
    `这是活动参与流程明白纸的第 ${index + 1}/${total} 张界面截图，截图名称「${page.name}」。`,
    prevNotes ? `上一步的说明是：「${prevNotes}」。` : '这是流程的第一步。',
    annotationContext(page, numberStart),
    '请用简洁的中文写本步操作说明：1-3 句话、祈使句、面向普通用户、不要推测截图中看不到的信息。',
    '只输出说明文字本身，不要序号、标题或 Markdown。',
  ].join('')
  return (
    await chat(
      config,
      [
        {
          role: 'system',
          content:
            '你是制作活动参与流程"明白纸"的助手，擅长把界面截图改写成通俗的操作说明。',
        },
        visionUser(text, page.image),
      ],
      false
    )
  ).trim()
}

/** 路线 A：根据用户写好的步骤说明，识别需要框选的区域与依次操作的点位（归一化） */
export async function aiAnnotateFromDescription(
  config: AIConfig & { demo: boolean },
  page: Page,
  instructions: string
): Promise<{ boxes: Rect[]; points: { x: number; y: number }[] }> {
  if (config.demo || !config.apiKey) {
    return {
      boxes: [
        { x: 0.1, y: 0.32, w: 0.8, h: 0.12 },
        { x: 0.15, y: 0.6, w: 0.7, h: 0.1 },
      ],
      points: [
        { x: 0.5, y: 0.38 },
        { x: 0.5, y: 0.65 },
      ],
    }
  }
  const raw = await chat(
    config,
    [
      {
        role: 'system',
        content:
          '用户会给出某张界面截图对应的操作说明。你的任务：1) 在图中找出说明里用户需要点击/关注的界面元素；2) boxes 为建议高亮框选的区域，points 为用户依次操作的元素中心，points 的顺序必须与说明中的操作顺序一致。输出 JSON：{"boxes":[{"x":0~1,"y":0~1,"w":0~1,"h":0~1}],"points":[{"x":0~1,"y":0~1}]}，坐标为归一化比例。说明中在图里找不到的元素直接忽略，boxes 和 points 可以部分为空。只输出 JSON。',
      },
      visionUser(`操作说明：「${instructions}」\n请在这张截图上给出框选区域与操作点位。`, page.image),
    ],
    true
  )
  const data = parseJSON<{
    boxes?: { x: number; y: number; w: number; h: number }[]
    points?: { x: number; y: number }[]
  }>(raw)
  const boxes = (data.boxes ?? [])
    .map((b) => ({ x: clamp01(b.x), y: clamp01(b.y), w: clamp01(b.w), h: clamp01(b.h) }))
    .filter((b) => b.w > 0.005 && b.h > 0.005)
    .slice(0, 12)
  const points = (data.points ?? []).map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) })).slice(0, 12)
  return { boxes, points }
}

/** 识别需要打码的隐私区域，返回归一化矩形 */
export async function aiSuggestMosaics(
  config: AIConfig & { demo: boolean },
  page: Page
): Promise<Rect[]> {
  if (config.demo || !config.apiKey) {
    return [
      { x: 0.08, y: 0.12, w: 0.5, h: 0.06 },
      { x: 0.08, y: 0.22, w: 0.4, h: 0.06 },
    ]
  }
  const raw = await chat(
    config,
    [
      {
        role: 'system',
        content:
          '识别截图中需要脱敏打码的隐私信息区域：姓名、手机号、身份证号、银行卡号、地址、金额、二维码、头像昵称等。输出 JSON：{"regions":[{"x":0~1,"y":0~1,"w":0~1,"h":0~1}]}，坐标为相对截图的归一化比例，宁大勿小，没有则返回空数组。只输出 JSON。',
      },
      visionUser('请识别这张截图中所有需要打码的隐私区域。', page.image),
    ],
    true
  )
  const data = parseJSON<{ regions?: { x: number; y: number; w: number; h: number }[] }>(raw)
  return (data.regions ?? [])
    .map((r) => ({
      x: clamp01(r.x),
      y: clamp01(r.y),
      w: clamp01(r.w),
      h: clamp01(r.h),
    }))
    .filter((r) => r.w > 0.005 && r.h > 0.005)
}

/** AI 隐私扫描：找出截图中疑似需要打码但未被既有打码区域覆盖的隐私内容 */
export async function aiPrivacyScanPage(
  config: AIConfig & { demo: boolean },
  page: Page,
  existingMosaics: Rect[]
): Promise<{ type: string; reason: string; region: Rect }[]> {
  if (config.demo || !config.apiKey) {
    // 演示模式：没打码就提示一个示例问题
    return existingMosaics.length
      ? []
      : [{ type: '演示提示', reason: '（演示模式）配置 API Key 后，AI 将扫描真实隐私内容', region: { x: 0.05, y: 0.05, w: 0.3, h: 0.08 } }]
  }
  const mosaicDesc = existingMosaics.length
    ? `已有 ${existingMosaics.length} 个打码区域（归一化坐标）：${JSON.stringify(existingMosaics.map((r) => ({ x: +r.x.toFixed(3), y: +r.y.toFixed(3), w: +r.w.toFixed(3), h: +r.h.toFixed(3) })))}。已被这些区域完全覆盖的内容不要再报。`
    : '图中没有任何打码区域。'
  const raw = await chat(
    config,
    [
      {
        role: 'system',
        content:
          '你是隐私合规检查助手。检查截图中是否含有需要脱敏的隐私信息：姓名、手机号、身份证号、银行卡号、详细地址、金额余额、二维码、头像昵称、订单号等。' +
          '输出 JSON：{"issues":[{"type":"信息类型","reason":"一句话说明","region":{"x":0~1,"y":0~1,"w":0~1,"h":0~1}}]}，region 为该隐私内容的归一化包围盒。没有发现则返回空数组。只输出 JSON。',
      },
      visionUser(`请检查这张截图中所有需要打码的隐私内容。${mosaicDesc}`, page.image),
    ],
    true
  )
  const data = parseJSON<{ issues?: { type?: string; reason?: string; region?: { x: number; y: number; w: number; h: number } }[] }>(raw)
  return (data.issues ?? [])
    .filter((i) => i.region)
    .map((i) => ({
      type: String(i.type ?? '隐私信息'),
      reason: String(i.reason ?? ''),
      region: {
        x: clamp01(i.region!.x),
        y: clamp01(i.region!.y),
        w: clamp01(i.region!.w),
        h: clamp01(i.region!.h),
      },
    }))
    .slice(0, 10)
}

/** 识别关键操作元素，返回归一化标注点（按操作顺序） */
export async function aiSuggestNumbers(
  config: AIConfig & { demo: boolean },
  page: Page
): Promise<{ x: number; y: number }[]> {
  if (config.demo || !config.apiKey) {
    return [
      { x: 0.5, y: 0.42 },
      { x: 0.5, y: 0.62 },
      { x: 0.5, y: 0.82 },
    ]
  }
  const raw = await chat(
    config,
    [
      {
        role: 'system',
        content:
          '识别界面中用户需要依次关注/点击的关键操作元素（按钮、入口、输入框、开关等），按合理操作顺序给出标注点。输出 JSON：{"points":[{"x":0~1,"y":0~1}]}，坐标为元素中心、相对截图的归一化比例，一般 2-5 个点。只输出 JSON。',
      },
      visionUser('请按操作顺序给出这张截图需要标注序号的关键位置。', page.image),
    ],
    true
  )
  const data = parseJSON<{ points?: { x: number; y: number }[] }>(raw)
  return (data.points ?? [])
    .map((p) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
    .slice(0, 12)
}
