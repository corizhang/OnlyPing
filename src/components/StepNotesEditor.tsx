import { useEffect } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Bold, Italic, List, ListOrdered, Strikethrough } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { safeNotesHtml } from '@/lib/notes'

interface Props {
  notes: string
  notesRich?: string
  onChange: (notes: string, notesRich: string) => void
}

export default function StepNotesEditor({ notes, notesRich, onChange }: Props) {
  const content = safeNotesHtml({ notes, notesRich })
  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false, blockquote: false, code: false, codeBlock: false, horizontalRule: false })],
    content,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: 'step-notes-content min-h-36 outline-none',
        'aria-label': '步骤说明富文本编辑区',
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getText({ blockSeparator: '\n' }), current.getHTML()),
  })

  // AI 生成说明或切换项目后，更新编辑器；普通输入不会重置光标。
  useEffect(() => {
    if (editor && editor.getHTML() !== content) editor.commands.setContent(content, { emitUpdate: false })
  }, [editor, content])

  const actions = [
    { label: '加粗', icon: Bold, active: 'bold', run: () => editor?.chain().focus().toggleBold().run() },
    { label: '斜体', icon: Italic, active: 'italic', run: () => editor?.chain().focus().toggleItalic().run() },
    { label: '删除线', icon: Strikethrough, active: 'strike', run: () => editor?.chain().focus().toggleStrike().run() },
    { label: '无序列表', icon: List, active: 'bulletList', run: () => editor?.chain().focus().toggleBulletList().run() },
    { label: '有序列表', icon: ListOrdered, active: 'orderedList', run: () => editor?.chain().focus().toggleOrderedList().run() },
  ]

  return (
    <div className="overflow-hidden rounded-sm border border-white/15 bg-[#303030] focus-within:border-[#6d9fc7]">
      <div className="flex items-center gap-0.5 border-b border-white/10 p-1" role="toolbar" aria-label="步骤说明格式">
        {actions.map(({ label, icon: Icon, active, run }) => (
          <Button key={label} type="button" variant="ghost" size="icon-sm" disabled={!editor}
            aria-label={label} title={label} aria-pressed={editor?.isActive(active) ?? false}
            className={`size-7 rounded-sm text-[#c8c8c8] hover:bg-white/10 hover:text-white ${editor?.isActive(active) ? 'bg-[#4b80ad] text-white' : ''}`}
            onClick={run}><Icon className="size-4" /></Button>
        ))}
      </div>
      <EditorContent editor={editor} className="max-h-[45vh] overflow-y-auto px-3 py-2 text-sm leading-relaxed text-[#e5e5e5]" />
    </div>
  )
}
