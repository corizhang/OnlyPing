import { useExportTask } from '@/hooks/use-export-task'
import { checkTask, isTaskCancelled, taskCheckpoint, type RenderTask } from '@/lib/render-task'
import AnnotationList from '@/components/AnnotationList'
import { copySelection, editableSelection } from '@/lib/selection'
import AnnotationParameters from '@/components/AnnotationParameters'
import { cropAnnotation, duplicateAnnotation } from '@/lib/tools/annotation-geometry'
import { TOOL_DEFINITIONS, TOOL_CATALOG, TOOL_PARAMETERS, annotationLabel } from '@/lib/tools/catalog'
import ToolIcon from '@/components/ToolIcon'
import { TOOL_SHORTCUTS, DEFAULT_TOOL_ORDER } from '@/lib/tools'
import { EditHistory } from '@/lib/history'
import PanelResizeHandle from '@/components/PanelResizeHandle'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PanelRight,
  Keyboard,
  Copy,
  FilePlus2,
  Download,
  Eye,
  FileDown,
  Image as ImageIcon,
  Type,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Undo2,
  Redo2,
  Palette,
  Trash2,
  ListChecks,
  ShieldAlert,
  CircleAlert,
  Info,
  BookOpen,
  Save,
  FolderOpen,
  ArrowUpToLine,
  ArrowDownToLine,
  GripVertical,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Slider } from '@/components/ui/slider'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { toast } from 'sonner'
import AsyncAIPanel from '@/components/AsyncAIPanel'
import CanvasEditor from '@/components/CanvasEditor'
import StepNotesEditor from '@/components/StepNotesEditor'
import ExportPreview from '@/components/ExportPreview'
import PageList from '@/components/PageList'
import { loadAIConfig, restoreAIConfig } from '@/lib/ai-config'
import { readRecoverableProject } from '@/lib/project-recovery'
import { rectCoverage, runConsistencyChecks, type CheckIssue } from '@/lib/check'
import { idbGet, idbSet, validateAutosave, listLocalProjects, readLocalProject, ProjectConflictError, type LocalProjectEntry, type ProjectData } from '@/lib/db'
import { useProjectAutosave } from '@/hooks/use-project-autosave'
import ProjectLibrary from '@/components/ProjectLibrary'
import StorageRecovery from '@/components/StorageRecovery'
import { deleteLocalProject } from '@/lib/db'
import { storageErrorMessage } from '@/lib/storage-errors'
import { setRecoveryProject } from '@/lib/crash-recovery'
import { startEditorPhase } from '@/lib/editor-performance'
import { InputSettlement, isComposingKey } from '@/lib/input-settlement'
import { createNativeProjectSession, hasActiveFileOperation, isDesktop, saveFile, withNativeOperation } from '@/lib/files'
import { projectFilename, type ProjectFileSource } from '@/lib/project-files'
import { useDesktopClose } from '@/hooks/use-desktop-close'
import { useProjectFileShortcuts } from '@/hooks/use-project-file-shortcuts'
import { filesToPages } from '@/lib/import'
import { exportDocx, exportLongImage, exportPdf } from '@/lib/exporters'
import { clearImageCache, downloadPageImage, loadImage, preparePageForAI } from '@/lib/render'
import type { Annotation, AnnotationStyle, ExportFooter, ExportStyle, Page, Rect, StylePreset, TextAlignment, Tool } from '@/types'
import { computeNumberStarts, DEFAULT_ANNOTATION_STYLE, DEFAULT_EXPORT_FOOTER, DEFAULT_EXPORT_STYLE, MOSAIC_MAX_TILE, MOSAIC_MIN_TILE, uid } from '@/types'

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#2563eb', '#7c3aed', '#111827']

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
  JSON.stringify([t, f, pgs.map(p => [p.id, p.notes, p.annotations])])

const restoreExportStyle = (saved?: (Partial<ExportStyle> & { imageScale?: number }) | null): ExportStyle => {
  const { imageScale: legacyImageScale, ...currentStyle } = saved ?? {}
  const rawScale = Number(currentStyle.stepImageScale ?? legacyImageScale ?? DEFAULT_EXPORT_STYLE.stepImageScale)
  const stepImageScale = Math.min(100, Math.max(25, Number.isFinite(rawScale) ? rawScale : 100))
  const validAlignment = (value: unknown): TextAlignment =>
    value === 'center' || value === 'right' ? value : 'left'
  return {
    ...DEFAULT_EXPORT_STYLE,
    ...currentStyle,
    stepImageScale,
    titleAlign: validAlignment(currentStyle.titleAlign),
    headingAlign: validAlignment(currentStyle.headingAlign),
    notesAlign: validAlignment(currentStyle.notesAlign),
  }
}

