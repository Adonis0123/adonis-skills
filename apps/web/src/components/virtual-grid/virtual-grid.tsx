'use client'

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useIsomorphicLayoutEffect } from 'ahooks'
import { useResponsiveColumns } from './use-responsive-columns'
import { VirtualGridItem } from './virtual-grid-item'

interface VirtualGridProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => ReactNode
  getItemKey: (item: T) => string | number
  estimateRowHeight?: number
  overscan?: number // cspell:disable-line
  className?: string
}

const colsClass: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
}

function chunk<T>(arr: T[], size: number): T[][] {
  const rows: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    rows.push(arr.slice(i, i + size))
  }
  return rows
}

export function VirtualGrid<T>({
  items,
  renderItem,
  getItemKey,
  estimateRowHeight = 320,
  overscan = 2, // cspell:disable-line
  className,
}: VirtualGridProps<T>) {
  const [scrollMargin, setScrollMargin] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  // Stable mutable Set — written in onAnimationComplete (event), read during render.
  // useState initializer guarantees the Set persists across the component lifetime,
  // unlike useMemo which React may discard as a performance optimization.
  const [animatedKeys] = useState(() => new Set<string | number>())
  const markAnimated = useCallback((key: string | number) => {
    animatedKeys.add(key)
  }, [animatedKeys])
  const columns = useResponsiveColumns()
  const rows = chunk(items, columns)

  useIsomorphicLayoutEffect(() => {
    if (listRef.current) {
      setScrollMargin(listRef.current.offsetTop)
    }
  }, [])

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => estimateRowHeight,
    overscan, // cspell:disable-line
    scrollMargin,
    gap: 20,
  })

  return (
    <div ref={listRef} className={className}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              <div className={`grid gap-5 ${colsClass[columns] ?? 'grid-cols-1'}`}>
                {row.map((item, colIndex) => {
                  const globalIndex = virtualRow.index * columns + colIndex
                  const itemKey = getItemKey(item)
                  return (
                    <VirtualGridItem
                      key={itemKey}
                      itemKey={itemKey}
                      index={colIndex}
                      columns={columns}
                      alreadyAnimated={animatedKeys.has(itemKey)}
                      onAnimated={markAnimated}
                    >
                      {renderItem(item, globalIndex)}
                    </VirtualGridItem>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
