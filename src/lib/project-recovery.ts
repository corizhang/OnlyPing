/** A failed primary read must still allow the independent recovery copy. */
export async function readRecoverableProject<T>(read: (key: string) => Promise<unknown>, validate: (value: unknown) => T | null): Promise<T | null> {
  let failure: unknown
  let hasData = false
  for (const key of ['autosave', 'backup']) {
    try {
      const data = await read(key)
      hasData ||= data != null
      const restored = validate(data)
      if (restored) return restored
    } catch (error) { failure ??= error }
  }
  if (failure) throw failure
  if (hasData) throw new Error('自动存档及恢复副本均无法读取，已暂停自动保存，请打开项目备份。')
  return null
}
