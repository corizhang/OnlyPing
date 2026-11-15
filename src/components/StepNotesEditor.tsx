import { useLayoutEffect, useMemo, useRef } from 'react'
import { createDocument, Extension } from '@tiptap/core'
import { freshNotesState } from '@/lib/notes-editor-state'
import type { InputSettlement } from '@/lib/input-settlement'
import { EditorContent, useEditor, useEditorState } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { BackgroundColor, Color, FontSize, TextStyle } from '@tiptap/extension-text-style'
import TextAlign from '@tiptap/extension-text-align'
import { AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, Eraser, Italic, List, ListOrdered, MoreHorizontal, PaintBucket, Strikethrough, Type, Underline } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { notesLineHeight, safeNotesHtml } from '@/lib/notes'

const TEXT_COLORS = ['#202020', '#64748B', '#E11D48', '#DC2626', '#D97706', '#15803D', '#2563EB', '#7C3AED']
const BACKGROUND_COLORS = ['#FFF2A8', '#FFD8D8', '#D9F4DD', '#D9EAFE', '#E9D8FD', '#E5E7EB']
const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32]
const LINE_HEIGHTS = [1, 1.2, 1.5, 1.8, 2]

// 行间距作用于整段，避免只选中部分文字时同一行高度不一致。
const ParagraphLineHeight = Extension.create({
  name: 'paragraphLineHeight',
  addGlobalAttributes() {
    return [{ types: ['paragraph'], attributes: {
      lineHeight: {
        default: null,
        parseHTML: element => notesLineHeight(element.style.lineHeight),
        renderHTML: attributes => attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
      },
    } }]
  },
})

interface Props {
  inputSessions?: InputSettlement
  documentId: string
  notes: string
  notesRich?: string
  onChange: (notes: string, notesRich: string) => void
}

const EXTENSIONS = [
  StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false }),
  TextStyle, Color, BackgroundColor, FontSize,
  TextAlign.configure({ types: ['paragraph'], alignments: ['left', 'center', 'right'] }),
  ParagraphLineHeight,
]
const EDITOR_PROPS = { attributes: { class: 'step-notes-content min-h-36 outline-none', 'aria-label': '步骤说明富文本编辑区' } }

