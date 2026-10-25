import { useEffect, useRef, useState } from 'react'
import {
  Box,
  Circle,
  Highlighter,
  EyeOff,
  TextCursorInput,
  Minus,
  Pencil,
  MessageSquareQuote,
  Search,
  Download,
  Eye,
  FileDown,
  Image as ImageIcon,
  MousePointer2,
  ShieldCheck,
  Type,
  Hash,
  ZoomIn,
  ZoomOut,
  Crop,
  RotateCcw,
  Undo2,
  Redo2,
  Palette,
  Trash2,
  ArrowUpRight,
  ListChecks,
  ShieldAlert,
  CircleAlert,
  Info,
  BookOpen,
  Save,
  FolderOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import AIPanel from '@/components/AIPanel'
import CanvasEditor from '@/components/CanvasEditor'
import ExportPreview from '@/components/ExportPreview'
import PageList from '@/components/PageList'
import { loadAIConfig } from '@/lib/ai'
import { aiPrivacyScanPage } from '@/lib/ai'
import { rectCoverage, runConsistencyChecks, type CheckIssue } from '@/lib/check'
import { idbGet, idbSet, validateAutosave } from '@/lib/db'
import { filesToPages } from '@/lib/import'
import { exportDocx, exportLongImage, exportPdf } from '@/lib/exporters'
import { downloadPageImage, loadImage, preparePageForAI } from '@/lib/render'
import type { Annotation, AnnotationStyle, ExportFooter, ExportStyle, Page, Rect, StylePreset, Tool } from '@/types'
import { ARROW_DEFAULT_WIDTH, computeNumberStarts, DEFAULT_ANNOTATION_STYLE, DEFAULT_EXPORT_FOOTER, DEFAULT_EXPORT_STYLE, MOSAIC_DEFAULT_TILE, MOSAIC_MAX_TILE, MOSAIC_MIN_TILE, uid } from '@/types'

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#2563eb', '#7c3aed', '#111827']
const TOOL_SHORTCUTS: Record<string, Tool> = {
  v: 'select',
  b: 'box',
  n: 'number',
  a: 'arrow',
  m: 'mosaic',
  t: 'text',
  e: 'ellipse',
  h: 'highlight',
  r: 'redact',
  g: 'text-box',
  l: 'line',
  p: 'freehand',
  q: 'callout',
  z: 'magnifier',
  c: 'crop',
}

/** 从 localStorage 读取并校验 JSON，损坏时返回 null */
const loadJSON = <T,>(key: string, guard: (v: unknown) => v is T): T | null => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const v: unknown = JSON.parse(raw)
    return guard(v) ? v : null
  } catch {
    return null
  }
}

const isStyle = (v: unknown): v is AnnotationStyle => {
  const s = v as AnnotationStyle
  return (
    !!s &&
    typeof s.color === 'string' &&
    typeof s.numberR === 'number' &&
    typeof s.textSize === 'number' &&
    typeof s.mosaicTile === 'number'
  )
}

const isPreset = (v: unknown): v is StylePreset => {
  const p = v as StylePreset
  return !!p && typeof p.id === 'string' && typeof p.name === 'string' && isStyle(p)
}

const isPresetArray = (v: unknown): v is StylePreset[] => Array.isArray(v) && v.every(isPreset)

/** 项目健康状态指纹：标题、页脚单位、各页标注数与说明有无。任一变化即视为"已过期需复查" */
const checkSignature = (t: string, pgs: Page[], f: ExportFooter) =>
  `${t}|${f.org}|${pgs.map((p) => `${p.id}:${p.annotations.length}:${p.notes.trim() ? 1 : 0}`).join(',')}`