export default function Home() {
  const [title, setTitleState] = useState('活动参与流程明白纸')
  const projectFileRef = useRef<HTMLInputElement>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  // 新建标注的默认样式（用户级偏好，持久化到 localStorage）
  const [annStyle, setAnnStyle] = useState<AnnotationStyle>(
    () => ({ ...DEFAULT_ANNOTATION_STYLE, ...(loadJSON('mbz-ann-style', isStyle) ?? {}) })
  )
  // 标注样式预设（用户级，跨项目复用）
  const [presets, setPresets] = useState<StylePreset[]>(
    () => loadJSON('mbz-style-presets', isPresetArray) ?? []
  )
  const [presetName, setPresetName] = useState('')
  const color = annStyle.color
  const setColor = (c: string) => setAnnStyle((s) => ({ ...s, color: c }))
  const [selectedAnnIds, setSelectedAnnIds] = useState<string[]>([])
  const selectedAnnId = selectedAnnIds.at(-1) ?? null
  const setSelectedAnnId = useCallback((id: string | null) => setSelectedAnnIds(id ? [id] : []), [])
  const [editTextRequest, setEditTextRequest] = useState(0)
  const [aiConfig, setAIConfig] = useState(loadAIConfig)
  const [aiConfigReady, setAIConfigReady] = useState(!isDesktop())
  useEffect(() => {
    if (!isDesktop()) return
    let disposed = false
    restoreAIConfig().then(config => { if (!disposed) setAIConfig(config) })
      .catch(() => { if (!disposed) toast.error('AI 密钥读取或迁移失败，请在接口配置中重新保存；原明文配置尚未移除') })
      .finally(() => { if (!disposed) setAIConfigReady(true) })
    return () => { disposed = true }
  }, [])
  const [zoom, setZoom] = useState(1)
  const [zoomMode, setZoomMode] = useState<'fit' | 'width' | 'manual'>('fit')
  const [rightWidth, setRightWidth] = useState(() => loadJSON('mbz-right-width', (v): v is number => typeof v === 'number' && v >= 260 && v <= 440) ?? 288)
  useEffect(() => { localStorage.setItem('mbz-right-width', JSON.stringify(rightWidth)) }, [rightWidth])
  const [rightOpen, setRightOpen] = useState(true)
  const [inspector, setInspector] = useState<'steps' | 'ai'>('steps')
  const [stepListHeight, setStepListHeight] = useState(() => loadJSON('mbz-step-list-height', (v): v is number => typeof v === 'number' && v >= 22 && v <= 72) ?? 42)
  const resizingStepList = useRef(false)
  useEffect(() => { localStorage.setItem('mbz-step-list-height', JSON.stringify(stepListHeight)) }, [stepListHeight])
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const viewportRef = useRef<HTMLDivElement>(null)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const suppressPanClick = useRef(false)
  const manualZoom = (value: number) => { setZoomMode('manual'); setZoom(Math.max(.05, Math.min(4, value))) }
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || (e.target as HTMLElement)?.closest('input,textarea,select,button,[role="textbox"],[contenteditable="true"]')) return
      e.preventDefault()
      setSpaceHeld(true)
    }
    const up = (e: KeyboardEvent) => { if (e.code === 'Space') setSpaceHeld(false) }
    const blur = () => { setSpaceHeld(false); panRef.current = null }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
  const [previewOpen, setPreviewOpen] = useState(false)
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [newProjectName, setNewProjectName] = useState('未命名明白纸')
  const [exportStyle, setExportStyleState] = useState<ExportStyle>(DEFAULT_EXPORT_STYLE)
  const [exportFooter, setExportFooterState] = useState<ExportFooter>(DEFAULT_EXPORT_FOOTER)
  const [projectId, setProjectId] = useState<string>(() => crypto.randomUUID())
  const projectIdRef = useRef(projectId)
  const [projectFiles] = useState(createNativeProjectSession)
  const [projectFileRevision, setProjectFileRevision] = useState(0)
  const [projectFileBusy, setProjectFileBusy] = useState(false)
  const projectFileTask = useRef(false)
  useEffect(() => { projectIdRef.current = projectId }, [projectId])
  const [compositionPending, setCompositionPending] = useState(false)
  const [inputSessions] = useState(() => new InputSettlement(setCompositionPending))
  useEffect(() => { inputSessions.activate(); return () => inputSessions.dispose() }, [inputSessions])
  const blurInput = () => {
    const active = document.activeElement
    if (active instanceof HTMLElement && (active.matches('input,textarea') || active.isContentEditable)) active.blur()
  }
  const inputBlocked = () => toast.info('中文输入尚未完成，请确认候选文字后重试；当前编辑内容仍保留。')
  const selectStep = (id: string) => { void inputSessions.transition(() => {
    if (!pagesRef.current.some(page => page.id === id)) return
    setSelectedPageId(id); setSelectedAnnId(null)
  }, blurInput, inputBlocked).catch(() => toast.error('输入收尾失败，请保留当前页面并重试')) }
  const exportTask = useExportTask(projectId)
  const exporting = exportTask.busy
  const [localProjects, setLocalProjects] = useState<LocalProjectEntry[]>([])
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [pendingText, setPendingText] = useState(false)
  const [saveNote, setSaveNote] = useState('')
  const [storageReady, setStorageReady] = useState(false)
  const [storageLoading, setStorageLoading] = useState(true)
  const [storageError, setStorageError] = useState<unknown>(null)
  const [storageAttempt, setStorageAttempt] = useState(0)
  const [recoveryOpen, setRecoveryOpen] = useState(false)
  const initialWorkspace = useRef<string | null>(null)
  const workspaceEdited = useRef(false)
  // 一致性检查
  const [issues, setIssues] = useState<CheckIssue[]>([])
  const [checkOpen, setCheckOpen] = useState(false)
  const [aiScanning, setAiScanning] = useState(false)
  const privacyController = useRef<AbortController | null>(null)
  useEffect(() => () => privacyController.current?.abort(), [projectId])
  const [aiScanProgress, setAiScanProgress] = useState('')
  // 上次检查时的项目指纹（null = 尚未检查）；不一致则状态灯提示需复查
  const [checkSig, setCheckSig] = useState<string | null>(null)
  // 导出前自动运行 AI 隐私扫描（用户级偏好）
  const [autoAiScan, setAutoAiScan] = useState(() => localStorage.getItem('mbz-auto-ai-scan') === '1')

  useEffect(() => {
    localStorage.setItem('mbz-auto-ai-scan', autoAiScan ? '1' : '0')
  }, [autoAiScan])

  type Snapshot = { title: string; pages: Page[]; exportStyle: ExportStyle; exportFooter: ExportFooter }
  const history = useRef(new EditHistory<Snapshot>())
  const pagesRef = useRef<Page[]>([])
  const metadataRef = useRef({ title, exportStyle, exportFooter })
  const gestureRef = useRef(false)
  const keyEditRef = useRef(false)
  useEffect(() => { pagesRef.current = pages; metadataRef.current = { title, exportStyle, exportFooter } }, [pages, title, exportStyle, exportFooter])
  useEffect(() => {
    const endGesture = () => { gestureRef.current = false; history.current.end() }
    const endKey = () => { if (keyEditRef.current) { keyEditRef.current = false; history.current.end() } }
    window.addEventListener('pointerup', endGesture)
    window.addEventListener('pointercancel', endGesture)
    window.addEventListener('keyup', endKey)
    window.addEventListener('blur', endGesture)
    return () => { window.removeEventListener('pointerup', endGesture); window.removeEventListener('pointercancel', endGesture); window.removeEventListener('keyup', endKey); window.removeEventListener('blur', endGesture) }
  }, [])
  const snapshot = (): Snapshot => ({ ...metadataRef.current, pages: pagesRef.current })
  const record = (group: string | null = null) => history.current.record(snapshot(), gestureRef.current ? 'pointer' : keyEditRef.current ? 'key' : group)
  const setTitle = (value: string) => {
    if (metadataRef.current.title === value) return
    record('title')
    metadataRef.current = { ...metadataRef.current, title: value }
    setTitleState(value)
  }
  const setExportStyle = (next: ExportStyle | ((value: ExportStyle) => ExportStyle)) => {
    const value = typeof next === 'function' ? next(metadataRef.current.exportStyle) : next
    record()
    metadataRef.current = { ...metadataRef.current, exportStyle: value }
    setExportStyleState(value)
  }
  const setExportFooter = (next: (value: ExportFooter) => ExportFooter) => {
    const value = next(metadataRef.current.exportFooter)
    record('footer')
    metadataRef.current = { ...metadataRef.current, exportFooter: value }
    setExportFooterState(value)
  }
  const commitPages = (next: Page[] | ((prev: Page[]) => Page[]), coalesce = false) => {
    const current = pagesRef.current
    const resolved = typeof next === 'function' ? next(current) : next
    if (resolved === current) return
    record(coalesce ? `page:${selectedPageId}` : null)
    pagesRef.current = resolved
    setPages(resolved)
  }
  const applySnapshot = (value: Snapshot) => {
    pagesRef.current = value.pages
    metadataRef.current = value
    setPages(value.pages)
    setTitleState(value.title)
    setExportStyleState(value.exportStyle)
    setExportFooterState(value.exportFooter)
    if (!value.pages.some(p => p.id === selectedPageId)) setSelectedPageId(value.pages[0]?.id ?? null)
    setSelectedAnnId(null)
  }
  const undo = () => { const value = history.current.undo(snapshot()); if (value) applySnapshot(value) }
  const redo = () => { const value = history.current.redo(snapshot()); if (value) applySnapshot(value) }

  // 从当前平台存储恢复；结构损坏和读取异常均尝试独立恢复副本。
  useEffect(() => {
    let cancelled = false
    const workspace = () => JSON.stringify({ projectId: projectIdRef.current, ...snapshot() })
    initialWorkspace.current ??= workspace()
    setStorageLoading(true)
    ;(async () => {
      try {
        const restored = await readRecoverableProject(key => idbGet<unknown>(key), validateAutosave)
        if (cancelled) return
        setStorageError(null)
        // A delayed read or retry must not replace edits made after startup.
        if (workspaceEdited.current || inputSessions.awaitingComposition || workspace() !== initialWorkspace.current) {
          setSaveNote('本地连接已恢复，保留当前编辑内容')
          setStorageReady(true)
          return
        }
        if (restored) {
          setProjectId(restored.projectId ?? crypto.randomUUID())
          setTitleState(restored.title ?? '明白纸')
          setPages(restored.pages)
          setExportStyleState(restoreExportStyle(restored.exportStyle))
          setExportFooterState(restored.exportFooter ?? DEFAULT_EXPORT_FOOTER)
          setSelectedPageId(restored.pages[0]?.id ?? null)
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
            setTitleState(legacy.title ?? '明白纸')
            setPages(legacy.pages)
            setExportStyleState(restoreExportStyle(legacy.exportStyle))
            setExportFooterState(legacy.exportFooter ?? DEFAULT_EXPORT_FOOTER)
            setSelectedPageId(legacy.pages[0]?.id ?? null)
            setSaveNote('已从旧版存储恢复项目')
          } else {
            throw new Error('旧版存档损坏，自动保存已暂停；请先导出旧存档恢复包')
          }
          // 保留旧存档供恢复导出，不因其他项目保存成功而删除。
        }
        setStorageReady(true)
      } catch (error) {
        if (!cancelled) {
          setStorageError(error)
          setRecoveryOpen(true)
          setSaveNote('读取自动存档失败，自动保存已暂停，请打开项目备份')
          setStorageReady(false)
        }
      } finally { if (!cancelled) setStorageLoading(false) }
    })()
    return () => {
      cancelled = true
    }
  // Retry intentionally reads refs and never uses stale render snapshots.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageAttempt])

  // 一致性检查
  const runChecks = () => {
    setIssues(runConsistencyChecks(title, pages, exportFooter))
    setCheckSig(checkSignature(title, pages, exportFooter))
    setCheckOpen(true)
  }

  const locateIssue = (issue: CheckIssue) => {
    if (issue.pageId) {
      selectStep(issue.pageId)
    }
    setCheckOpen(false)
  }

  // AI 隐私扫描核心：逐页识别疑似未打码的隐私内容（已有打码覆盖 ≥50% 的自动跳过）
  const collectAiPrivacyIssues = async (task: RenderTask = {}): Promise<CheckIssue[]> => {
    const found: CheckIssue[] = []
    const privacyMode = localStorage.getItem('mbz-privacy') === '1'
    for (let i = 0; i < pages.length; i++) {
      await taskCheckpoint(task, '正在检查隐私', i, pages.length)
      const p = pages[i]
      setAiScanProgress(`正在扫描 ${i + 1}/${pages.length} 页…`)
      try {
        const mosaics = p.annotations
          .filter(a => !a.hidden)
          .filter((a) => a.kind === 'mosaic' || a.kind === 'redact')
          .map((a) => ({ x: a.x / p.width, y: a.y / p.height, w: a.w / p.width, h: a.h / p.height }))
        const pageForAI = await preparePageForAI(p, privacyMode)
        const { aiPrivacyScanPage } = await import('@/lib/ai')
        checkTask(task)
        const results = await aiPrivacyScanPage(aiConfig, pageForAI, mosaics, task.signal)
        checkTask(task)
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
        if (isTaskCancelled(err)) throw err
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
    if (aiScanning || privacyController.current || !pages.length) return
    const controller = new AbortController()
    privacyController.current = controller
    setAiScanning(true)
    setAiScanProgress('')
    try {
      const found = await collectAiPrivacyIssues({ signal: controller.signal })
      controller.signal.throwIfAborted()
      setIssues((prev) => [...prev.filter((i) => i.category !== '隐私'), ...found])
    } catch (err) {
      if (isTaskCancelled(err)) toast.info('已取消隐私扫描')
      else toast.error('隐私扫描失败，请重试')
    } finally {
      privacyController.current = null
      setAiScanning(false)
      setAiScanProgress('')
    }
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
          if (a.locked) return a
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
    setAnnStyle({ color: p.color, numberR: p.numberR, textSize: p.textSize, mosaicTile: p.mosaicTile, strokeWidth: p.strokeWidth ?? 4 })
  }

  const deletePreset = (id: string) => setPresets((prev) => prev.filter((p) => p.id !== id))

  const saveData = useMemo(() => ({ schemaVersion: 1 as const, projectId, title, pages, exportStyle, exportFooter }), [projectId, title, pages, exportStyle, exportFooter])
  useEffect(() => { if (storageReady) setRecoveryProject(saveData) }, [storageReady, saveData])
  const autosave = useProjectAutosave(saveData, storageReady, pendingText || compositionPending)
  const fileBinding = projectFiles.binding(projectId)
  const fileDirty = !!fileBinding && (projectFiles.dirty(projectId, saveData) || pendingText || compositionPending)
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (projectFiles.binding(projectId) && (projectFiles.dirty(projectId, saveData) || pendingText || compositionPending)) { event.preventDefault(); event.returnValue = '' }
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [projectFiles, projectId, saveData, pendingText, compositionPending, projectFileRevision])
  const persistCurrent = async () => {
    if (!storageReady) return true
    const sourceProjectId = projectIdRef.current
    try {
      if (!await inputSessions.settle(blurInput)) { inputBlocked(); return false }
      if (projectIdRef.current !== sourceProjectId) return false
      await idbSet({ schemaVersion: 1, projectId: sourceProjectId, ...snapshot(), savedAt: Date.now() }); return true
    }
    catch (err) {
      if (err instanceof ProjectConflictError) {
        try {
          const copyId = crypto.randomUUID()
          await idbSet({ schemaVersion: 1, ...snapshot(), projectId: copyId, title: `${metadataRef.current.title}（冲突副本）`, savedAt: Date.now() })
          projectIdRef.current = copyId
          setProjectId(copyId)
          setTitleState(`${title}（冲突副本）`)
          toast.info('检测到其他页面修改，已将当前内容保存为冲突副本')
          return true
        } catch { /* 副本失败时保留当前工作区 */ }
      }
      toast.error('当前项目保存失败，请先下载项目备份', { description: storageErrorMessage(err) })
      return false
    }
  }
  const openLocalProjects = async () => {
    await persistCurrent()
    if (inputSessions.awaitingComposition) return
    try { setLocalProjects(await listLocalProjects()); setLibraryOpen(true) }
    catch { toast.error('本地项目列表读取失败，请重试') }
  }
  useDesktopClose(async () => {
    if (exporting || hasActiveFileOperation()) { toast.info('请先完成文件操作或配置保存，再关闭窗口'); return false }
    const persisted = storageReady && await persistCurrent()
    const current = { schemaVersion: 1 as const, projectId: projectIdRef.current, ...snapshot() }
    if (persisted && !projectFiles.dirty(current.projectId, current)) return true
    const { confirm } = await import('@tauri-apps/plugin-dialog')
    return confirm(persisted ? '当前修改已自动保存到本机，但关联的 JSON 文件尚未更新。可返回按 Ctrl+S 保存文件，或关闭后从本地项目恢复。仍然关闭？' : '本地保存未完成。建议留在编辑器下载项目备份，直接关闭可能丢失未保存修改。仍然关闭？', {
      title: 'OnlyPing · 未保存内容', kind: 'warning', okLabel: '仍然关闭', cancelLabel: '留在编辑器',
    })
  }, () => toast.error('关闭前保存失败，请先备份项目后重试'))
  const restoreLocal = async (entry: LocalProjectEntry) => {
    if (!await persistCurrent()) return
    try {
      const data = await readLocalProject(entry)
      if (!data) throw new Error('存档损坏或图片资源缺失')
      applyProject(data)
      setLibraryOpen(false)
      toast.success(entry.revision === undefined ? '已打开本地项目' : '已恢复历史版本')
    } catch (err) { toast.error(err instanceof Error ? err.message : '恢复失败') }
  }

  // Ctrl+Z / Ctrl+Y 撤销重做
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isComposingKey(e)) return
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
  const numberStarts = useMemo(() => computeNumberStarts(pages), [pages])
  const selectedAnnotations = selectedPage?.annotations.filter(a => selectedAnnIds.includes(a.id)) ?? []
  const selectedAnn = selectedAnnotations.length === 1 && !selectedAnnotations[0].locked && !selectedAnnotations[0].hidden ? selectedAnnotations[0] : null
  const editableAnnotations = editableSelection(selectedPage?.annotations ?? [], selectedAnnIds)
  const selectedAnnName = selectedAnn?.kind === 'number'
    ? `序号 ${(numberStarts.get(selectedPage?.id ?? '') ?? 0) + (selectedPage?.annotations.filter(a => a.kind === 'number' && !a.hidden).findIndex(a => a.id === selectedAnn.id) ?? -1) + 1}`
    : selectedAnn?.kind === 'text' && selectedAnn.background
      ? '文字框'
      : selectedAnn ? annotationLabel(selectedAnn) : ''
  const canvasStatus = tool === 'crop'
    ? '拖动选区或边缘手柄调整裁剪范围；在选区外拖拽可重新框选，Esc 重置选区'
    : selectedAnnotations.length > 1 ? `已选择 ${selectedAnnotations.length} 个标注，拖动或方向键批量移动；Shift 点击添加/移除`
    : selectedAnnotations[0]?.locked ? '已选中锁定标注，请从标注对象列表解锁后编辑'
    : selectedAnnotations[0]?.hidden ? '已选中隐藏标注，请从标注对象列表显示后编辑'
    : selectedAnn
      ? `已选中${selectedAnnName}，可拖动位置或调整大小，Ctrl+D 复制，Delete 删除`
      : '空格 + 拖动平移'

  const canvasWidth = selectedPage?.width
  const canvasHeight = selectedPage?.height
  useEffect(() => {
    const el = viewportRef.current
    if (!el || !canvasWidth || !canvasHeight || zoomMode === 'manual') return
    const fit = () => {
      const finish = startEditorPhase('canvas-fit')
      const width = Math.max(1, el.clientWidth - 32) / canvasWidth
      const height = Math.max(1, el.clientHeight - 64) / canvasHeight
      setZoom(Math.min(1, zoomMode === 'width' ? width : Math.min(width, height)))
      finish()
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [selectedPageId, canvasWidth, canvasHeight, zoomMode, rightOpen])

  const updateAnnSize = (patch: { size?: number; r?: number; tile?: number; width?: number; zoom?: number; color?: string; text?: string }) => {
    if (!selectedPage || !selectedAnnId) return
    updatePage(selectedPage.id, {
      annotations: selectedPage.annotations.map((a) =>
        a.id === selectedAnnId && !a.locked ? ({ ...a, ...patch } as typeof a) : a
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
    void inputSessions.transition(() => {
      commitPages((prev) => prev.filter((p) => p.id !== id))
      if (selectedPageId === id) setSelectedPageId(null)
    }, blurInput, inputBlocked).catch(() => toast.error('输入收尾失败，请重试'))
  }

  // 裁剪：图片裁为选区，标注坐标平移/裁剪，首次裁剪保留原图快照
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
        .map((a) => cropAnnotation(a, rect))
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
    setPreviewOpen(false)
    try {
      await exportTask.run(async task => {
        await taskCheckpoint(task, '正在准备导出', 0, pages.length)
        // 整份导出前先跑全量检查：确定性检查 +（可选）AI 隐私扫描；有警告需用户确认
        if (kind !== 'page') {
          const found = runConsistencyChecks(title, pages, exportFooter)
          let all = found
          if (autoAiScan && (aiConfig.apiKey || aiConfig.demo) && pages.length) {
            setAiScanning(true)
            setAiScanProgress('')
            try {
              all = [...found, ...(await collectAiPrivacyIssues(task))]
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
        checkTask(task)
        const stepImageScale = (exportStyle.stepImageScale ?? 100) / 100
        if (kind === 'docx') await exportDocx(title, pages, exportStyle, exportFooter, stepImageScale, task)
        else if (kind === 'pdf') await exportPdf(title, pages, exportStyle, exportFooter, stepImageScale, task)
        else if (kind === 'long') await exportLongImage(title, pages, exportStyle, exportFooter, stepImageScale, task)
        else if (selectedPage) await downloadPageImage(selectedPage, numberStarts.get(selectedPage.id) ?? 0, task)
      })
    } catch (err) {
      if (isTaskCancelled(err)) toast.info('已取消导出')
      else toast.error('导出失败', { description: err instanceof Error ? err.message : '请重试' })
    }
  }

  const saveProject = async () => {
    try {
      const sourceProjectId = projectIdRef.current
      if (!await inputSessions.settle(blurInput)) { inputBlocked(); return }
      if (projectIdRef.current !== sourceProjectId) return
      const blob = new Blob([JSON.stringify({ schemaVersion: 1, projectId: sourceProjectId, ...snapshot() }, null, 2)], {
        type: 'application/json',
      })
      await saveFile(blob, `${metadataRef.current.title || '明白纸项目'}.json`)
    } catch (error) { if (!isTaskCancelled(error)) toast.error('项目备份失败，请保留当前页面并重试', { description: error instanceof Error ? error.message : '输入收尾失败' }) }
  }

  const runProjectFileOperation = async (task: () => Promise<void>) => {
    if (projectFileTask.current) return
    projectFileTask.current = true; setProjectFileBusy(true)
    try { await withNativeOperation(task) }
    catch (error) { if (!isTaskCancelled(error)) toast.error('项目文件操作失败', { description: error instanceof Error ? error.message : '请保留当前编辑内容并重试' }) }
    finally { projectFileTask.current = false; setProjectFileBusy(false) }
  }

  const saveProjectFile = async (saveAs = false) => {
    if (!isDesktop()) { await saveProject(); return }
    await runProjectFileOperation(async () => {
      const sourceId = projectIdRef.current
      if (!await inputSessions.settle(blurInput)) { inputBlocked(); return }
      if (projectIdRef.current !== sourceId) return
      const data = { schemaVersion: 1 as const, projectId: sourceId, ...snapshot() }
      if (!validateAutosave(data)) throw new Error('当前项目包含无效数据，未覆盖项目文件；请先另存一份恢复备份')
      const path = await projectFiles.save(data, saveAs)
      if (path) { setProjectFileRevision(n => n + 1); toast.success(`项目文件已保存：${projectFilename(path)}`) }
    })
  }

  const createProject = async () => {
    if (!await persistCurrent()) return
    inputSessions.invalidate()
    projectIdRef.current = crypto.randomUUID()
    setProjectId(projectIdRef.current)
    clearImageCache()
    const name = newProjectName.trim() || '未命名明白纸'
    history.current.clear()
    pagesRef.current = []
    metadataRef.current = { title: name, exportStyle: DEFAULT_EXPORT_STYLE, exportFooter: DEFAULT_EXPORT_FOOTER }
    setPages([])
    setTitleState(name)
    setExportStyleState(DEFAULT_EXPORT_STYLE)
    setExportFooterState(DEFAULT_EXPORT_FOOTER)
    setSelectedPageId(null)
    setSelectedAnnId(null)
    setTool('select')
    setZoomMode('fit')
    setCheckSig(null)
    setIssues([])
    setSaveNote('正在保存新项目…')
    setNewProjectOpen(false)
  }

  const applyProject = (data: ProjectData) => {
    clearImageCache()
    inputSessions.invalidate()
    projectIdRef.current = data.projectId ?? crypto.randomUUID()
    setProjectId(projectIdRef.current)
    history.current.clear()
    pagesRef.current = data.pages
    setPages(data.pages)
    setSelectedAnnId(null)
    setStorageReady(true)
    setTitleState(data.title ?? '明白纸')
    setExportStyleState(restoreExportStyle(data.exportStyle))
    setExportFooterState(data.exportFooter ?? DEFAULT_EXPORT_FOOTER)
    setSelectedPageId(data.pages[0]?.id ?? null)
    metadataRef.current = { title: data.title, exportStyle: data.exportStyle, exportFooter: data.exportFooter }
    setTool('select')
    setZoomMode('fit')
    setIssues([])
    setCheckSig(null)
  }

  const loadProject = async (file: File, source?: ProjectFileSource) => {
    const sourceId = projectIdRef.current
      try {
        const data = JSON.parse((await file.text()).replace(/^\uFEFF/, ''))
        const validated = validateAutosave(data)
        if (!validated) {
          toast.error('项目文件损坏或格式不正确，未切换工作区')
          return
        }
        if (sourceId !== projectIdRef.current) return
        if (!await persistCurrent()) return
        const opened = { ...validated, exportStyle: restoreExportStyle(validated.exportStyle), schemaVersion: 1 as const, projectId: crypto.randomUUID() }
        applyProject(opened)
        if (source) { projectFiles.bind(opened.projectId, source, opened); setProjectFileRevision(n => n + 1) }
        toast.success(source ? '已打开项目文件；本机存档与文件保存分别管理' : '已导入为独立本地项目')
      } catch {
        toast.error('项目文件解析失败，原工作区保留')
      }
  }

  const chooseProject = async () => {
    if (!isDesktop()) { projectFileRef.current?.click(); return }
    await runProjectFileOperation(async () => { const source = await projectFiles.open(); if (source) await loadProject(source.file, source) })
  }
  useProjectFileShortcuts(saveProjectFile, chooseProject)

  const [toolOrder, setToolOrder] = useState<Tool[]>(() => {
    const saved = loadJSON<Tool[]>('mbz-tool-order', (v): v is Tool[] => Array.isArray(v) && v.every(x => typeof x === 'string'))
    const defaults: Tool[] = DEFAULT_TOOL_ORDER
    return [...new Set([...(saved ?? []), ...defaults])].filter((v): v is Tool => defaults.includes(v))
  })
  const [reorderingTools, setReorderingTools] = useState(false)
  const draggedTool = useRef<Tool | null>(null)
  useEffect(() => { localStorage.setItem('mbz-tool-order', JSON.stringify(toolOrder)) }, [toolOrder])
  const moveTool = (from: Tool, to: Tool, after = false) => {
    if (from === to) return
    setToolOrder(current => { const next = current.filter(v => v !== from); next.splice(next.indexOf(to) + (after ? 1 : 0), 0, from); return next })
  }
  const TOOLS = TOOL_DEFINITIONS.map(t => ({ ...t, icon: <ToolIcon tool={t.value} /> }))

  const orderedTools = toolOrder.map(value => TOOLS.find(t => t.value === value)!).filter(Boolean)

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
    <div className="ps-workspace flex h-screen min-w-[960px] flex-col overflow-hidden bg-background text-foreground"
      onInputCapture={() => { workspaceEdited.current = true }}
      onKeyDownCapture={event => {
        if (!isComposingKey(event.nativeEvent) && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) && !(event.target as HTMLElement).closest('input,textarea,select')) keyEditRef.current = true
      }}
      onCompositionStartCapture={() => { workspaceEdited.current = true; inputSessions.begin() }}
      onCompositionEndCapture={() => inputSessions.end()}
      onPointerDownCapture={() => { history.current.end(); gestureRef.current = true }}
      onFocusCapture={() => history.current.end()}
      onBlurCapture={() => history.current.end()}
    >
      <Toaster richColors position="bottom-right" />
      {/* 顶栏 */}
      <header className="z-20 flex h-12 shrink-0 items-center justify-between border-b border-white/10 bg-[#292929] px-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-[#3e78a7] text-white">
            <BookOpen className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold leading-tight tracking-tight">明白纸工作台</div>
            <div className="text-[10px] text-muted-foreground">OnlyPing</div>
          </div>
          <Separator orientation="vertical" className="mx-1 h-8" />
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            aria-label="项目标题"
            className="h-8 w-52 border-transparent bg-transparent px-2 text-sm font-medium shadow-none hover:border-white/20 focus-visible:bg-[#353535]"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground"
            title="撤销（Ctrl+Z）"
            aria-label="撤销"
            disabled={!history.current.canUndo}
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
            disabled={!history.current.canRedo}
            onClick={redo}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
          {(autosave.status || saveNote) && (
            <span className={`mr-1 inline-flex max-w-48 truncate items-center gap-1.5 px-2 py-1 text-[11px] font-medium ${(autosave.status || saveNote).includes('失败') ? 'text-amber-700' : 'text-emerald-700'}`}>
              <span className={`size-1.5 rounded-full ${(autosave.status || saveNote).includes('失败') ? 'bg-amber-500' : 'bg-emerald-500'}`} />
              <button type="button" onClick={() => setRecoveryOpen(true)} title={autosave.status || saveNote} className="truncate">{autosave.status || saveNote}</button>
            </span>
          )}
          {isDesktop() && <span className="max-w-48 truncate text-[11px] text-muted-foreground" title={fileBinding ? `${fileBinding.path}；${fileDirty ? '关联文件待保存' : '已与文件同步'}。文件关联仅限当前会话。` : '本机自动存档与 JSON 文件分别保存；Ctrl+S 可选择项目 JSON 文件'}>{fileBinding ? `${fileDirty ? '● ' : ''}${projectFilename(fileBinding.path)}` : '未关联项目文件'}</span>}
          <DropdownMenu onOpenChange={open => { if (open) void listLocalProjects().then(setLocalProjects).catch(() => setLocalProjects([])) }}>
            <DropdownMenuTrigger asChild><Button variant="outline" size="sm"><FolderOpen className="size-4" />项目</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={projectFileBusy} onClick={() => { setNewProjectName('未命名明白纸'); setNewProjectOpen(true) }}><FilePlus2 className="mr-2 size-4" />新建项目</DropdownMenuItem>
              <DropdownMenuItem disabled={projectFileBusy} onClick={() => void chooseProject()}><FolderOpen className="mr-2 size-4" />打开项目文件… <span className="ml-auto pl-3 text-xs text-muted-foreground">Ctrl+O</span></DropdownMenuItem>
              <DropdownMenuItem disabled={projectFileBusy} onClick={() => void saveProjectFile()}><Save className="mr-2 size-4" />{isDesktop() ? '保存项目文件' : '下载项目 JSON'} <span className="ml-auto pl-3 text-xs text-muted-foreground">Ctrl+S</span></DropdownMenuItem>
              {isDesktop() && <DropdownMenuItem disabled={projectFileBusy} onClick={() => void saveProjectFile(true)}>项目文件另存为… <span className="ml-auto pl-3 text-xs text-muted-foreground">Ctrl+Shift+S</span></DropdownMenuItem>}
              <DropdownMenuItem disabled={projectFileBusy} onClick={saveProject}>另存一份备份…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>最近本地项目</DropdownMenuLabel>
              {localProjects.filter(entry => entry.revision === undefined && entry.key !== `project:${projectId}`).slice(0, 5).map(entry => <DropdownMenuItem key={entry.key} disabled={projectFileBusy} onClick={() => void restoreLocal(entry)}><span className="max-w-64 truncate">{entry.title}</span></DropdownMenuItem>)}
              <DropdownMenuItem disabled={projectFileBusy} onClick={() => void openLocalProjects()}>本地项目与历史版本…</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setRecoveryOpen(true)}><CircleAlert className="mr-2 size-4" />本地存储与恢复</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 bg-background">
                <Type className="size-4" />
                导出样式
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80" align="end">
              <div className="space-y-3">
                <div className="text-xs font-medium text-slate-600">导出版式</div>
                {(
                  [
                    { key: 'title', alignKey: 'titleAlign', label: '主标题' },
                    { key: 'heading', alignKey: 'headingAlign', label: '步骤标题' },
                    { key: 'notes', alignKey: 'notesAlign', label: '说明文字' },
                  ] as const
                ).map(({ key, alignKey, label }) => (
                  <div key={key} className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="w-14 shrink-0">{label}</span>
                    <Slider
                      min={key === 'notes' ? 12 : 16}
                      max={key === 'notes' ? 32 : 56}
                      value={[exportStyle[key]]}
                      onValueChange={([value]) => setExportStyle((s) => ({ ...s, [key]: value }))}
                      className="mx-1 flex-1"
                      aria-label={`${label}字号`}
                    />
                    <span className="w-6 text-right tabular-nums">{exportStyle[key]}</span>
                    <Select
                      value={exportStyle[alignKey] ?? 'left'}
                      onValueChange={(value) => setExportStyle((s) => ({ ...s, [alignKey]: value as TextAlignment }))}
                    >
                      <SelectTrigger size="sm" className="h-7 w-[76px] px-2 text-xs" aria-label={`${label}对齐方式`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="left">靠左</SelectItem>
                        <SelectItem value="center">居中</SelectItem>
                        <SelectItem value="right">靠右</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <div className="border-t pt-3">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    步骤图片宽度
                    <Slider
                      min={25}
                      max={100}
                      step={5}
                      value={[exportStyle.stepImageScale ?? 100]}
                      onValueChange={([stepImageScale]) => setExportStyle((s) => ({ ...s, stepImageScale }))}
                      className="mx-1 flex-1"
                      aria-label="步骤图片宽度比例"
                    />
                    <span className="w-9 text-right tabular-nums">{exportStyle.stepImageScale ?? 100}%</span>
                  </label>
                  {selectedPage && (
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      单页 PNG 保持原尺寸：{selectedPage.width} × {selectedPage.height} px
                    </div>
                  )}
                  <div className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
                    只调整长图、Word 和 PDF 中每一步截图的显示宽度；标题、说明、页面画布及单页 PNG 保持原尺寸。
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={() => setExportStyle(DEFAULT_EXPORT_STYLE)}
                >
                  恢复默认样式
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
          <Button variant="outline" size="sm" className="h-9 bg-background" disabled={exporting || !pages.length} onClick={() => setPreviewOpen(true)}>
            <Eye className="size-4" />
            预览导出
          </Button>
          {exporting && <div className="flex items-center gap-2 text-xs" role="status"><span className="max-w-44 truncate" title={exportTask.progress?.phase}>{exportTask.progress ? `${exportTask.progress.phase} ${exportTask.progress.completed}/${exportTask.progress.total}` : '正在准备…'}</span><Button size="sm" variant="outline" onClick={exportTask.cancel}>取消导出</Button></div>}
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

      <div className="flex h-11 shrink-0 items-center border-b border-white/10 bg-[#323232]">
        <div className="flex h-full w-12 shrink-0 items-center justify-center border-r border-white/10 text-[#b9b9b9]" title="当前工具">{TOOLS.find(t => t.value === tool)?.icon}</div>
        <span className="shrink-0 px-3 text-xs font-medium text-[#d8d8d8]">{TOOLS.find(t => t.value === tool)?.label}</span>
          <div className="ps-options flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-3 text-xs">
            {(!selectedAnn || 'color' in selectedAnn) && <div className="flex shrink-0 items-center gap-0.5" aria-label="标注颜色">
              {COLORS.map((c) => (
                <Button
                  key={c}
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => selectedAnn && 'color' in selectedAnn ? updateAnnSize({ color: c }) : setColor(c)}
                  aria-label={`标注颜色 ${c}`}
                  aria-pressed={(selectedAnn && 'color' in selectedAnn ? selectedAnn.color : color) === c}
                  className={`size-7 rounded-md p-0 transition-colors ${
                    (selectedAnn && 'color' in selectedAnn ? selectedAnn.color : color) === c ? 'bg-white/20 ring-1 ring-white/70' : 'hover:bg-white/10'
                  }`}
                  title={`标注颜色 ${c}`}
                >
                  <span className="size-5 rounded-[4px] ring-1 ring-white/15" style={{ background: c }} />
                </Button>
              ))}
            </div>}

            {!selectedAnn && TOOL_CATALOG[tool].parameter && TOOL_CATALOG[tool].parameter !== 'zoom' && (() => {
              const key = TOOL_CATALOG[tool].parameter as 'numberR' | 'textSize' | 'mosaicTile' | 'strokeWidth'
              const { label, min, max } = TOOL_PARAMETERS[key]
              return <label className="flex shrink-0 items-center gap-2 border-l border-white/10 pl-3 text-slate-300">{label}<Slider min={min} max={max} value={[annStyle[key]]} onValueChange={([value]) => setAnnStyle(v => ({ ...v, [key]: value }))} className="w-28" aria-label={label} /><span className="min-w-6 rounded-md bg-white/10 px-1.5 py-1 text-center tabular-nums text-white">{annStyle[key]}</span></label>
            })()}

            {/* 样式模板：新建标注默认样式 + 预设管理 */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="icon-sm" className="size-8 shrink-0 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white" aria-label="样式预设" title="样式预设">
                  <Palette className="size-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-72 border-white/10 bg-slate-950 text-slate-100 shadow-2xl" align="start">
                <div className="space-y-3">
                  <div className="text-xs font-medium text-slate-300">
                    新建标注默认样式（与当前对象属性独立）
                  </div>
                  <div className="flex gap-2">{COLORS.map(c => <button key={c} aria-label={`新建默认颜色 ${c}`} aria-pressed={annStyle.color === c} className="size-6 rounded-full border-2 aria-pressed:border-white" style={{ background: c }} onClick={() => setColor(c)} />)}</div>
                  {(
                    [
                      { key: 'numberR', label: '序号大小', min: 12, max: 56 },
                      { key: 'textSize', label: '文字字号', min: 16, max: 80 },
                      { key: 'mosaicTile', label: '打码强度', min: MOSAIC_MIN_TILE, max: MOSAIC_MAX_TILE },
                      { key: 'strokeWidth', label: '线宽', min: 2, max: 16 },
                    ] as const
                  ).map(({ key, label, min, max }) => (
                    <label key={key} className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-slate-300">
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
                    className="h-8 w-full bg-white/10 text-xs text-slate-100 hover:bg-white/15"
                    disabled={!pages.length}
                    title="把当前样式应用到所有页面的已有标注（可用 Ctrl+Z 撤销）"
                    onClick={() => {
                      if (window.confirm('将把全部已有标注统一为当前样式（可用撤销恢复），继续？')) applyStyleToAll()
                    }}
                  >
                    套用当前样式到全部页面
                  </Button>

                  <div className="border-t pt-3">
                    <div className="mb-2 text-xs font-medium text-slate-300">样式预设</div>
                    <div className="mb-2 flex gap-1.5">
                      <Input
                        value={presetName}
                        onChange={(e) => setPresetName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && !isComposingKey(e.nativeEvent) && savePreset()}
                        placeholder="预设名称，如：银行红-大字号"
                        className="h-8 flex-1 border-white/15 bg-white/10 text-xs text-white placeholder:text-slate-500"
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
                            className="group flex items-center gap-2 rounded border border-white/10 px-2 py-1.5"
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
                              className="h-8 min-w-0 flex-1 justify-start truncate px-1 text-left text-xs font-normal text-slate-300 hover:text-white"
                              title={`套用：序号 ${p.numberR} · 文字 ${p.textSize}px · 打码 ${p.mosaicTile}px`}
                              onClick={() => applyPreset(p)}
                            >
                              {p.name}
                              <span className="ml-1.5 shrink-0 text-[10px] text-slate-400">
                                序{p.numberR} · 字{p.textSize} · 码{p.mosaicTile}
                              </span>
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`删除样式预设：${p.name}`}
                              className="size-7 shrink-0 text-slate-300 hover:bg-destructive/10 hover:text-destructive"
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

            {selectedAnn && <AnnotationParameters annotation={selectedAnn} onChange={updateAnnSize} />}
            {selectedAnn?.kind === 'mosaic' && (
              <span className="text-[11px] text-slate-400">数值越大越模糊，二维码建议 ≥ 24px</span>
            )}
            {selectedPage?.orig && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 rounded-lg px-2 text-xs text-slate-300 hover:bg-white/10 hover:text-white"
                title="恢复将回到裁剪前的图片与标注（裁剪后新增的标注会丢失）"
                onClick={() => restoreCrop(selectedPage)}
              >
                <RotateCcw className="mr-1 h-3.5 w-3.5" />
                恢复原图
              </Button>
            )}


            {selectedAnn && (selectedAnn.kind === 'text' || selectedAnn.kind === 'callout') && (
              <Button variant="ghost" size="icon-sm" className="size-8 shrink-0 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white" aria-label="编辑标注文字" title="在标注内编辑文字" onClick={() => setEditTextRequest(v => v + 1)}>
                <Type className="size-4" />
              </Button>
            )}
            {selectedAnnotations.length > 1 && selectedPage && <div className="flex shrink-0 items-center gap-1 border-l border-white/10 pl-2 text-xs text-[#ccc]">
              <span>已选 {selectedAnnotations.length} 项</span>
              <Button variant="ghost" size="icon-sm" aria-label="批量复制标注" disabled={!editableAnnotations.length} onClick={() => { const copies = copySelection(selectedPage.annotations, selectedAnnIds, uid); updatePage(selectedPage.id, { annotations: [...selectedPage.annotations, ...copies] }); setSelectedAnnIds(copies.map(a => a.id)) }}><Copy className="size-4" /></Button>
              <Button variant="ghost" size="icon-sm" aria-label="批量删除标注" disabled={!editableAnnotations.length} onClick={() => { const ids = new Set(editableAnnotations.map(a => a.id)); updatePage(selectedPage.id, { annotations: selectedPage.annotations.filter(a => !ids.has(a.id)) }); setSelectedAnnId(null) }}><Trash2 className="size-4" /></Button>
              <Button variant="ghost" size="sm" onClick={() => updatePage(selectedPage.id, { annotations: selectedPage.annotations.map(a => selectedAnnIds.includes(a.id) ? { ...a, locked: true } : a) })}>锁定</Button>
              <Button variant="ghost" size="sm" onClick={() => updatePage(selectedPage.id, { annotations: selectedPage.annotations.map(a => selectedAnnIds.includes(a.id) ? { ...a, locked: false } : a) })}>解锁</Button>
            </div>}
            {selectedAnn && selectedPage && <div className="flex shrink-0 items-center gap-0.5 border-l border-white/10 pl-2">
              <Button variant="ghost" size="icon-sm" className="size-8 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white" aria-label="复制标注" title="复制标注" onClick={() => { const copy = duplicateAnnotation(selectedAnn, uid(), 12); updatePage(selectedPage.id, { annotations: [...selectedPage.annotations, copy] }); setSelectedAnnId(copy.id) }}><Copy className="size-4" /></Button>
              <Button variant="ghost" size="icon-sm" className="size-8 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white" aria-label="标注置顶" title="标注置顶" onClick={() => updatePage(selectedPage.id, { annotations: [...selectedPage.annotations.filter(a => a.id !== selectedAnn.id), selectedAnn] })}><ArrowUpToLine className="size-4" /></Button>
              <Button variant="ghost" size="icon-sm" className="size-8 rounded-lg text-slate-300 hover:bg-white/10 hover:text-white" aria-label="标注置底" title="标注置底" onClick={() => updatePage(selectedPage.id, { annotations: [selectedAnn, ...selectedPage.annotations.filter(a => a.id !== selectedAnn.id)] })}><ArrowDownToLine className="size-4" /></Button>
              <Button variant="ghost" size="icon-sm" className="size-8 rounded-lg text-rose-300 hover:bg-rose-500/15 hover:text-rose-200" aria-label="删除标注" title="删除标注" onClick={() => { updatePage(selectedPage.id, { annotations: selectedPage.annotations.filter(a => a.id !== selectedAnn.id) }); setSelectedAnnId(null) }}><Trash2 className="size-4" /></Button>
            </div>}
          </div>
        <Button variant="ghost" size="sm" className="mx-2 shrink-0 text-xs text-[#bcbcbc]" onClick={() => setShortcutsOpen(true)}><Keyboard className="size-4" />快捷键</Button>
        <Button variant="ghost" size="icon-sm" className="mr-2 shrink-0 text-[#bcbcbc]" aria-label="切换右侧面板" aria-pressed={rightOpen} onClick={() => setRightOpen(v => !v)}><PanelRight className="size-4" /></Button>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <nav className="flex w-12 shrink-0 flex-col border-r border-white/10 bg-[#272727]" aria-label="标注工具栏">
          <div role="toolbar" aria-label="标注工具" className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto py-2">
              {orderedTools.map((t) => (
                <Tooltip key={t.value}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setTool(t.value)}
                      draggable={reorderingTools}
                      onDragStart={e => { draggedTool.current = t.value; e.dataTransfer.effectAllowed = 'move' }}
                      onDragOver={e => { if (reorderingTools) e.preventDefault() }}
                      onDrop={e => { e.preventDefault(); if (draggedTool.current) moveTool(draggedTool.current, t.value); draggedTool.current = null }}
                      onKeyDown={e => {
                        if (!reorderingTools || !e.altKey || !['ArrowUp', 'ArrowDown'].includes(e.key)) return
                        e.preventDefault()
                        const index = toolOrder.indexOf(t.value)
                        const neighbor = toolOrder[index + (e.key === 'ArrowUp' ? -1 : 1)]
                        if (neighbor) moveTool(t.value, neighbor, e.key === 'ArrowDown')
                      }}
                      aria-label={t.label}
                      aria-pressed={tool === t.value}
                      title={`${t.label}（${t.shortcut}）${reorderingTools ? ' · 拖动排序，或 Alt+↑/↓' : ''}`}
                      className={`flex size-9 shrink-0 items-center justify-center rounded-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 ${tool === t.value ? 'bg-[#4b80ad] text-white' : 'text-[#c3c3c3] hover:bg-white/10 hover:text-white'} ${reorderingTools ? 'cursor-grab ring-1 ring-sky-300/30' : ''}`}
                    >
                      {t.icon}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <span className="flex items-center gap-3">
                      {t.label}
                      <kbd className="rounded border border-white/20 bg-white/10 px-1.5 py-0.5 font-mono text-[10px]">{t.shortcut}</kbd>
                    </span>
                  </TooltipContent>
                </Tooltip>
              ))}
          </div>
          <Button variant="ghost" size="icon-sm" className={`mx-auto mb-2 size-9 shrink-0 rounded-sm text-[#bdbdbd] hover:bg-white/10 hover:text-white ${reorderingTools ? 'bg-[#4b80ad] text-white' : ''}`} aria-label={reorderingTools ? '完成工具排序' : '调整工具顺序'} aria-pressed={reorderingTools} onClick={() => setReorderingTools(v => !v)} title={reorderingTools ? '完成工具排序' : '拖动或按 Alt + ↑/↓ 调整工具顺序'}><GripVertical className="size-4" /></Button>
        </nav>

        {/* 中间编辑区 */}
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-8 shrink-0 items-center border-b border-white/10 bg-[#333333] px-2 text-[11px] text-[#c8c8c8]">
            <span className="flex h-full max-w-64 items-center gap-2 border-x border-white/10 bg-[#454545] px-3"><ImageIcon className="size-3.5" /><span className="truncate">{selectedPage?.name || '未打开文档'}</span>{selectedPage && <span className="text-[#a3a3a3]">@ {Math.round(zoom * 100)}%</span>}</span>
            {selectedPage && <span className="ml-3 text-[#999]">{selectedPage.width} × {selectedPage.height} px</span>}
          </div>
          <div
            ref={viewportRef}
            className={`min-h-0 flex-1 overflow-auto bg-[#454545] p-8 ${spaceHeld ? 'cursor-grab' : ''}`}
            onPointerDownCapture={e => {
              if (!spaceHeld && e.button !== 1) return
              e.preventDefault(); e.stopPropagation()
              e.currentTarget.setPointerCapture(e.pointerId)
              panRef.current = { x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, top: e.currentTarget.scrollTop }
              suppressPanClick.current = true
            }}
            onPointerMoveCapture={e => {
              const pan = panRef.current
              if (!pan) return
              e.stopPropagation()
              e.currentTarget.scrollLeft = pan.left - (e.clientX - pan.x)
              e.currentTarget.scrollTop = pan.top - (e.clientY - pan.y)
            }}
            onPointerUpCapture={e => { if (panRef.current) { e.stopPropagation(); panRef.current = null; e.currentTarget.releasePointerCapture(e.pointerId); setTimeout(() => { suppressPanClick.current = false }, 0) } }}
            onPointerCancel={() => { panRef.current = null; suppressPanClick.current = false }}
            onClickCapture={e => { if (suppressPanClick.current) { e.stopPropagation(); suppressPanClick.current = false } }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={importDropped}
          >
            {selectedPage ? (
              <CanvasEditor
                inputSessions={inputSessions}
                key={selectedPage.id}
                page={selectedPage}
                tool={tool}
                color={color}
                zoom={zoom}
                numberStart={numberStarts.get(selectedPage.id) ?? 0}
                mosaicTile={annStyle.mosaicTile}
                numberR={annStyle.numberR}
                textSize={annStyle.textSize}
                strokeWidth={annStyle.strokeWidth}
                selectedId={selectedAnnId}
                selectedIds={selectedAnnIds}
                onSelectionChange={setSelectedAnnIds}
                editTextRequest={editTextRequest}
                onTextEditingChange={setPendingText}
                onSelect={setSelectedAnnId}
                onChange={(annotations) => updatePage(selectedPage.id, { annotations })}
                onZoomChange={manualZoom}
                onCrop={(rect) => applyCrop(selectedPage, rect)}
              />
            ) : (
              <div className="flex h-full min-h-80 flex-col items-center justify-center text-center text-muted-foreground">
                <ImageIcon className="mb-3 size-6 text-muted-foreground/70" />
                <p className="text-sm font-medium text-foreground">打开一张截图开始标注</p>
                <p className="mt-1 text-xs">从右侧添加、粘贴或拖入图片</p>
                <span className="mt-3 border bg-card px-2 py-1 text-[11px] font-medium">Ctrl + V</span>
              </div>
            )}
          </div>

          <div className="flex h-10 shrink-0 items-center gap-2 overflow-hidden border-t border-white/10 bg-[#292929] px-3 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground" title={canvasStatus}>{canvasStatus}</span>
            {/* 画布缩放 */}
            <div className="flex shrink-0 items-center gap-0.5 rounded-md border bg-background p-0.5">
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                title="缩小（Ctrl+滚轮）"
                aria-label="缩小画布"
                onClick={() => manualZoom(zoom / 1.2)}
              >
                <ZoomOut className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 min-w-14 px-1 text-xs tabular-nums text-muted-foreground"
                title="点击恢复 100%"
                onClick={() => manualZoom(1)}
              >
                {Math.round(zoom * 100)}%
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                title="放大（Ctrl+滚轮）"
                aria-label="放大画布"
                onClick={() => manualZoom(zoom * 1.2)}
              >
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                title="完整显示整张截图"
                onClick={() => setZoomMode('fit')}
              >
                适应画布
              </Button>
            </div>
            <span className="hidden max-w-48 truncate text-xs text-slate-400 xl:inline">
              共 {pages.length} 页{selectedPage ? ` · 当前：${selectedPage.name}` : ''}
            </span><Button variant="ghost" size="sm" onClick={() => setZoomMode('width')}>适应宽度</Button>          </div>

        </div>

        {rightOpen && <PanelResizeHandle label="调整检查器宽度" width={rightWidth} min={260} max={440} direction={-1} onChange={setRightWidth} />}
        <aside className={`${rightOpen ? 'flex' : 'hidden'} shrink-0 flex-col border-l border-white/10 bg-[#262626]`} style={{ width: rightWidth, maxWidth: `calc(100vw - 430px)` }} aria-label="编辑检查器">
          <div className="flex shrink-0 gap-1 border-b p-2" role="tablist" aria-label="检查器面板">
            {([['steps', '步骤编辑'], ['ai', 'AI 辅助']] as const).map(([value, label]) => <Button key={value} role="tab" aria-selected={inspector === value} variant={inspector === value ? 'secondary' : 'ghost'} size="sm" onClick={() => setInspector(value)}>{label}</Button>)}
          </div>
          <div className={`${inspector === 'steps' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col overflow-hidden`}>
            <div className="min-h-[120px] shrink-0 overflow-hidden" style={{ height: `${stepListHeight}%`, maxHeight: 'calc(100% - 210px)' }}>
              <PageList
          key={projectId}
          pages={pages}
          selectedId={selectedPageId}
          onImportFiles={importFiles}
          onSelect={selectStep}
          onMove={movePage}
          onReorder={(sourceId, targetId) => commitPages(prev => {
            const source = prev.find(p => p.id === sourceId)
            if (!source || sourceId === targetId) return prev
            const next = prev.filter(p => p.id !== sourceId)
            const target = next.findIndex(p => p.id === targetId)
            if (target < 0) return prev
            next.splice(target, 0, source)
            return next
          })}
          onRemove={removePage}
          onDuplicate={(id) => { void inputSessions.transition(() => { const source = pagesRef.current.find(p => p.id === id); if (!source) return; const copy = { ...source, id: uid(), name: `${source.name} 副本`, annotations: source.annotations.map(a => ({ ...a, id: uid() })) }; commitPages(prev => { const next = [...prev]; next.splice(next.findIndex(p => p.id === id) + 1, 0, copy); return next }); setSelectedPageId(copy.id); setSelectedAnnId(null) }, blurInput, inputBlocked).catch(() => toast.error('输入收尾失败，请重试')) }}
              />
            </div>
            {selectedPage && <AnnotationList key={selectedPage.id} numberStart={numberStarts.get(selectedPage.id) ?? 0} annotations={selectedPage.annotations} selectedIds={selectedAnnIds} onSelectionChange={setSelectedAnnIds} onChange={annotations => updatePage(selectedPage.id, { annotations })} />}
            <div role="separator" aria-label="调整步骤列表高度" aria-orientation="horizontal" tabIndex={0}
              className="h-2 shrink-0 cursor-row-resize border-y border-white/10 bg-[#303030] hover:bg-[#4b80ad] focus-visible:bg-[#4b80ad] focus-visible:outline-none"
              onPointerDown={e => { resizingStepList.current = true; e.currentTarget.setPointerCapture(e.pointerId) }}
              onPointerMove={e => {
                if (!resizingStepList.current) return
                const bounds = e.currentTarget.parentElement?.getBoundingClientRect()
                if (bounds) setStepListHeight(Math.max(22, Math.min(72, ((e.clientY - bounds.top) / bounds.height) * 100)))
              }}
              onPointerUp={e => { resizingStepList.current = false; e.currentTarget.releasePointerCapture(e.pointerId) }}
              onPointerCancel={() => { resizingStepList.current = false }}
              onKeyDown={e => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                e.preventDefault()
                setStepListHeight(value => Math.max(22, Math.min(72, value + (e.key === 'ArrowDown' ? 5 : -5))))
              }}
            />
            <div className="min-h-0 flex-1 overflow-y-auto bg-[#292929] px-3 py-3">
              <div className="mb-3 flex items-center justify-between text-xs font-medium text-[#d6d6d6]">
                <span>步骤说明{selectedPage ? ` · 第 ${pages.indexOf(selectedPage) + 1} 页` : ''}</span>
                <span className="text-[10px] font-normal text-[#999]">自动保存</span>
              </div>
              {selectedPage ? (
                <div className="space-y-3">
                  <div>
                    <Label htmlFor="step-name" className="mb-1.5 block text-xs text-[#bcbcbc]">步骤名称</Label>
                    <Input id="step-name" className="h-8 border-white/15 bg-[#303030] text-sm" value={selectedPage.name} onChange={e => updatePage(selectedPage.id, { name: e.target.value }, true)} />
                  </div>
                  <div>
                    <Label className="mb-1.5 block text-xs text-[#bcbcbc]">说明文字</Label>
                    <StepNotesEditor key={projectId} inputSessions={inputSessions} documentId={selectedPage.id} notes={selectedPage.notes} notesRich={selectedPage.notesRich}
                      onChange={(notes, notesRich) => updatePage(selectedPage.id, { notes, notesRich }, true)} />
                  </div>
                </div>
              ) : <p className="text-xs text-muted-foreground">添加或选择截图后编写步骤说明。</p>}
            </div>
          </div>
          <div className={`${inspector === 'ai' ? 'flex' : 'hidden'} min-h-0 flex-1 flex-col`}>
        <AsyncAIPanel
          enabled={inspector === 'ai' && aiConfigReady}
          key={projectId}
          projectId={projectId}
          config={aiConfig}
          onConfigChange={setAIConfig}
          pages={pages}
          selectedPageId={selectedPageId}
          onUpdatePage={(id, patch, expected) => {
            const current = pagesRef.current.find(p => p.id === id)
            if (!current || current !== expected) throw new Error('此步骤在生成期间已修改或切换项目，未覆盖现有内容，请重新生成。')
            updatePage(id, 'notes' in patch ? { ...patch, notesRich: undefined } : patch)
          }}
        />          </div>
        </aside>
      </div>
      <ProjectLibrary open={libraryOpen} onOpenChange={setLibraryOpen} entries={localProjects} activeKey={`project:${projectId}`} onRestore={entry => void restoreLocal(entry)} onBackup={saveProject} onDelete={async entry => {
        if (entry.key === `project:${projectId}`) throw new Error('请先切换到其他项目，再删除此项目')
        await deleteLocalProject(entry.key)
        setLocalProjects(await listLocalProjects())
        toast.success('已删除项目、历史版本及独占图片')
      }} />
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}><DialogContent><DialogHeader><DialogTitle>快捷键</DialogTitle><DialogDescription>输入文字时不会触发工具切换。</DialogDescription></DialogHeader><div className="grid grid-cols-2 gap-3 text-sm">{orderedTools.map(t => <div key={t.value} className="flex justify-between border-b pb-2"><span>{t.label}</span><kbd>{t.shortcut}</kbd></div>)}</div><p className="text-sm text-muted-foreground">Ctrl+Z 撤销 · Ctrl+Shift+Z 重做 · Shift 点击多选 · Ctrl+A 选择可编辑标注 · Ctrl+D 复制标注 · Delete 删除 · 方向键微移 · Shift+方向键移动 10px · 空格拖动平移 · Ctrl+滚轮缩放</p></DialogContent></Dialog>
      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}><DialogContent><DialogHeader><DialogTitle>新建项目</DialogTitle><DialogDescription>{pages.length ? '创建前会保存当前项目，可从本地项目列表重新打开。建议定期下载项目备份。' : '创建一个空白项目，之后可以添加截图。'}</DialogDescription></DialogHeader><Label htmlFor="new-project-name">项目名称</Label><Input id="new-project-name" value={newProjectName} onChange={e => setNewProjectName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !isComposingKey(e.nativeEvent)) createProject() }} autoFocus /><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setNewProjectOpen(false)}>取消</Button><Button onClick={createProject}>创建项目</Button></div></DialogContent></Dialog>
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
            {aiScanning && <Button size="sm" variant="outline" onClick={() => privacyController.current ? privacyController.current.abort() : exportTask.cancel()}>取消扫描</Button>}
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
      <StorageRecovery open={recoveryOpen} onOpenChange={setRecoveryOpen} error={storageError ?? autosave.error} loading={storageLoading} onRetry={() => {
        if (storageError || !storageReady) setStorageAttempt(n => n + 1)
        else autosave.retry()
      }} onBackup={saveProject} />
    </div>
  )
}
