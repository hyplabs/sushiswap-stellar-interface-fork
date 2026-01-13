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
 * Prepare series data for rendering with curveStepAfter.
 *
 * With curveStepAfter, a point at x_0 determines the y-value for the range [x_0, x_1).
 * This means:
 * 1. If x_0 is off-screen but x_1 is visible, we need to keep x_0 so the visible portion
 *    of [x_0, x_1) renders correctly.
 * 2. The LAST point in the series needs a synthetic "end" point so its value extends
 *    to the right edge of the chart.
 *
 * We:
 * - Keep one point to the left of the visible area (for proper left edge rendering)
 * - Keep all points within the visible area
 * - Keep one point to the right of the visible area (for proper right edge rendering)
 * - Add a synthetic end point if the last visible point's liquidity should extend further
 */
function prepareSeriesForRendering(
  series: ChartEntry[],
  xScale: ScaleLinear<number, number>,
  xValue: (d: ChartEntry) => number,
  yValue: (d: ChartEntry) => number,
): ChartEntry[] {
  if (series.length === 0) return []

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

  const filtered = series.slice(startIdx, endIdx)

  // If the last point in our filtered series is within or before the visible area,
  // we need to add a synthetic end point so its step extends to the right edge.
  // This is because curveStepAfter draws from point[i] to point[i+1], so the last
  // point needs somewhere to "step to".
  if (filtered.length > 0) {
    const lastPoint = filtered[filtered.length - 1]
    const lastX = xValue(lastPoint)
    const lastY = yValue(lastPoint)

    // If the last point is within the visible area and has non-zero liquidity,
    // add a synthetic point at the right edge (or beyond) with the same y-value
    if (lastX <= maxX && lastY > 0) {
      // Check if there's already a point beyond maxX
      const hasPointBeyond = rightBoundaryIdx < series.length

      if (!hasPointBeyond) {
        // Add a synthetic end point to extend the step
        filtered.push({
          price0: maxX * 1.1, // Slightly beyond the right edge
          activeLiquidity: lastY,
        })
      }
    }
  }

  return filtered
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
    const preparedSeries = prepareSeriesForRendering(
      series,
      xScale,
      xValue,
      yValue,
    )

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
            preparedSeries as Iterable<[number, number]>,
          ) ?? undefined
        }
      />
    )
  }, [fill, opacity, series, xScale, xValue, yScale, yValue])
