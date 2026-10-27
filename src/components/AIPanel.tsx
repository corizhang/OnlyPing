import { useState } from 'react'
import { Box, CheckCircle2, CircleAlert, FileText, Hash, Info, RotateCcw, ShieldCheck, Settings, Sparkles, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import type { AIConfig, Annotation, Page } from '@/types'
import { uid, computeNumberStarts } from '@/types'
import { aiAnnotateFromDescription, aiGenerateDescription, aiSuggestMosaics, aiSuggestNumbers, saveAIConfig } from '@/lib/ai'
import { preparePageForAI } from '@/lib/render'

interface Props {
  config: AIConfig & { demo: boolean }
  onConfigChange: (cfg: AIConfig & { demo: boolean }) => void
  pages: Page[]
  selectedPageId: string | null
  onUpdatePage: (id: string, patch: Partial<Page>, expected: Page) => void
}

export default function AIPanel({ config, onConfigChange, pages, selectedPageId, onUpdatePage }: Props) {
  const [status, setStatus] = useState<{ kind: 'info' | 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState(config)
  const [privacy, setPrivacy] = useState(() => localStorage.getItem('mbz-privacy') !== '0')

  const selectedPage = pages.find((p) => p.id === selectedPageId) ?? null

  /** 隐私模式：AI 调用前先应用本地已有的打码标注，并重编码图片（去除元数据） */
  const redactForAI = (page: Page): Promise<Page> => preparePageForAI(page, privacy)

  const run = async (key: string, fn: () => Promise<string>) => {
    setBusy(key)
    setStatus(null)
    try {
      const msg = await fn()
      setStatus({ kind: 'ok', text: msg })
    } catch (err) {
      setStatus({ kind: 'err', text: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(null)
    }
  }

  const genDesc = (page: Page, index: number) =>
    run(`desc-${page.id}`, async () => {
      const prev = index > 0 ? pages[index - 1].notes : ''
      const numberStart = computeNumberStarts(pages).get(page.id) ?? 0
      const text = await aiGenerateDescription(config, await redactForAI(page), index, pages.length, prev, numberStart)
      onUpdatePage(page.id, { notes: text }, page)
      return `已根据标注生成「${page.name}」的说明文字，请检查是否与序号对应`
    })

  // 路线 A：先写说明，AI 按说明框选 + 标序号
  const buildAnnotate = async (page: Page, notes: string) => {
    const res = await aiAnnotateFromDescription(config, await redactForAI(page), notes)
    const anns: Annotation[] = [
        ...res.boxes.map((b) => ({
          id: uid(),
          kind: 'box' as const,
          x: b.x * page.width,
          y: b.y * page.height,
          w: b.w * page.width,
          h: b.h * page.height,
          color: '#ef4444',
        })),
        ...res.points.map((p) => ({
          id: uid(),
          kind: 'number' as const,
          x: p.x * page.width,
          y: p.y * page.height,
        })),
      ]
      return { res, anns }
  }

  const genAnnotateFromNotes = (page: Page) =>
    run(`ann-${page.id}`, async () => {
      if (!page.notes.trim()) throw new Error('请先在下方「本页说明文字」中写清楚本步要点，再让 AI 标注')
      const { res, anns } = await buildAnnotate(page, page.notes)
      if (!anns.length)
        return `未能根据说明在「${page.name}」中识别到对应元素，可补充更具体的描述后重试`
      onUpdatePage(page.id, { annotations: [...page.annotations, ...anns] }, page)
      return `已按说明在「${page.name}」添加 ${res.boxes.length} 个画框、${res.points.length} 个序号（全局累计编号），请检查后微调`
    })

  // 批量任务：单页失败不中断，收集失败页供一键重试
  const [failures, setFailures] = useState<{ pages: Page[]; job: 'desc' | 'ann' } | null>(null)

  const runDescBatch = (targets: Page[], key: string) =>
    run(key, async () => {
      const starts = computeNumberStarts(pages)
      const failed: Page[] = []
      for (let k = 0; k < targets.length; k++) {
        const page = targets[k]
        setStatus({ kind: 'info', text: `正在生成说明 ${k + 1}/${targets.length}：${page.name} …` })
        try {
          const i = pages.indexOf(page)
          const prev = i > 0 ? pages[i - 1].notes : ''
          const text = await aiGenerateDescription(
            config,
            await redactForAI(page),
            i,
            pages.length,
            prev,
            starts.get(page.id) ?? 0
          )
          onUpdatePage(page.id, { notes: text }, page)
        } catch {
          failed.push(page)
        }
      }
      if (failed.length) {
        setFailures({ pages: failed, job: 'desc' })
        return `完成 ${targets.length - failed.length}/${targets.length} 页，${failed.length} 页失败，可点击「重试失败页」`
      }
      setFailures(null)
      return `全部 ${targets.length} 页说明生成完成`
    })

  const runAnnBatch = (targets: Page[], key: string) =>
    run(key, async () => {
      const failed: Page[] = []
      for (let k = 0; k < targets.length; k++) {
        const page = targets[k]
        setStatus({ kind: 'info', text: `正在按说明标注 ${k + 1}/${targets.length}：${page.name} …` })
        try {
          const { anns } = await buildAnnotate(page, page.notes)
          if (anns.length) onUpdatePage(page.id, { annotations: [...page.annotations, ...anns] }, page)
        } catch {
          failed.push(page)
        }
      }
      if (failed.length) {
        setFailures({ pages: failed, job: 'ann' })
        return `完成 ${targets.length - failed.length}/${targets.length} 页，${failed.length} 页失败，可点击「重试失败页」`
      }
      setFailures(null)
      return `全部 ${targets.length} 页标注完成，请逐页检查微调`
    })

  const runAll = () => runDescBatch(pages, 'all')

  const runAllAnnotate = () => runAnnBatch(pages.filter((p) => p.notes.trim()), 'ann-all')

  const retryFailed = () => {
    if (!failures || busy) return
    const f = failures
    setFailures(null)
    if (f.job === 'desc') runDescBatch(f.pages, 'retry')
    else runAnnBatch(f.pages, 'retry')
  }

  const genMosaics = (page: Page) =>
    run(`mosaic-${page.id}`, async () => {
      const regions = await aiSuggestMosaics(config, await redactForAI(page))
      if (!regions.length) return `「${page.name}」未识别到需要打码的区域`
      const anns: Annotation[] = regions.map((r) => ({
        id: uid(),
        kind: 'mosaic',
        x: r.x * page.width,
        y: r.y * page.height,
        w: r.w * page.width,
        h: r.h * page.height,
      }))
      onUpdatePage(page.id, { annotations: [...page.annotations, ...anns] }, page)
      return `已在「${page.name}」添加 ${anns.length} 个打码区域，请检查后微调`
    })

  const genNumbers = (page: Page) =>
    run(`num-${page.id}`, async () => {
      const points = await aiSuggestNumbers(config, await redactForAI(page))
      if (!points.length) return `「${page.name}」未识别到关键操作位置`
      const anns: Annotation[] = points.map((p) => ({
        id: uid(),
        kind: 'number',
        x: p.x * page.width,
        y: p.y * page.height,
      }))
      onUpdatePage(page.id, { annotations: [...page.annotations, ...anns] }, page)
      return `已在「${page.name}」添加 ${anns.length} 个序号标注，可拖动调整位置`
    })

  return (
    <aside className="flex h-full min-h-0 w-full flex-col bg-card">
      <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
        <div className="flex items-center gap-2.5">
          <WandSparkles className="size-4 text-muted-foreground" />
          <div>
            <div className="text-sm font-semibold tracking-tight text-foreground">智能辅助</div>
            <div className="text-[10px] text-muted-foreground">标注与步骤说明</div>
          </div>
          <Badge variant="outline" className="ml-1 rounded-sm px-1.5 py-0 text-[10px] font-normal text-muted-foreground">
            {config.demo ? '演示' : '已连接'}
          </Badge>
        </div>
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="ghost" size="icon" title="API 配置">
              <Settings className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>AI 接口配置</DialogTitle>
              <DialogDescription>
                支持任意 OpenAI 兼容的多模态接口（如 Moonshot/Kimi）。未配置时使用演示模式，生成示例内容。
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label>接口地址</Label>
                <Input
                  value={draft.baseUrl}
                  onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
                  placeholder="https://api.moonshot.cn/v1"
                />
              </div>
              <div className="space-y-1">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={draft.apiKey}
                  onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>
              <div className="space-y-1">
                <Label>视觉模型</Label>
                <Input
                  value={draft.model}
                  onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                  placeholder="moonshot-v1-8k-vision-preview"
                />
              </div>
              <Button
                className="w-full"
                onClick={() => {
                  const next = { ...draft, demo: !draft.apiKey }
                  saveAIConfig(next)
                  onConfigChange(next)
                }}
              >
                保存配置
              </Button>
              {config.demo && (
                <p className="text-xs text-amber-600">
                  当前为演示模式：AI 功能生成示例内容。填写 API Key 后转为真实生成。
                </p>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {config.demo && (
          <div className="flex gap-2 border-b pb-3 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>演示模式会生成示例内容。配置视觉模型后即可分析真实截图。</span>
          </div>
        )}
        {!config.demo && (
          <div className="flex gap-2 border-b pb-3 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>截图将发送至已配置的 AI 接口。已有马赛克和实色遮挡始终在本地应用后发送。</span>
          </div>
        )}

        <div className="flex items-start justify-between gap-3 border-b pb-4">
          <div className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div>
              <div className="text-xs font-semibold text-foreground">隐私模式</div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                开启后发送完整标注图；关闭时仍保留马赛克和实色遮挡。
              </p>
            </div>
          </div>
          <Switch
            aria-label="隐私模式"
            checked={privacy}
            onCheckedChange={(checked) => {
              setPrivacy(checked)
              localStorage.setItem('mbz-privacy', checked ? '1' : '0')
            }}
          />
        </div>

        <div className="space-y-2.5">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold text-foreground">按说明生成标注</div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            根据本页说明，在截图中定位操作区域并添加序号。
          </p>
          <Button
            className="w-full justify-start gap-2"
            disabled={!selectedPage || !!busy}
            onClick={() => selectedPage && genAnnotateFromNotes(selectedPage)}
          >
            <Box className="h-4 w-4" />
            {busy === `ann-${selectedPage?.id}` ? '识别中…' : '生成本页标注'}
          </Button>
          <Button
            className="w-full justify-start gap-2"
            variant="outline"
            disabled={!pages.length || !!busy}
            onClick={runAllAnnotate}
          >
            <Sparkles className="h-4 w-4" />
            {busy === 'ann-all' ? '批量标注中…' : '按说明标注全部页面'}
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold text-foreground">根据标注生成说明</div>
          </div>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            整理当前页的标注内容，生成与序号对应的步骤说明。
          </p>
          <Button
            className="w-full justify-start gap-2"
            variant="outline"
            disabled={!selectedPage || !!busy}
            onClick={() => selectedPage && genDesc(selectedPage, pages.indexOf(selectedPage))}
          >
            <FileText className="h-4 w-4" />
            {busy === `desc-${selectedPage?.id}` ? '生成中…' : '根据标注生成本页说明'}
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="text-xs font-semibold text-foreground">标注辅助</div>
          <Button
            className="w-full justify-start gap-2"
            variant="outline"
            disabled={!selectedPage || !!busy}
            onClick={() => selectedPage && genMosaics(selectedPage)}
          >
            <ShieldCheck className="h-4 w-4" />
            {busy === `mosaic-${selectedPage?.id}` ? '识别中…' : '智能打码建议'}
          </Button>
          <Button
            className="w-full justify-start gap-2"
            variant="outline"
            disabled={!selectedPage || !!busy}
            onClick={() => selectedPage && genNumbers(selectedPage)}
          >
            <Hash className="h-4 w-4" />
            {busy === `num-${selectedPage?.id}` ? '识别中…' : '自动标注序号'}
          </Button>
        </div>

        <Separator />

        <div className="space-y-2">
          <div className="text-xs font-semibold text-foreground">批量生成说明</div>
          <Button
            className="w-full justify-start gap-2"
            disabled={!pages.length || !!busy}
            onClick={runAll}
          >
            <Sparkles className="h-4 w-4" />
            {busy === 'all' ? '处理中…' : `生成全部 ${pages.length} 页说明`}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">
            按页面顺序生成，并参考前一页的说明保持连贯。
          </p>
          {failures && !busy && (
            <Button
              className="w-full justify-start gap-2"
              variant="outline"
              onClick={retryFailed}
            >
              <RotateCcw className="h-4 w-4" />
              重试失败页（{failures.pages.length}）：{failures.pages.map((p) => p.name).slice(0, 2).join('、')}
              {failures.pages.length > 2 ? ' 等' : ''}
            </Button>
          )}
        </div>

        {status && (
          <div
            role="status"
            className={`flex items-start gap-2 border-l-2 px-3 py-2 text-xs leading-relaxed ${
              status.kind === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : status.kind === 'err'
                  ? 'border-destructive/20 bg-destructive/5 text-destructive'
                  : 'border-border bg-muted/50 text-muted-foreground'
            }`}
          >
            {status.kind === 'ok' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : status.kind === 'err' ? <CircleAlert className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
            {status.text}
          </div>
        )}
      </div>
    </aside>
  )
}