export default function StepNotesEditor({ documentId, notes, notesRich, onChange, inputSessions }: Props) {
  const sourceKey = notesRich ?? `plain:${notes}`
  const lastLocalKey = useRef(sourceKey)
  const activeTarget = useRef({ documentId, onChange })
  const content = useMemo(() => safeNotesHtml({ notes, notesRich }), [notes, notesRich])
  const editor = useEditor({
    extensions: EXTENSIONS,
    content,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: EDITOR_PROPS,
    onUpdate: ({ editor: current }) => {
      const html = current.getHTML()
      lastLocalKey.current = html
      activeTarget.current.onChange(current.getText({ blockSeparator: '\n' }), html)
    },
  })

  useLayoutEffect(() => inputSessions?.register(() => {
    if (!editor || editor.isDestroyed) return
    const html = editor.getHTML()
    if (html === lastLocalKey.current) return
    lastLocalKey.current = html
    activeTarget.current.onChange(editor.getText({ blockSeparator: '\n' }), html)
  }), [inputSessions, editor])

  // 本地输入由 Tiptap 维护光标；只在 AI 或项目加载从外部替换说明时同步。
  useLayoutEffect(() => {
    if (!editor) return
    if (documentId !== activeTarget.current.documentId) {
      // Blur while callbacks still belong to the old step, then replace the
      // document before paint. Reset plugin state to isolate per-step undo.
      editor.view.dom.blur()
      editor.view.updateState(freshNotesState(editor.state, createDocument(content, editor.schema)))
      lastLocalKey.current = sourceKey
      // A no-op transaction notifies toolbar subscriptions after updateState.
      editor.commands.setMeta('addToHistory', false)
    } else if (sourceKey !== lastLocalKey.current) {
      editor.commands.setContent(content, { emitUpdate: false })
      lastLocalKey.current = sourceKey
    }
    activeTarget.current = { documentId, onChange }
  }, [editor, documentId, sourceKey, content, onChange])

  const format = useEditorState({ editor, selector: ({ editor: current }) => current ? ({
    bold: current.isActive('bold'), italic: current.isActive('italic'), underline: current.isActive('underline'),
    strike: current.isActive('strike'), bulletList: current.isActive('bulletList'), orderedList: current.isActive('orderedList'),
    color: current.getAttributes('textStyle').color as string | undefined,
    background: current.getAttributes('textStyle').backgroundColor as string | undefined,
    fontSize: current.getAttributes('textStyle').fontSize as string | undefined,
    lineHeight: current.getAttributes('paragraph').lineHeight as string | null,
    align: current.getAttributes('paragraph').textAlign as string | undefined,
  }) : null })
  const buttonClass = (active = false) => `size-[22px] shrink-0 rounded-sm text-[#c8c8c8] hover:bg-white/10 hover:text-white ${active ? 'bg-[#4b80ad] text-white' : ''}`
  const commands = [
    { label: '加粗', icon: Bold, active: format?.bold, run: () => editor?.chain().focus().toggleBold().run() },
    { label: '斜体', icon: Italic, active: format?.italic, run: () => editor?.chain().focus().toggleItalic().run() },
    { label: '下划线', icon: Underline, active: format?.underline, run: () => editor?.chain().focus().toggleUnderline().run() },
    { label: '删除线', icon: Strikethrough, active: format?.strike, run: () => editor?.chain().focus().toggleStrike().run() },
    { label: '无序列表', icon: List, active: format?.bulletList, run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: '有序列表', icon: ListOrdered, active: format?.orderedList, run: () => editor?.chain().focus().toggleOrderedList().run() },
  ]
  const aligns = [
    { label: '左对齐', value: 'left', icon: AlignLeft },
    { label: '居中', value: 'center', icon: AlignCenter },
    { label: '右对齐', value: 'right', icon: AlignRight },
  ] as const

  return <div className="overflow-hidden rounded-sm border border-white/15 bg-[#303030] focus-within:border-[#6d9fc7]">
    <div className="flex h-9 items-center gap-px overflow-x-auto whitespace-nowrap border-b border-white/10 px-1 [scrollbar-width:thin]" role="toolbar" aria-label="步骤说明格式">
        {commands.slice(0, 3).map(({ label, icon: Icon, active, run }) =>
          <Button key={label} type="button" variant="ghost" size="icon-sm" disabled={!editor} aria-label={label} title={label}
            aria-pressed={active ?? false} className={buttonClass(active)} onClick={run}><Icon className="size-3.5" /></Button>)}
        <Popover>
          <PopoverTrigger asChild><Button type="button" variant="ghost" size="sm" disabled={!editor} aria-label="字号与行距" title="字号与行距"
            className="h-6 w-[98px] shrink-0 justify-between rounded-sm border border-white/15 bg-[#383838] px-1.5 text-[11px] text-[#e5e5e5] hover:bg-[#454545] hover:text-white">
            <span>字号 · 行距</span><ChevronDown className="size-3 text-[#aaa]" />
          </Button></PopoverTrigger>
          <PopoverContent align="start" className="w-56 border-white/15 bg-[#292929] p-3 text-[#eee]">
            <p className="mb-3 text-xs font-medium">文字排版</p>
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-3 text-xs text-[#ccc]">字号
                <select aria-label="字体大小" value={format?.fontSize ?? ''}
                  className="h-8 w-28 rounded-sm border border-white/15 bg-[#383838] px-2 text-xs text-[#e5e5e5]"
                  onChange={e => e.target.value ? editor?.chain().focus().setFontSize(e.target.value).run() : editor?.chain().focus().unsetFontSize().run()}>
                  <option value="">默认字号</option>{FONT_SIZES.map(size => <option key={size} value={`${size}px`}>{size} px</option>)}
                </select>
              </label>
              <label className="flex items-center justify-between gap-3 text-xs text-[#ccc]">行距
                <select aria-label="段落行间距" value={format?.lineHeight ?? ''}
                  className="h-8 w-28 rounded-sm border border-white/15 bg-[#383838] px-2 text-xs text-[#e5e5e5]"
                  onChange={e => editor?.chain().focus().updateAttributes('paragraph', { lineHeight: e.target.value || null }).run()}>
                  <option value="">默认行距</option>{LINE_HEIGHTS.map(line => <option key={line} value={line}>{line} 倍</option>)}
                </select>
              </label>
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon-sm" disabled={!editor} aria-label="字体颜色" title="字体颜色"
            className={buttonClass()}><Type className="size-3.5" style={{ color: format?.color || '#e5e5e5' }} /></Button></PopoverTrigger>
          <PopoverContent align="start" className="w-60 border-white/15 bg-[#292929] p-3 text-[#eee]">
            <p className="mb-2 text-xs">字体颜色</p><div className="flex flex-wrap gap-1.5">
              {TEXT_COLORS.map(color => <button key={color} type="button" aria-label={`字体颜色 ${color}`} title={color}
                className="size-6 rounded-sm border border-white/30 focus-visible:outline focus-visible:outline-[#82b8df]"
                style={{ backgroundColor: color }} onClick={() => editor?.chain().focus().setColor(color).run()} />)}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <label className="flex items-center gap-2">自定义<input type="color" aria-label="自定义字体颜色" defaultValue="#202020" onChange={e => editor?.chain().focus().setColor(e.target.value).run()} /></label>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => editor?.chain().focus().unsetColor().run()}>恢复默认</Button>
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon-sm" disabled={!editor} aria-label="文字底色" title="文字底色"
            className={buttonClass()}><PaintBucket className="size-3.5" style={{ color: format?.background || '#f3d783' }} /></Button></PopoverTrigger>
          <PopoverContent align="start" className="w-60 border-white/15 bg-[#292929] p-3 text-[#eee]">
            <p className="mb-2 text-xs">文字底色</p><div className="flex flex-wrap gap-1.5">
              {BACKGROUND_COLORS.map(color => <button key={color} type="button" aria-label={`文字底色 ${color}`} title={color}
                className="size-6 rounded-sm border border-white/30 focus-visible:outline focus-visible:outline-[#82b8df]"
                style={{ backgroundColor: color }} onClick={() => editor?.chain().focus().setBackgroundColor(color).run()} />)}
            </div>
            <div className="mt-3 flex items-center justify-between text-xs">
              <label className="flex items-center gap-2">自定义<input type="color" aria-label="自定义文字底色" defaultValue="#FFF2A8" onChange={e => editor?.chain().focus().setBackgroundColor(e.target.value).run()} /></label>
              <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => editor?.chain().focus().unsetBackgroundColor().run()}>清除底色</Button>
            </div>
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild><Button type="button" variant="ghost" size="icon-sm" disabled={!editor} aria-label="更多格式" title="更多格式"
            className={buttonClass()}><MoreHorizontal className="size-4" /></Button></PopoverTrigger>
          <PopoverContent align="end" className="w-48 border-white/15 bg-[#292929] p-2 text-[#eee]">
            <p className="px-1 pb-1 text-[11px] text-[#aaa]">段落与其他格式</p>
            <div className="flex items-center gap-1">
              {commands.slice(3).map(({ label, icon: Icon, active, run }) =>
                <Button key={label} type="button" variant="ghost" size="icon-sm" aria-label={label} title={label}
                  aria-pressed={active ?? false} className={buttonClass(active)} onClick={run}><Icon className="size-3.5" /></Button>)}
            </div>
            <div className="my-2 h-px bg-white/10" />
            <div className="flex items-center gap-1">
              {aligns.map(({ label, value, icon: Icon }) =>
                <Button key={value} type="button" variant="ghost" size="icon-sm" aria-label={label} title={label}
                  aria-pressed={(format?.align ?? 'left') === value} className={buttonClass((format?.align ?? 'left') === value)}
                  onClick={() => editor?.chain().focus().setTextAlign(value).run()}><Icon className="size-3.5" /></Button>)}
            </div>
            <div className="my-2 h-px bg-white/10" />
            <Button type="button" variant="ghost" size="sm" className="h-7 w-full justify-start gap-2 px-1 text-xs text-[#ddd] hover:bg-white/10 hover:text-white"
              onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().updateAttributes('paragraph', { lineHeight: null, textAlign: null }).run()}>
              <Eraser className="size-3.5" />清除格式
            </Button>
          </PopoverContent>
        </Popover>
    </div>
    <EditorContent editor={editor} className="max-h-[45vh] overflow-y-auto bg-[#f7f7f5] px-3 py-2 text-[16px] leading-[1.7] text-[#202020]" />
  </div>
}
