"use client";

// Fleet compliance trend chart (EPIC-010 SPEC.md §3.1, §4.5; T-0188).
// Hand-rolled SVG chart of per-run compliance points with display
// downsampling (§11.5): evenly spaced sampling that always preserves the
// first and last points. Points arrive via props from the trend API.
// Zero colour literals: report theme tokens only (`--accent-grad` stroke).

import React, { useMemo, type CSSProperties, type ReactElement } from "react";

export interface TrendChartPoint {
  readonly at: string;
  /** Compliance share 0-1. */
  readonly compliance: number;
}

export interface FleetTrendChartProps {
  readonly points?: readonly TrendChartPoint[];
  /** Maximum points rendered; the rest are downsampled away. */
  readonly maxPoints?: number;
  readonly loading?: boolean;
  readonly error?: string | null;
}

export const TREND_CHART_MAX_POINTS = 60;

/** Evenly spaced downsample preserving the first and last points. */
export function downsampleTrendPoints(
  points: readonly TrendChartPoint[],
  maxPoints: number = TREND_CHART_MAX_POINTS,
): TrendChartPoint[] {
  if (points.length <= maxPoints || maxPoints < 2) {
    return maxPoints < 2 ? points.slice(0, Math.max(0, maxPoints)) : [...points];
  }
  const sampled: TrendChartPoint[] = [];
  const last = points.length - 1;
  for (let index = 0; index < maxPoints; index += 1) {
    const position = Math.round((index * last) / (maxPoints - 1));
    const point = points[position];
    if (point && !sampled.includes(point)) {
      sampled.push(point);
    }
  }
  const firstPoint = points[0]!;
  const lastPoint = points[last]!;
  if (sampled[0] !== firstPoint) sampled.unshift(firstPoint);
  if (sampled[sampled.length - 1] !== lastPoint) sampled.push(lastPoint);
  return sampled;
}

const containerStyle: CSSProperties = {
  width: "100%",
  fontFamily: "var(--font-sans, system-ui, sans-serif)",
  color: "var(--text)",
};

const metaStyle: CSSProperties = {
  fontSize: "13px",
  color: "var(--text-soft)",
  margin: 0,
};

const CHART_WIDTH = 600;
const CHART_HEIGHT = 180;
const PAD_LEFT = 40;
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 24;

export function FleetTrendChart({
  points = [],
  maxPoints = TREND_CHART_MAX_POINTS,
  loading = false,
  error = null,
}: FleetTrendChartProps): ReactElement {
  const sampled = useMemo(() => downsampleTrendPoints(points, maxPoints), [points, maxPoints]);

  if (loading) {
    return <div data-testid="trend-loading">Loading trend…</div>;
  }
  if (error) {
    return (
      <div
        data-testid="trend-error"
        style={{
          padding: "10px 14px",
          background: "var(--danger-soft)",
          border: "1px solid var(--danger)",
          borderRadius: "6px",
          color: "var(--danger-text)",
          fontSize: "13px",
        }}
      >
        {error}
      </div>
    );
  }
  if (sampled.length === 0) {
    return (
      <p style={metaStyle} data-testid="trend-empty">
        No trend points yet — they accumulate with each baseline evaluation.
      </p>
    );
  }

  const innerWidth = CHART_WIDTH - PAD_LEFT - PAD_RIGHT;
  const innerHeight = CHART_HEIGHT - PAD_TOP - PAD_BOTTOM;
  const coordinates = sampled.map((point, index) => {
    const x = sampled.length === 1 ? PAD_LEFT : PAD_LEFT + (index * innerWidth) / (sampled.length - 1);
    const y = PAD_TOP + (1 - Math.min(1, Math.max(0, point.compliance))) * innerHeight;
    return { x, y, point };
  });
  const path = coordinates.map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" ");

  return (
    <div style={containerStyle} data-testid="fleet-trend-chart">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`Fleet compliance trend, ${sampled.length} of ${points.length} points shown`}
        data-testid="trend-svg"
        data-points={sampled.length}
      >
        <defs>
          <linearGradient id="trend-accent-grad" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--accent)" />
            <stop offset="100%" stopColor="var(--accent-text)" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((fraction) => {
          const y = PAD_TOP + (1 - fraction) * innerHeight;
          return (
            <g key={fraction}>
              <line x1={PAD_LEFT} y1={y} x2={CHART_WIDTH - PAD_RIGHT} y2={y} stroke="var(--border)" strokeWidth={1} />
              <text x={PAD_LEFT - 6} y={y + 4} textAnchor="end" fontSize={10} fill="var(--text-soft)">
                {`${Math.round(fraction * 100)}%`}
              </text>
            </g>
          );
        })}
        <path d={path} fill="none" stroke="url(#trend-accent-grad)" strokeWidth={2} data-testid="trend-path" />
        {coordinates.map((coord, index) => (
          <circle
            key={`${coord.point.at}-${index}`}
            cx={coord.x}
            cy={coord.y}
            r={3}
            fill="var(--accent)"
            data-testid={`trend-point-${index}`}
          >
            <title>{`${coord.point.at}: ${Math.round(coord.point.compliance * 100)}%`}</title>
          </circle>
        ))}
      </svg>
      <p style={metaStyle} data-testid="trend-range">
        {sampled[0]!.at} → {sampled[sampled.length - 1]!.at} · showing {sampled.length} of {points.length} points
      </p>
    </div>
  );
}
