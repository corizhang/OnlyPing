import { EditorState } from '@tiptap/pm/state'
import type { Node } from '@tiptap/pm/model'

/** Reuse schema/plugins/view, but never carry history, selection or stored marks
 * across step documents. Reinitializing plugin state matches a fresh editor.
 */
export function freshNotesState(previous: EditorState, doc: Node): EditorState {
  return EditorState.create({ schema: previous.schema, plugins: previous.plugins, doc })
}
