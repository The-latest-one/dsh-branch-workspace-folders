import React, { Component, createRef } from 'react'
import css from './AnimatedRows.module.css'

const ROW_FADE_MS = 100
const ROW_GLIDE_MS = 200

export interface AnimatedRowsProps {
  className?: string
  label?: string
  rowKeys: readonly string[]
  ready: boolean
  resetKey: string | number
  children?: React.ReactNode
}

interface RowPosition {
  element: HTMLElement
  rect: DOMRect
  opacity: number
}

function sameRows(previous: AnimatedRowsProps, next: AnimatedRowsProps) {
  return (
    previous.rowKeys.length === next.rowKeys.length &&
    previous.rowKeys.every((key, index) => key === next.rowKeys[index])
  )
}

function intersects(row: DOMRect, viewport: DOMRect) {
  return (
    row.bottom > viewport.top &&
    row.top < viewport.bottom &&
    row.right > viewport.left &&
    row.left < viewport.right
  )
}

export class AnimatedRows extends Component<AnimatedRowsProps> {
  private armed = false
  private list = createRef<HTMLDivElement>()
  private overlay = createRef<HTMLDivElement>()
  private movements = new Map<HTMLElement, Animation>()
  private exits = new Map<string, { element: HTMLElement; animation: Animation }>()

  getSnapshotBeforeUpdate(previous: AnimatedRowsProps) {
    const list = this.list.current
    if (
      !this.armed ||
      sameRows(previous, this.props) ||
      previous.resetKey !== this.props.resetKey ||
      !previous.ready ||
      !this.props.ready ||
      list === null ||
      typeof list.animate !== 'function' ||
      (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)
    ) {
      return null
    }
    const viewport = list.getBoundingClientRect()
    const positions = this.readPositions()
    const nextKeys = new Set(this.props.rowKeys)
    const removed = new Map<string, RowPosition>()

    for (const [key, row] of positions) {
      if (nextKeys.has(key) || !intersects(row.rect, viewport)) continue
      const clone = row.element.cloneNode(true) as HTMLElement
      clone.removeAttribute('data-row-key')
      clone.setAttribute('inert', '')
      clone.style.setProperty(
        '--dsh-workspace-indent',
        getComputedStyle(row.element).getPropertyValue('--dsh-workspace-indent'),
      )
      clone.style.setProperty(
        '--dsh-branch-indent',
        getComputedStyle(row.element).getPropertyValue('--dsh-branch-indent'),
      )
      removed.set(key, { ...row, element: clone })
    }
    return { positions, removed }
  }

  componentDidUpdate(previous: AnimatedRowsProps, _state: any, snapshot: any) {
    if (snapshot === null) {
      if (
        !sameRows(previous, this.props) ||
        previous.resetKey !== this.props.resetKey ||
        previous.ready !== this.props.ready
      ) {
        this.clear()
      }
      return
    }

    this.cancelMovements()
    const list = this.list.current
    const overlay = this.overlay.current
    if (!list || !overlay) return
    const viewport = list.getBoundingClientRect()
    const origin = overlay.getBoundingClientRect()

    for (const [key, row] of this.readPositions()) {
      this.removeExit(key)
      const previousRow = snapshot.positions.get(key)
      if (
        !intersects(row.rect, viewport) &&
        (previousRow === undefined || !intersects(previousRow.rect, viewport))
      ) {
        continue
      }
      if (previousRow === undefined) {
        this.move(row.element, [{ opacity: 0 }, { opacity: 1 }], ROW_FADE_MS)
        continue
      }
      const dx = previousRow.rect.left - row.rect.left
      const dy = previousRow.rect.top - row.rect.top
      if (dx === 0 && dy === 0 && previousRow.opacity === 1) continue
      this.move(
        row.element,
        [
          {
            transform: `translate(${dx}px, ${dy}px)`,
            opacity: previousRow.opacity,
          },
          {
            transform: 'translate(0, 0)',
            opacity: 1,
          },
        ],
        ROW_GLIDE_MS,
      )
    }

    for (const [key, row] of snapshot.removed) {
      const { element } = row
      this.removeExit(key)
      Object.assign(element.style, {
        position: 'absolute',
        margin: '0',
        transform: 'none',
        boxSizing: 'border-box',
        left: `${row.rect.left - origin.left}px`,
        top: `${row.rect.top - origin.top}px`,
        width: `${row.rect.width}px`,
        height: `${row.rect.height}px`,
      })
      overlay.append(element)
      const animation = element.animate([{ opacity: row.opacity }, { opacity: 0 }], {
        duration: ROW_FADE_MS,
        easing: 'ease-out',
        fill: 'forwards',
      })
      this.exits.set(key, { element, animation })
      animation.onfinish = () => {
        this.removeExit(key)
      }
    }
  }

  componentWillUnmount() {
    this.clear()
  }

  private readPositions(): Map<string, RowPosition> {
    if (!this.list.current) return new Map()
    const rows = this.list.current.querySelectorAll<HTMLElement>('[data-row-key]')
    return new Map(
      Array.from(rows, (element) => [
        element.dataset.rowKey!,
        {
          element,
          rect: element.getBoundingClientRect(),
          opacity: this.movements.has(element)
            ? Number(getComputedStyle(element).opacity)
            : 1,
        },
      ]),
    )
  }

  private move(element: HTMLElement, keyframes: Keyframe[], duration: number) {
    const animation = element.animate(keyframes, {
      duration,
      easing: 'ease-out',
    })
    this.movements.set(element, animation)
    animation.onfinish = () => {
      this.movements.delete(element)
      animation.cancel()
    }
  }

  private cancelMovements() {
    for (const animation of this.movements.values()) {
      animation.onfinish = null
      animation.cancel()
    }
    this.movements.clear()
  }

  private removeExit(key: string) {
    const exit = this.exits.get(key)
    if (exit === undefined) return
    exit.animation.onfinish = null
    exit.animation.cancel()
    exit.element.remove()
    this.exits.delete(key)
  }

  private clear() {
    this.cancelMovements()
    for (const key of this.exits.keys()) this.removeExit(key)
  }

  render() {
    return (
      <>
        <div
          ref={this.list}
          className={this.props.className}
          role="tree"
          aria-label={this.props.label}
          onPointerDownCapture={() => {
            this.armed = true
          }}
          onKeyDownCapture={() => {
            this.armed = true
          }}
        >
          {this.props.children}
        </div>
        <div ref={this.overlay} className={css.exits} aria-hidden="true" />
      </>
    )
  }
}
