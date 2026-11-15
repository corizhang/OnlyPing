/** Weak owner memoization follows immutable pages without retaining old projects.
 * A small content LRU also shares keys between different owners of one image.
 */
export class ImageAssetCache {
  private owners = new WeakMap<object, { image: string; key: string }>()
  private content = new Map<string, string>()
  private bytes = 0
  async key(image: string, owner: object) {
    const memo = this.owners.get(owner)
    if (memo?.image === image) return memo.key
    let key = this.content.get(image)
    if (key) { this.content.delete(image); this.content.set(image, key) }
    else {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(image))
      key = `asset:${Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')}`
      // Conservative UTF-16 budget. Large strings remain weak-owner-only.
      if (image.length * 2 <= 4_000_000) {
        this.content.set(image, key); this.bytes += image.length * 2
        while (this.bytes > 4_000_000 || this.content.size > 32) {
          const oldest = this.content.keys().next().value!
          this.content.delete(oldest); this.bytes -= oldest.length * 2
        }
      }
    }
    this.owners.set(owner, { image, key })
    return key
  }
}
