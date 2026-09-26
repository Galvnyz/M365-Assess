// T-0188 — fleet trend chart downsampling and rendering.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { downsampleTrendPoints, FleetTrendChart, type TrendChartPoint } from "./FleetTrendChart.js";

function points(count: number): TrendChartPoint[] {
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  return Array.from({ length: count }, (_, index) => ({
    at: new Date(start + index * 3600 * 1000).toISOString(),
    compliance: index / Math.max(1, count - 1),
  }));
}

describe("downsampleTrendPoints (T-0188)", () => {
  it("keeps small series intact", () => {
    expect(downsampleTrendPoints(points(5), 60)).toHaveLength(5);
  });

  it("downsamples large series while preserving first and last", () => {
    const series = points(200);
    const sampled = downsampleTrendPoints(series, 60);
    expect(sampled.length).toBeLessThanOrEqual(61);
    expect(sampled[0]).toBe(series[0]);
    expect(sampled[sampled.length - 1]).toBe(series[series.length - 1]);
    // Even spacing: strictly increasing timestamps.
    for (let index = 1; index < sampled.length; index += 1) {
      expect(sampled[index]!.at > sampled[index - 1]!.at).toBe(true);
    }
  });
});

describe("FleetTrendChart (T-0188)", () => {
  it("renders the downsampled path from API points", () => {
    const series = points(200);
    render(<FleetTrendChart points={series} maxPoints={20} />);
    const svg = screen.getByTestId("trend-svg");
    expect(Number(svg.dataset.points)).toBeLessThanOrEqual(21);
    expect(screen.getByTestId("trend-path")).toBeTruthy();
    expect(screen.getByTestId("trend-range").textContent).toContain("showing");
  });

  it("renders the empty state without points", () => {
    render(<FleetTrendChart points={[]} />);
    expect(screen.getByTestId("trend-empty")).toBeTruthy();
  });
});
