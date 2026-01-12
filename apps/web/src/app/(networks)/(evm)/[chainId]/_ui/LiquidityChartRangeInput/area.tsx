import { type ScaleLinear, area, curveStepAfter } from 'd3'
import React, { type FC, useMemo } from 'react'

import type { ChartEntry } from './types'

interface AreaProps {
  series: ChartEntry[]
  xScale: ScaleLinear<number, number>
  yScale: ScaleLinear<number, number>
  xValue: (d: ChartEntry) => number
  yValue: (d: ChartEntry) => number
  fill?: string | undefined
  opacity?: number | undefined
}

/**
 * Filter series data for rendering, keeping points needed for proper step-after rendering.
 *
 * With curveStepAfter, a point at x_0 determines the y-value for the range [x_0, x_1).
 * If x_0 is off-screen but x_1 is visible, we need to keep x_0 so the visible portion
 * of [x_0, x_1) renders correctly.
 *
 * We keep:
 * - One point to the left of the visible area (for proper left edge rendering)
 * - All points within the visible area
 * - One point to the right of the visible area (for proper right edge rendering)
 */
function filterSeriesForRendering(
  series: ChartEntry[],
  xScale: ScaleLinear<number, number>,
  xValue: (d: ChartEntry) => number,
): ChartEntry[] {
  const domain = xScale.domain()
  const [minX, maxX] = domain

  // Find the indices of points just outside the visible range
  let leftBoundaryIdx = -1
  let rightBoundaryIdx = series.length

  for (let i = 0; i < series.length; i++) {
    const x = xValue(series[i])
    if (x < minX) {
      leftBoundaryIdx = i // Keep updating until we find the last point before minX
    } else if (x > maxX && rightBoundaryIdx === series.length) {
      rightBoundaryIdx = i // First point after maxX
      break
    }
  }

  // Include one point before minX (if exists) and one point after maxX (if exists)
  const startIdx = Math.max(0, leftBoundaryIdx)
  const endIdx = Math.min(series.length, rightBoundaryIdx + 1)

  return series.slice(startIdx, endIdx)
}

export const Area: FC<AreaProps> = ({
  series,
  xScale,
  yScale,
  xValue,
  yValue,
  fill,
  opacity,
}) =>
  useMemo(() => {
    const filteredSeries = filterSeriesForRendering(series, xScale, xValue)

    return (
      <path
        opacity={opacity ?? 0.5}
        stroke={fill}
        fill={fill}
        d={
          area()
            .curve(curveStepAfter)
            .x((d: unknown) => xScale(xValue(d as ChartEntry)))
            .y1((d: unknown) => yScale(yValue(d as ChartEntry)))
            .y0(yScale(0))(
            filteredSeries as Iterable<[number, number]>,
          ) ?? undefined
        }
      />
    )
  }, [fill, opacity, series, xScale, xValue, yScale, yValue])
