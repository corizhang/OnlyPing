import test from 'node:test'
import assert from 'node:assert/strict'
import { Schema } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { history, undo, undoDepth, redoDepth } from '@tiptap/pm/history'
import { freshNotesState } from '../src/lib/notes-editor-state.ts'

test('switching note documents clears undo, redo, selection and typing marks while reusing schema/plugins', () => {
  const schema = new Schema({ nodes: { doc: { content: 'paragraph+' }, paragraph: { content: 'text*' }, text: {} }, marks: { bold: {} } })
  const doc = text => schema.node('doc', null, [schema.node('paragraph', null, text ? schema.text(text) : undefined)])
  let state = EditorState.create({ schema, doc: doc('first'), plugins: [history()] })
  state = state.apply(state.tr.insertText(' modified', 6))
  assert.equal(undoDepth(state), 1)
  undo(state, tr => { state = state.apply(tr) })
  assert.equal(redoDepth(state), 1)
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, 3)).setStoredMarks([schema.marks.bold.create()]))
  const next = freshNotesState(state, doc('second'))
  assert.equal(next.doc.textContent, 'second')
  assert.equal(next.schema, schema)
  assert.equal(next.plugins[0], state.plugins[0])
  assert.equal(next.selection.from, 1)
  assert.equal(next.storedMarks, null)
  assert.equal(undoDepth(next), 0)
  assert.equal(redoDepth(next), 0)
  assert.equal(undo(next), false, 'undo on step B cannot restore step A')
  let edited = next.apply(next.tr.insertText('!', 7))
  assert.equal(undoDepth(edited), 1)
  undo(edited, tr => { edited = edited.apply(tr) })
  assert.equal(edited.doc.textContent, 'second', 'normal undo continues to work within the new step')
})
