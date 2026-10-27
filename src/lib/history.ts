/** 一次手势或一次输入会话对应一条历史；新编辑始终清空重做分支。 */
export class EditHistory<T> {
  private past: T[] = []
  private future: T[] = []
  private group: string | null = null
  private limit: number
  constructor(limit = 50) { this.limit = limit }
  get canUndo() { return this.past.length > 0 }
  get canRedo() { return this.future.length > 0 }
  record(current: T, group: string | null = null) {
    if (!group || this.group !== group) {
      this.past.push(current)
      if (this.past.length > this.limit) this.past.shift()
    }
    this.group = group
    this.future = []
  }
  end() { this.group = null }
  clear() { this.past = []; this.future = []; this.end() }
  undo(current: T) {
    this.end()
    const previous = this.past.pop()
    if (previous === undefined) return undefined
    this.future.push(current)
    return previous
  }
  redo(current: T) {
    this.end()
    const next = this.future.pop()
    if (next === undefined) return undefined
    this.past.push(current)
    return next
  }
}
