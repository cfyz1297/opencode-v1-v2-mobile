// A plain (non-inverted) transcript: frame y and the scroll offset grow from
// the oldest row at the top to the newest at the bottom, and `ids` uses that
// same order. The navigator keeps targets by ID because streaming can change
// list indices.
export class MessageNavigation {
  ids: string[] = []
  frames = new Map<string, { y: number; height: number }>()
  offset = 0
  height = 0
  expected: number | undefined
  target: string | undefined
  anchor: { id: string; offset: number; height: number } | undefined
  // While held, the navigator owns the position and the list's viewability
  // reports are ignored. A jump centres its target, so the topmost visible row
  // is one or two rows above it — adopting that made one tap skip several
  // messages (6/12 → 3/12) because each tap re-based on the row above.
  held = false

  // The row the scroll report says is on screen. Frames are only reported for
  // rows inside the render window, so after a fling the frame math can point at
  // the oldest message while the viewport shows a newer one — the counter then
  // read the wrong position and a tap seeked from the wrong base.
  visibleId: string | undefined

  sync(ids: string[]) {
    this.ids = ids
    if (this.target && !ids.includes(this.target)) this.target = undefined
    if (this.anchor && !ids.includes(this.anchor.id)) this.anchor = undefined
    if (this.visibleId && !ids.includes(this.visibleId)) this.visibleId = undefined
    for (const id of this.frames.keys()) {
      if (!ids.includes(id)) this.frames.delete(id)
    }
  }

  current() {
    if (this.target) return this.ids.indexOf(this.target)
    if (this.anchor) return this.ids.indexOf(this.anchor.id)
    if (this.visibleId) return this.ids.indexOf(this.visibleId)
    return this.visible()
  }

  // Called from handleScroll with the row the reader should be counted at.
  // Ignored while a jump holds the position.
  setCurrent(id: string | undefined) {
    if (this.held) return
    this.visibleId = id && this.ids.includes(id) ? id : undefined
  }

  // A navigator jump: the target becomes the position AND the navigator takes
  // ownership. It has to bypass setCurrent's gate — holding before setting the
  // position left the old row current, so the counter never moved at all
  // (6/12 -> 6/12) while the transcript scrolled.
  jumpTo(id: string) {
    this.held = true
    if (this.ids.includes(id)) this.visibleId = id
  }

  // A finger on the list or Latest gives the position back to the viewport.
  hold() {
    this.held = true
  }

  release() {
    this.held = false
  }

  visible() {
    const top = this.offset
    // The row under the top edge of the viewport.
    const visible = this.ids.findIndex((id) => {
      const frame = this.frames.get(id)
      return frame && frame.height > 0 && frame.y <= top + 1 && frame.y + frame.height > top + 1
    })
    if (visible >= 0) return visible
    const measured = this.ids.map((id, index) => ({ index, frame: this.frames.get(id) }))
      .filter((item) => item.frame && item.frame.height > 0)
    // The closest measured row above the edge: reading an answer means reading
    // the question it belongs to, and a question sits above its answer.
    const above = measured.filter((item) => item.frame!.y <= top).sort((a, b) => b.frame!.y - a.frame!.y)[0]
    if (above) return above.index
    // Nothing measured above the edge (the reader is past every laid-out row):
    // the first row below is the next one they are about to read.
    const below = measured.filter((item) => item.frame!.y > top).sort((a, b) => a.frame!.y - b.frame!.y)[0]
    if (below) return below.index
    // Nothing measured at all: no position, which keeps the buttons honest
    // instead of inventing one.
    return -1
  }

  move(direction: 1 | -1) {
    const current = this.current()
    if (current < 0) return undefined
    const index = current + direction
    if (index < 0 || index >= this.ids.length) return undefined
    this.target = this.ids[index]
    return index
  }

  // A focused row lands at the top of the viewport: a jump is meant to read that
  // message, and a row aligned to the bottom edge would put its first lines
  // above the fold.
  destination() {
    if (!this.target) return undefined
    const frame = this.frames.get(this.target)
    if (!frame || frame.height <= 0 || this.height <= 0) return undefined
    return Math.max(0, frame.y)
  }

  manual(offset?: number) {
    this.target = undefined
    this.anchor = undefined
    this.visibleId = undefined
    this.held = false
    this.expected = offset
    if (offset !== undefined) this.offset = offset
  }

  observe(offset: number, height: number) {
    if (this.height !== height) this.expected = undefined
    // Earlier programmatic scroll callbacks can arrive after a newer tap.
    // Keep its boundary until native scrolling acknowledges the latest command.
    if (this.expected !== undefined && Math.abs(this.expected - offset) > 1) return
    this.expected = undefined
    this.offset = offset
    this.height = height
    if (this.anchor && (Math.abs(this.anchor.offset - offset) > 1 || this.anchor.height !== height)) {
      this.anchor = undefined
    }
  }

  complete(offset: number) {
    if (this.target) this.anchor = { id: this.target, offset, height: this.height }
    this.expected = offset
    this.offset = offset
    this.target = undefined
  }

  seek(list: {
    scrollToOffset(params: { offset: number; animated: boolean }): void
    scrollToIndex(params: { index: number; viewPosition: number; animated: boolean }): void
  }, attempt: number) {
    if (!this.target) return false
    const index = this.ids.indexOf(this.target)
    if (index < 0) return false
    const offset = this.destination()
    if (offset !== undefined) {
      list.scrollToOffset({ offset, animated: false })
      this.complete(offset)
      return false
    }
    if (attempt >= 20) {
      this.manual()
      return false
    }
    // Without a viewport height a relative step is zero pixels — the tap then
    // moved the counter and nothing else. Keep asking the list to jump to the
    // index; each jump mounts rows that report their real frames.
    if (attempt === 0 || this.height <= 0) {
      list.scrollToIndex({ index, viewPosition: 0, animated: false })
      return true
    }
    // RN may accept estimated metrics without mounting the target. Advance
    // the render window until a real target frame arrives, even without failure.
    const visible = this.visible()
    const direction = visible < 0 || index > visible ? 1 : -1
    list.scrollToOffset({ offset: Math.max(0, this.offset + direction * this.height * 0.8), animated: false })
    return true
  }
}