export default function Home() {
  const [title, setTitle] = useState('活动参与流程明白纸')
  const projectFileRef = useRef<HTMLInputElement>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  // 新建标注的默认样式（用户级偏好，持久化到 localStorage）
  const [annStyle, setAnnStyle] = useState<AnnotationStyle>(
    () => loadJSON('mbz-ann-style', isStyle) ?? DEFAULT_ANNOTATION_STYLE
  )
  // 标注样式预设（用户级，跨项目复用）
  const [presets, setPresets] = useState<StylePreset[]>(
    () => loadJSON('mbz-style-presets', isPresetArray) ?? []
  )
  const [presetName, setPresetName] = useState('')
  const color = annStyle.color
  const setColor = (c: string) => setAnnStyle((s) => ({ ...s, color: c }))
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null)
  const [aiConfig, setAIConfig] = useState(loadAIConfig())
  const [exporting, setExporting] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [exportStyle, setExportStyle] = useState<ExportStyle>(DEFAULT_EXPORT_STYLE)
  const [exportFooter, setExportFooter] = useState<ExportFooter>(DEFAULT_EXPORT_FOOTER)
  const [saveNote, setSaveNote] = useState('')
  const [storageReady, setStorageReady] = useState(false)
  // 一致性检查
  const [issues, setIssues] = useState<CheckIssue[]>([])
  const [checkOpen, setCheckOpen] = useState(false)
  const [aiScanning, setAiScanning] = useState(false)
  const [aiScanProgress, setAiScanProgress] = useState('')
  // 上次检查时的项目指纹（null = 尚未检查）；不一致则状态灯提示需复查
  const [checkSig, setCheckSig] = useState<string | null>(null)
  // 导出前自动运行 AI 隐私扫描（用户级偏好）
  const [autoAiScan, setAutoAiScan] = useState(() => localStorage.getItem('mbz-auto-ai-scan') === '1')

  useEffect(() => {
    localStorage.setItem('mbz-auto-ai-scan', autoAiScan ? '1' : '0')
  }, [autoAiScan])

  // 撤销/重做：快照式历史，连续微调（拖拽、打字）按 400ms 合并为一步
  const undoStack = useRef<Page[][]>([])
  const redoStack = useRef<Page[][]>([])
  const lastHistoryAt = useRef(0)
  const pagesRef = useRef<Page[]>([])
  const HISTORY_LIMIT = 50

  useEffect(() => {
    pagesRef.current = pages
  }, [pages])

  const commitPages = (next: Page[] | ((prev: Page[]) => Page[]), coalesce = false) => {
    const current = pagesRef.current
    const resolved = typeof next === 'function' ? next(current) : next
    if (resolved === current) return
    const now = Date.now()
    if (!(coalesce && now - lastHistoryAt.current < 400)) {
      undoStack.current.push(current)
      if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift()
      redoStack.current = []
    }
    lastHistoryAt.current = now
    pagesRef.current = resolved
    setPages(resolved)
  }

  const undo = () => {
    const prev = undoStack.current.pop()
    if (!prev) return
    redoStack.current.push(pagesRef.current)
    pagesRef.current = prev
    setPages(prev)
    if (selectedPageId && !prev.some((p) => p.id === selectedPageId)) {
      setSelectedPageId(prev[0]?.id ?? null)
    }
    setSelectedAnnId(null)
  }

  const redo = () => {
    const next = redoStack.current.pop()
    if (!next) return
    undoStack.current.push(pagesRef.current)
    pagesRef.current = next
    setPages(next)
    if (selectedPageId && !next.some((p) => p.id === selectedPageId)) {
      setSelectedPageId(next[0]?.id ?? null)
    }
    setSelectedAnnId(null)
  }

  // 启动时从 IndexedDB 恢复自动存档（含结构校验）；兼容迁移旧的 localStorage 存档
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const data = await idbGet<unknown>()
        const restored = validateAutosave(data)
        if (cancelled) return
        if (restored) {
          setTitle(restored.title ?? '明白纸')
          setPages(restored.pages)
          setExportStyle(restored.exportStyle ?? DEFAULT_EXPORT_STYLE)
          setExportFooter(restored.exportFooter ?? DEFAULT_EXPORT_FOOTER)
          setSelectedPageId(restored.pages[0].id)
          setSaveNote(
            restored.savedAt
              ? `已恢复 ${new Date(restored.savedAt).toLocaleTimeString()} 的自动保存`
              : '已恢复上次的自动保存'
          )
          setStorageReady(true)
          return
        }
        // 迁移旧的 localStorage 存档
        const raw = localStorage.getItem('mbz-autosave')
        if (raw) {
          const legacy = validateAutosave(JSON.parse(raw))
          if (legacy) {
            setTitle(legacy.title ?? '明白纸')
            setPages(legacy.pages)
            setExportStyle(legacy.exportStyle ?? DEFAULT_EXPORT_STYLE)
            setExportFooter(legacy.exportFooter ?? DEFAULT_EXPORT_FOOTER)
            setSelectedPageId(legacy.pages[0].id)
            setSaveNote('已从旧版存储恢复项目')
          } else {
            setSaveNote('检测到旧版存档但数据损坏，未能恢复')
          }
          localStorage.removeItem('mbz-autosave')
        }
        setStorageReady(true)
      } catch {
        if (!cancelled) {
          setSaveNote('读取自动存档失败')
          setStorageReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  // 一致性检查
  const runChecks = () => {
    setIssues(runConsistencyChecks(title, pages, exportFooter))
    setCheckSig(checkSignature(title, pages, exportFooter))
    setCheckOpen(true)
  }

  const locateIssue = (issue: CheckIssue) => {
    if (issue.pageId) {
      setSelectedPageId(issue.pageId)
      setSelectedAnnId(null)
    }
    setCheckOpen(false)
  }

  // AI 隐私扫描核心：逐页识别疑似未打码的隐私内容（已有打码覆盖 ≥50% 的自动跳过）
  const collectAiPrivacyIssues = async (): Promise<CheckIssue[]> => {
    const found: CheckIssue[] = []
    const privacyMode = localStorage.getItem('mbz-privacy') === '1'
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]
      setAiScanProgress(`正在扫描 ${i + 1}/${pages.length} 页…`)
      try {
        const mosaics = p.annotations
          .filter((a) => a.kind === 'mosaic')
          .map((a) => ({ x: a.x / p.width, y: a.y / p.height, w: a.w / p.width, h: a.h / p.height }))
        const pageForAI = await preparePageForAI(p, privacyMode)
        const results = await aiPrivacyScanPage(aiConfig, pageForAI, mosaics)
        for (const r of results) {
          if (rectCoverage(r.region, mosaics) >= 0.5) continue
          found.push({
            severity: 'warn',
            category: '隐私',
            pageId: p.id,
            pageName: p.name,
            message: `第 ${i + 1} 页「${p.name}」疑似有未打码的${r.type}${r.reason ? `：${r.reason}` : ''}`,
          })
        }
      } catch (err) {
        found.push({
          severity: 'info',
          category: '隐私',
          pageId: p.id,
          pageName: p.name,
          message: `第 ${i + 1} 页扫描失败：${err instanceof Error ? err.message : '未知错误'}`,
        })
      }
    }
    return found
  }

  const runAIPrivacyScan = async () => {
    if (aiScanning || !pages.length) return
    setAiScanning(true)
    setAiScanProgress('')
    const found = await collectAiPrivacyIssues()
    setAiScanning(false)
    setAiScanProgress('')
    setIssues((prev) => [...prev.filter((i) => i.category !== '隐私'), ...found])
  }

  // 标注样式与预设持久化到 localStorage（用户级偏好）
  useEffect(() => {
    localStorage.setItem('mbz-ann-style', JSON.stringify(annStyle))
  }, [annStyle])
  useEffect(() => {
    localStorage.setItem('mbz-style-presets', JSON.stringify(presets))
  }, [presets])

  // 把当前样式套用到所有页面的已有标注（可撤销）
  const applyStyleToAll = () => {
    if (!pages.length) return
    commitPages((prev) =>
      prev.map((p) => ({
        ...p,
        annotations: p.annotations.map((a) => {
          if (a.kind === 'box' || a.kind === 'ellipse' || a.kind === 'highlight' || a.kind === 'line' || a.kind === 'freehand' || a.kind === 'callout') return { ...a, color: annStyle.color }
          if (a.kind === 'text') return { ...a, color: annStyle.color, size: annStyle.textSize }
          if (a.kind === 'number') return { ...a, r: annStyle.numberR }
          if (a.kind === 'mosaic') return { ...a, tile: annStyle.mosaicTile }
          return a
        }),
      }))
    )
  }

  const savePreset = () => {
    const name = presetName.trim()
    if (!name) return
    setPresets((prev) => [...prev, { id: uid(), name, ...annStyle }])
    setPresetName('')
  }

  const applyPreset = (p: StylePreset) => {
    setAnnStyle({ color: p.color, numberR: p.numberR, textSize: p.textSize, mosaicTile: p.mosaicTile })
  }

  const deletePreset = (id: string) => setPresets((prev) => prev.filter((p) => p.id !== id))

  // 内容变更后短暂防抖保存，另有定时与页面隐藏时保存作为兜底。
  useEffect(() => {
    if (!storageReady) return
    const save = () => {
      idbSet({ title, pages, exportStyle, exportFooter, savedAt: Date.now() })
        .then(() => setSaveNote(`已自动保存 ${new Date().toLocaleTimeString()}`))
        .catch(() => setSaveNote('自动保存失败（存储空间不足），请用「保存项目」导出 JSON'))
    }
    const debounce = setTimeout(save, 1000)
    const timer = setInterval(save, 30000)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') save()
    }
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (pages.length) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      clearTimeout(debounce)
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [title, pages, exportStyle, exportFooter, storageReady])

  // Ctrl+Z / Ctrl+Y 撤销重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const editing = !!target && (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
        target.isContentEditable ||
        !!target.closest('[role="textbox"]')
      )
      if (editing) return
      const key = e.key.toLowerCase()
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
        } else if (key === 'y') {
          e.preventDefault()
          redo()
        }
        return
      }
      if (e.altKey || e.shiftKey || e.repeat) return
      const nextTool = TOOL_SHORTCUTS[key]
      if (nextTool) {
        e.preventDefault()
        setTool(nextTool)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Ctrl+V 粘贴截图导入（导入时已去除 EXIF 元数据）
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (!e.clipboardData?.files?.length) return
      e.preventDefault()
      void importFiles(e.clipboardData.files)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const importDropped = (e: React.DragEvent) => {
    e.preventDefault()
    if (!e.dataTransfer.files?.length) return
    void importFiles(e.dataTransfer.files)
  }

  const selectedPage = pages.find((p) => p.id === selectedPageId) ?? null
  const numberStarts = computeNumberStarts(pages)
  const selectedAnn = selectedPage?.annotations.find((a) => a.id === selectedAnnId) ?? null

  const updateAnnSize = (patch: { size?: number; r?: number; tile?: number; width?: number; zoom?: number }) => {
    if (!selectedPage || !selectedAnnId) return
    updatePage(selectedPage.id, {
      annotations: selectedPage.annotations.map((a) =>
        a.id === selectedAnnId ? ({ ...a, ...patch } as typeof a) : a
      ),
    })
  }

  const updatePage = (id: string, patch: Partial<Page>, coalesce = false) =>
    commitPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)), coalesce)

  const addPages = (newPages: Page[]) => {
    commitPages((prev) => [...prev, ...newPages])
    if (!selectedPageId && newPages.length) setSelectedPageId(newPages[0].id)
  }

  const importFiles = async (files: Iterable<File>) => {
    const result = await filesToPages(files)
    if (result.pages.length) addPages(result.pages)
    if (result.failures.length) {
      const details = result.failures.slice(0, 3).map((f) => `${f.name}：${f.reason}`).join('\n')
      const rest = result.failures.length > 3 ? `\n另有 ${result.failures.length - 3} 个文件失败` : ''
      toast.error(`成功导入 ${result.pages.length} 张，${result.failures.length} 张图片读取失败`, {
        description: `${details}${rest}`,
        duration: 10000,
      })
    }
    if (result.skipped.length) {
      const names = result.skipped.slice(0, 3).join('、')
      const details = result.skipped.length > 3
        ? `${names}等 ${result.skipped.length} 个非图片文件`
        : `${names}：不是图片文件`
      toast.warning(`已跳过 ${result.skipped.length} 个文件`, { description: details, duration: 8000 })
    }
  }

  const movePage = (id: string, dir: -1 | 1) => {
    commitPages((prev) => {
      const i = prev.findIndex((p) => p.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  const removePage = (id: string) => {
    commitPages((prev) => prev.filter((p) => p.id !== id))
    if (selectedPageId === id) setSelectedPageId(null)
  }

  // 裁剪：图片裁为选区，标注坐标平移/裁剪，首次裁剪保留原图快照
  const shiftForCrop = (a: Annotation, r: Rect): Annotation | null => {
    if (a.kind === 'number' || a.kind === 'text') {
      const nx = a.x - r.x
      const ny = a.y - r.y
      if (nx < -40 || ny < -40 || nx > r.w + 40 || ny > r.h + 40) return null
      return { ...a, x: nx, y: ny }
    }
    if (a.kind === 'arrow' || a.kind === 'line') {
      const inside = (px: number, py: number) =>
        px >= r.x - 40 && py >= r.y - 40 && px <= r.x + r.w + 40 && py <= r.y + r.h + 40
      if (!inside(a.x1, a.y1) && !inside(a.x2, a.y2)) return null
      return { ...a, x1: a.x1 - r.x, y1: a.y1 - r.y, x2: a.x2 - r.x, y2: a.y2 - r.y }
    }
    if (a.kind === 'freehand') {
      const xs = a.points.map((p) => p.x)
      const ys = a.points.map((p) => p.y)
      if (Math.max(...xs) < r.x || Math.min(...xs) > r.x + r.w || Math.max(...ys) < r.y || Math.min(...ys) > r.y + r.h) return null
      return { ...a, points: a.points.map((p) => ({ x: p.x - r.x, y: p.y - r.y })) }
    }
    const x1 = Math.max(a.x, r.x)
    const y1 = Math.max(a.y, r.y)
    const x2 = Math.min(a.x + a.w, r.x + r.w)
    const y2 = Math.min(a.y + a.h, r.y + r.h)
    if (x2 - x1 < 8 || y2 - y1 < 8) return null
    return { ...a, x: x1 - r.x, y: y1 - r.y, w: x2 - x1, h: y2 - y1 }
  }

  const applyCrop = async (page: Page, rect: Rect) => {
    const img = await loadImage(page.image)
    const w = Math.round(rect.w)
    const h = Math.round(rect.h)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    canvas.getContext('2d')!.drawImage(img, Math.round(rect.x), Math.round(rect.y), w, h, 0, 0, w, h)
    updatePage(page.id, {
      image: canvas.toDataURL('image/png'),
      width: w,
      height: h,
      annotations: page.annotations
        .map((a) => shiftForCrop(a, rect))
        .filter((a): a is Annotation => !!a),
      orig: page.orig ?? {
        image: page.image,
        width: page.width,
        height: page.height,
        annotations: page.annotations,
      },
    })
  }

  const restoreCrop = (page: Page) => {
    if (!page.orig) return
    updatePage(page.id, {
      image: page.orig.image,
      width: page.orig.width,
      height: page.orig.height,
      annotations: page.orig.annotations,
    })
  }

  const doExport = async (kind: 'docx' | 'pdf' | 'long' | 'page') => {
    // 整份导出前先跑全量检查：确定性检查 +（可选）AI 隐私扫描；有警告需用户确认
    if (kind !== 'page') {
      const found = runConsistencyChecks(title, pages, exportFooter)
      let all = found
      if (autoAiScan && (aiConfig.apiKey || aiConfig.demo) && pages.length) {
        setAiScanning(true)
        setAiScanProgress('')
        try {
          all = [...found, ...(await collectAiPrivacyIssues())]
        } finally {
          setAiScanning(false)
          setAiScanProgress('')
        }
      }
      setIssues(all)
      setCheckSig(checkSignature(title, pages, exportFooter))
      const warns = all.filter((i) => i.severity === 'warn')
      if (warns.length) {
        const brief = warns
          .slice(0, 3)
          .map((w) => `· ${w.message}`)
          .join('\n')
        const ok = window.confirm(
          `导出前检查发现 ${warns.length} 项警告：\n${brief}${warns.length > 3 ? '\n…' : ''}\n\n建议先修正再导出，仍要导出吗？`
        )
        if (!ok) {
          setCheckOpen(true)
          return
        }
      }
    }
    setExporting(true)
    try {
      if (kind === 'docx') await exportDocx(title, pages, exportStyle, exportFooter)
      else if (kind === 'pdf') await exportPdf(title, pages, exportStyle, exportFooter)
      else if (kind === 'long') await exportLongImage(title, pages, exportStyle, exportFooter)
      else if (selectedPage) await downloadPageImage(selectedPage, numberStarts.get(selectedPage.id) ?? 0)
    } finally {
      setExporting(false)
    }
  }

  const saveProject = () => {
    const blob = new Blob([JSON.stringify({ title, pages, exportStyle, exportFooter }, null, 2)], {
      type: 'application/json',
    })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${title || '明白纸项目'}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }

  const loadProject = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result))
        const validated = validateAutosave(data)
        if (!validated) {
          alert('项目文件损坏或格式不正确')
          return
        }
        commitPages(validated.pages)
        setTitle(validated.title ?? '明白纸')
        setExportStyle(validated.exportStyle ?? DEFAULT_EXPORT_STYLE)
        setExportFooter(validated.exportFooter ?? DEFAULT_EXPORT_FOOTER)
        setSelectedPageId(validated.pages[0]?.id ?? null)
      } catch {
        alert('项目文件解析失败')
      }
    }
    reader.readAsText(file)
  }

  const TOOLS: { value: Tool; icon: React.ReactNode; label: string; shortcut: string }[] = [
    { value: 'select', icon: <MousePointer2 className="h-4 w-4" />, label: '选择/移动', shortcut: 'V' },
    { value: 'box', icon: <Box className="h-4 w-4" />, label: '画框', shortcut: 'B' },
    { value: 'ellipse', icon: <Circle className="h-4 w-4" />, label: '椭圆', shortcut: 'E' },
    { value: 'highlight', icon: <Highlighter className="h-4 w-4" />, label: '高亮', shortcut: 'H' },
    { value: 'redact', icon: <EyeOff className="h-4 w-4" />, label: '遮挡', shortcut: 'R' },
    { value: 'number', icon: <Hash className="h-4 w-4" />, label: '序号', shortcut: 'N' },
    { value: 'arrow', icon: <ArrowUpRight className="h-4 w-4" />, label: '箭头', shortcut: 'A' },
    { value: 'line', icon: <Minus className="h-4 w-4" />, label: '直线', shortcut: 'L' },
    { value: 'freehand', icon: <Pencil className="h-4 w-4" />, label: '自由画笔', shortcut: 'P' },
    { value: 'callout', icon: <MessageSquareQuote className="h-4 w-4" />, label: '说明气泡', shortcut: 'Q' },
    { value: 'magnifier', icon: <Search className="h-4 w-4" />, label: '局部放大', shortcut: 'Z' },
    { value: 'mosaic', icon: <ShieldCheck className="h-4 w-4" />, label: '打码', shortcut: 'M' },
    { value: 'text', icon: <Type className="h-4 w-4" />, label: '文字', shortcut: 'T' },
    { value: 'text-box', icon: <TextCursorInput className="h-4 w-4" />, label: '文字框', shortcut: 'G' },
    { value: 'crop', icon: <Crop className="h-4 w-4" />, label: '裁剪', shortcut: 'C' },
  ]

  // 健康状态灯：未检查=灰 / 内容已改=黄闪感 / 有警告=橙 / 仅提示=蓝 / 通过=绿
  const sigStale = checkSig !== null && checkSig !== checkSignature(title, pages, exportFooter)
  const warnCount = issues.filter((i) => i.severity === 'warn').length
  const health = !checkSig
    ? { cls: 'bg-slate-300', title: '尚未运行检查' }
    : sigStale
      ? { cls: 'bg-amber-400', title: '内容已修改，建议复查' }
      : warnCount
        ? { cls: 'bg-amber-500', title: `${warnCount} 项警告待处理` }
        : issues.length
          ? { cls: 'bg-blue-400', title: '仅提示项，无警告' }
          : { cls: 'bg-emerald-500', title: '检查通过' }

  return (
    <div className="flex h-screen min-w-[960px] flex-col overflow-hidden bg-background text-foreground">
      <Toaster richColors position="bottom-right" />
      {/* 顶栏 */}
      <header className="z-20 flex h-14 shrink-0 items-center justify-between border-b bg-card px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
            <BookOpen className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight tracking-tight">明白纸工作台</div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">OnlyPing</div>
          </div>
          <Separator orientation="vertical" className="mx-1 h-8" />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="项目标题"
            className="h-9 w-52 border-transparent bg-transparent px-2 text-sm font-medium shadow-none hover:border-input focus-visible:bg-background"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            title="撤销（Ctrl+Z）"
            aria-label="撤销"
            disabled={!undoStack.current.length}
            onClick={undo}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            title="重做（Ctrl+Y）"
            aria-label="重做"
            disabled={!redoStack.current.length}
            onClick={redo}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          {saveNote && (
            <span className={`mr-1 hidden items-center gap-1.5 px-2 py-1 text-[11px] font-medium xl:inline-flex ${saveNote.includes('失败') ? 'text-amber-700' : 'text-emerald-700'}`}>
              <span className={`size-1.5 rounded-full ${saveNote.includes('失败') ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              {saveNote}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-9 bg-background" onClick={saveProject}>
            <Save className="size-4" />
            保存项目
          </Button>
          <input
            ref={projectFileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) loadProject(e.target.files[0])
              e.currentTarget.value = ''
            }}
          />
          <Button variant="outline" size="sm" className="h-9 bg-background" onClick={() => projectFileRef.current?.click()}>
            <FolderOpen className="size-4" />
            打开项目
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 bg-background">
                <Type className="size-4" />
                导出样式
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64" align="end">
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-600">导出版式字号（px）</div>
                {(
                  [
                    { key: 'title', label: '主标题' },
                    { key: 'heading', label: '步骤标题' },
                    { key: 'notes', label: '说明文字' },
                  ] as const
                ).map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-xs text-slate-500">
                    {label}
                    <Slider
                      min={key === 'notes' ? 12 : 16}
                      max={key === 'notes' ? 32 : 56}
                      value={[exportStyle[key]]}
                      onValueChange={([value]) => setExportStyle((s) => ({ ...s, [key]: value }))}
                      className="mx-1 flex-1"
                      aria-label={`${label}字号`}
                    />
                    <span className="w-6 text-right tabular-nums">{exportStyle[key]}</span>
                  </label>
                ))}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={() => setExportStyle(DEFAULT_EXPORT_STYLE)}
                >
                  恢复默认（32 / 22 / 16）
                </Button>
                <div className="border-t pt-3">
                  <div className="mb-2 text-xs font-medium text-slate-600">页脚信息（随导出显示）</div>
                  <Input
                    value={exportFooter.org}
                    onChange={(e) => setExportFooter((f) => ({ ...f, org: e.target.value }))}
                    placeholder="编制单位，如：XX银行零售部"
                    className="mb-2 h-8 text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <Input
                      value={exportFooter.version}
                      onChange={(e) => setExportFooter((f) => ({ ...f, version: e.target.value }))}
                      placeholder="版本号，如 V1.0"
                      className="h-8 flex-1 text-xs"
                    />
                    <div className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                      <Checkbox
                        id="footer-show-date"
                        className="size-4"
                        checked={exportFooter.showDate}
                        onCheckedChange={(checked) => setExportFooter((f) => ({ ...f, showDate: checked === true }))}
                      />
                      <Label htmlFor="footer-show-date" className="cursor-pointer font-normal">显示日期</Label>
                    </div>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>
          <Button variant="outline" size="sm" className="h-9 bg-background" disabled={!pages.length} onClick={runChecks}>
            <span
              className={`mr-1.5 h-2 w-2 rounded-full ${health.cls}`}
              title={health.title}
            />
            <ListChecks className="size-4" />
            一致性检查{issues.length ? `（${issues.length}）` : ''}
          </Button>
          <Button variant="outline" size="sm" className="h-9 bg-background" disabled={!pages.length} onClick={() => setPreviewOpen(true)}>
            <Eye className="size-4" />
            预览导出
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" className="h-9 px-4" disabled={exporting || !pages.length}>
                <Download className="size-4" />
                {exporting ? '导出中…' : '导出'}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => doExport('docx')}>
                <FileDown className="mr-2 h-4 w-4" />
                Word 文档（.docx）
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport('pdf')}>
                <FileDown className="mr-2 h-4 w-4" />
                PDF 文档
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => doExport('long')}>
                <ImageIcon className="mr-2 h-4 w-4" />
                拼接长图（PNG）
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!selectedPage} onClick={() => doExport('page')}>
                <ImageIcon className="mr-2 h-4 w-4" />
                当前页标注图（PNG）
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <PageList
          pages={pages}
          selectedId={selectedPageId}
          onImportFiles={importFiles}
          onSelect={(id) => {
            setSelectedPageId(id)
            setSelectedAnnId(null)
          }}
          onMove={movePage}
          onRemove={removePage}
        />

        {/* 中间编辑区 */}
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-card px-3 py-2">
            <ToggleGroup
              type="single"
              value={tool}
              onValueChange={(v) => v && setTool(v as Tool)}
              className="gap-0.5 rounded-md bg-muted p-0.5"
            >
              {TOOLS.map((t) => (
                <Tooltip key={t.value}>
                  <TooltipTrigger asChild>
                    <ToggleGroupItem
                      value={t.value}
                      aria-label={t.label}
                      title={`${t.label}（${t.shortcut}）`}
                      className="size-8 rounded p-0 text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground aria-checked:bg-foreground aria-checked:text-background aria-checked:shadow-sm"
                    >
                      {t.icon}
                    </ToggleGroupItem>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="flex items-center gap-3">
                      {t.label}
                      <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">{t.shortcut}</kbd>
                    </span>
                  </TooltipContent>
                </Tooltip>
              ))}
            </ToggleGroup>
            <Separator orientation="vertical" className="hidden h-8 sm:block" />
            <div className="flex items-center gap-1 rounded-md border bg-background px-1 py-0.5">
              {COLORS.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setColor(c)}
                  aria-label={`标注颜色 ${c}`}
                  aria-pressed={color === c}
                  className={`size-7 rounded-md p-0 ${
                    color === c ? 'bg-accent ring-1 ring-foreground/40' : 'hover:bg-muted'
                  }`}
                  title={`标注颜色 ${c}`}
                >
                  <span className={`size-3.5 rounded-full ring-1 ring-black/10 ${color === c ? 'scale-110' : ''}`} style={{ background: c }} />
                </Button>
              ))}
            </div>

            {/* 样式模板：新建标注默认样式 + 预设管理 */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 bg-background" title="样式模板">
                  <Palette className="size-4" />
                  样式模板
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72" align="start">
                <div className="space-y-3">
                  <div className="text-xs font-medium text-slate-600">
                    新建标注默认样式（颜色取上方色板）
                  </div>
                  {(
                    [
                      { key: 'numberR', label: '序号大小', min: 12, max: 56 },
                      { key: 'textSize', label: '文字字号', min: 16, max: 80 },
                      { key: 'mosaicTile', label: '打码强度', min: MOSAIC_MIN_TILE, max: MOSAIC_MAX_TILE },
                    ] as const
                  ).map(({ key, label, min, max }) => (
                    <label key={key} className="flex items-center gap-2 text-xs text-slate-500">
                      {label}
                      <Slider
                        min={min}
                        max={max}
                        value={[annStyle[key]]}
                        onValueChange={([value]) => setAnnStyle((s) => ({ ...s, [key]: value }))}
                        className="mx-1 flex-1"
                        aria-label={label}
                      />
                      <span className="w-8 text-right tabular-nums">
                        {annStyle[key]}
                        {key === 'mosaicTile' ? 'px' : ''}
                      </span>
                    </label>
                  ))}
                  <Button
                    variant="secondary"
                    size="sm"
                    className="h-8 w-full text-xs"
                    disabled={!pages.length}
                    title="把当前样式应用到所有页面的已有标注（可用 Ctrl+Z 撤销）"
                    onClick={() => {
                      if (window.confirm('将把全部已有标注统一为当前样式（可用撤销恢复），继续？')) applyStyleToAll()
                    }}
                  >
                    套用当前样式到全部页面
                  </Button>

                  <div className="border-t pt-3">
                    <div className="mb-2 text-xs font-medium text-slate-600">样式预设</div>
                    <div className="mb-2 flex gap-1.5">
                      <Input
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && savePreset()}
                        placeholder="预设名称，如：银行红-大字号"
                        className="h-8 flex-1 text-xs"
                      />
                      <Button size="sm" className="h-8 px-2 text-xs" disabled={!presetName.trim()} onClick={savePreset}>
                        保存
                      </Button>
                    </div>
                    {presets.length === 0 ? (
                      <p className="text-[11px] text-slate-400">
                        还没有预设。调好上面的样式后输入名称保存，之后一键套用。
                      </p>
                    ) : (
                      <div className="space-y-1">
                        {presets.map((p) => (
                          <div
                            key={p.id}
                            className="group flex items-center gap-2 rounded border border-slate-200 px-2 py-1.5"
                          >
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`套用样式预设：${p.name}`}
                              className="size-7 shrink-0 rounded-md p-0"
                              title="套用此预设"
                              onClick={() => applyPreset(p)}
                            >
                              <span className="size-3.5 rounded-full border border-black/10" style={{ background: p.color }} />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 min-w-0 flex-1 justify-start truncate px-1 text-left text-xs font-normal text-muted-foreground hover:text-primary"
                              title={`套用：序号 ${p.numberR} · 文字 ${p.textSize}px · 打码 ${p.mosaicTile}px`}
                              onClick={() => applyPreset(p)}
                            >
                              {p.name}
                              <span className="ml-1.5 shrink-0 text-[10px] text-muted-foreground/75">
                                序{p.numberR} · 字{p.textSize} · 码{p.mosaicTile}
                              </span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`删除样式预设：${p.name}`}
                              className="size-7 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="删除预设"
                              onClick={() => deletePreset(p.id)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </PopoverContent>
            </Popover>

            {/* 选中标注的尺寸调节 */}
            {selectedAnn?.kind === 'text' && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                字号
                <Slider
                  min={16}
                  max={80}
                  value={[selectedAnn.size ?? 26]}
                  onValueChange={([size]) => updateAnnSize({ size })}
                  className="w-28"
                  aria-label="文字字号"
                />
                <span className="w-6 tabular-nums">{selectedAnn.size ?? 26}</span>
              </label>
            )}
            {selectedAnn?.kind === 'number' && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                序号大小
                <Slider
                  min={12}
                  max={56}
                  value={[selectedAnn.r ?? 20]}
                  onValueChange={([r]) => updateAnnSize({ r })}
                  className="w-28"
                  aria-label="序号大小"
                />
                <span className="w-6 tabular-nums">{selectedAnn.r ?? 20}</span>
              </label>
            )}
            {(selectedAnn?.kind === 'arrow' || selectedAnn?.kind === 'line' || selectedAnn?.kind === 'freehand') && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                {selectedAnn.kind === 'arrow' ? '箭头线宽' : selectedAnn.kind === 'line' ? '直线线宽' : '画笔粗细'}
                <Slider
                  min={2}
                  max={16}
                  value={[selectedAnn.width ?? ARROW_DEFAULT_WIDTH]}
                  onValueChange={([width]) => updateAnnSize({ width })}
                  className="w-28"
                  aria-label={selectedAnn.kind === 'arrow' ? '箭头线宽' : selectedAnn.kind === 'line' ? '直线线宽' : '画笔粗细'}
                />
                <span className="w-6 tabular-nums">{selectedAnn.width ?? ARROW_DEFAULT_WIDTH}</span>
              </label>
            )}
            {selectedAnn?.kind === 'mosaic' && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                打码强度
                <Slider
                  min={MOSAIC_MIN_TILE}
                  max={MOSAIC_MAX_TILE}
                  value={[selectedAnn.tile ?? MOSAIC_DEFAULT_TILE]}
                  onValueChange={([tile]) => updateAnnSize({ tile })}
                  className="w-28"
                  aria-label="打码强度"
                />
                <span className="w-8 tabular-nums">{selectedAnn.tile ?? MOSAIC_DEFAULT_TILE}px</span>
              </label>
            )}
            {selectedAnn?.kind === 'magnifier' && (
              <label className="flex items-center gap-2 text-xs text-slate-500">
                放大倍率
                <Slider min={1.5} max={4} step={0.1} value={[selectedAnn.zoom]} onValueChange={([zoom]) => updateAnnSize({ zoom })} className="w-28" aria-label="放大倍率" />
                <span className="w-8 tabular-nums">{selectedAnn.zoom.toFixed(1)}×</span>
              </label>
            )}
            {selectedAnn?.kind === 'mosaic' && (
              <span className="text-[11px] text-slate-400">数值越大越模糊，二维码建议 ≥ 24px</span>
            )}
            {selectedPage?.orig && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-slate-500"
                title="恢复将回到裁剪前的图片与标注（裁剪后新增的标注会丢失）"
                onClick={() => restoreCrop(selectedPage)}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                恢复原图
              </Button>
            )}

            {/* 画布缩放 */}
            <div className="ml-auto flex items-center gap-0.5 rounded-md border bg-background p-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                title="缩小（Ctrl+滚轮）"
                aria-label="缩小画布"
                onClick={() => setZoom((z) => Math.max(0.2, z / 1.2))}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 min-w-14 px-1 text-xs tabular-nums text-muted-foreground"
                title="点击恢复 100%"
                onClick={() => setZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                title="放大（Ctrl+滚轮）"
                aria-label="放大画布"
                onClick={() => setZoom((z) => Math.min(3, z * 1.2))}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                title="适应面板宽度"
                onClick={() => setZoom(1)}
              >
                适应
              </Button>
            </div>
            <span className="text-xs text-slate-400">
              共 {pages.length} 页{selectedPage ? ` · 当前：${selectedPage.name}` : ''}
            </span>
          </div>

          <div
            className="flex-1 overflow-auto bg-muted/70 p-4"
            onDragOver={(e) => e.preventDefault()}
            onDrop={importDropped}
          >
            {selectedPage ? (
              <CanvasEditor
                page={selectedPage}
                tool={tool}
                color={color}
                zoom={zoom}
                numberStart={numberStarts.get(selectedPage.id) ?? 0}
                mosaicTile={annStyle.mosaicTile}
                numberR={annStyle.numberR}
                textSize={annStyle.textSize}
                selectedId={selectedAnnId}
                onSelect={setSelectedAnnId}
                onChange={(annotations) => updatePage(selectedPage.id, { annotations }, true)}
                onZoomChange={setZoom}
                onCrop={(rect) => applyCrop(selectedPage, rect)}
              />
            ) : (
              <div className="flex h-full min-h-80 flex-col items-center justify-center text-center text-muted-foreground">
                <ImageIcon className="mb-3 size-6 text-muted-foreground/70" />
                <p className="text-sm font-medium text-foreground">打开一张截图开始标注</p>
                <p className="mt-1 text-xs">从左侧添加、粘贴或拖入图片</p>
                <span className="mt-3 border bg-card px-2 py-1 text-[11px] font-medium">Ctrl + V</span>
              </div>
            )}
          </div>

          {/* 本页说明 */}
          {selectedPage && (
            <div className="border-t bg-card px-4 py-3">
              <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
                步骤说明 · 第 {pages.indexOf(selectedPage) + 1} 页
                <span className="text-[10px]">自动保存</span>
              </div>
              <Textarea
                value={selectedPage.notes}
                onChange={(e) => updatePage(selectedPage.id, { notes: e.target.value }, true)}
                placeholder="例如：打开活动页面后，点击「立即参与」按钮进入报名流程……"
                className="min-h-[72px] resize-y bg-background text-sm leading-relaxed"
              />
            </div>
          )}
        </div>

        <AIPanel
          config={aiConfig}
          onConfigChange={setAIConfig}
          pages={pages}
          selectedPageId={selectedPageId}
          onUpdatePage={updatePage}
        />
      </div>
      <ExportPreview
        title={title}
        pages={pages}
        style={exportStyle}
        footer={exportFooter}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
      <Dialog open={checkOpen} onOpenChange={setCheckOpen}>
        <DialogContent className="max-h-[80vh] overflow-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>一致性检查</DialogTitle>
            <DialogDescription>
              {issues.length === 0
                ? '未发现问题，可以导出。'
                : `发现 ${issues.length} 项需要关注的内容（警告建议修正，提示可自行判断）：`}
            </DialogDescription>
          </DialogHeader>
          {issues.length > 0 && (
            <div className="space-y-2">
              {issues.map((issue, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-lg border border-slate-200 px-3 py-2">
                  {issue.severity === 'warn' ? (
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  )}
                  <div className="min-w-0 flex-1 text-xs leading-5 text-slate-600">
                    <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                      {issue.category}
                    </span>
                    {issue.message}
                  </div>
                  {issue.pageId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 shrink-0 px-2 text-xs"
                      onClick={() => locateIssue(issue)}
                    >
                      定位
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex items-center gap-2 border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={aiScanning || !pages.length || (!aiConfig.apiKey && !aiConfig.demo)}
              onClick={runAIPrivacyScan}
            >
              <ShieldAlert className="mr-1.5 h-4 w-4" />
              {aiScanning ? aiScanProgress || '扫描中…' : 'AI 隐私扫描'}
            </Button>
            <span className="text-[11px] text-slate-400">
              {aiConfig.demo
                ? '演示模式：模拟扫描结果'
                : aiConfig.apiKey
                  ? '逐页识别疑似未打码的姓名/手机号/二维码等'
                  : '请先在右侧 AI 面板配置 API Key'}
            </span>
            <div
              className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
              title="开启后，导出 Word/PDF/长图前会自动运行 AI 隐私扫描"
            >
              <Checkbox
                id="auto-ai-scan"
                className="size-4"
                checked={autoAiScan}
                onCheckedChange={(checked) => setAutoAiScan(checked === true)}
              />
              <Label htmlFor="auto-ai-scan" className="cursor-pointer font-normal">导出前自动扫描</Label>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
