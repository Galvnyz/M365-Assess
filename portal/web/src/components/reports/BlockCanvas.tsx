import BlockControls from "./BlockControls";

// Block shapes mirror the T-0081 contract in portal/contracts/src/reports.ts so
// the builder and the renderer reject the same unknown types at the boundary.
export const V1_BLOCK_TYPES = [
  "chart",
  "score-cards",
  "progress-bars",
  "section-divider",
  "page-break",
  "rich-text",
] as const;

export type V1BlockType = (typeof V1_BLOCK_TYPES)[number];

export interface ReportBlock {
  readonly id: string;
  readonly type: V1BlockType;
  readonly title: string;
  readonly isStatic: boolean;
  readonly dataBinding?: { readonly entity: string; readonly field?: string };
  readonly settings: Record<string, unknown>;
}

export function isV1BlockType(value: unknown): value is V1BlockType {
  return (
    typeof value === "string" &&
    (V1_BLOCK_TYPES as readonly string[]).includes(value)
  );
}

let blockSequence = 0;

export function createBlock(type: V1BlockType, title?: string): ReportBlock {
  blockSequence += 1;
  const id = `block-${Date.now().toString(36)}-${blockSequence}`;
  const label = title ?? `New ${type}`;
  switch (type) {
    case "chart":
      return {
        id,
        type,
        title: label,
        isStatic: false,
        dataBinding: { entity: "findings" },
        settings: { chartKind: "bar", series: [] },
      };
    case "score-cards":
      return {
        id,
        type,
        title: label,
        isStatic: false,
        dataBinding: { entity: "secure-score" },
        settings: { metrics: [], columns: 3 },
      };
    case "progress-bars":
      return {
        id,
        type,
        title: label,
        isStatic: false,
        dataBinding: { entity: "compliance" },
        settings: { metrics: [], showPercentages: true },
      };
    case "section-divider":
      return { id, type, title: label, isStatic: true, settings: {} };
    case "page-break":
      return { id, type, title: label, isStatic: true, settings: {} };
    case "rich-text":
      return {
        id,
        type,
        title: label,
        isStatic: true,
        settings: { body: "" },
      };
  }
}

export function moveBlockInList(
  blocks: readonly ReportBlock[],
  index: number,
  direction: -1 | 1,
): ReportBlock[] {
  const target = index + direction;
  if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) {
    return [...blocks];
  }
  const next = [...blocks];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved);
  return next;
}

export function removeBlockFromList(
  blocks: readonly ReportBlock[],
  index: number,
): ReportBlock[] {
  if (index < 0 || index >= blocks.length) return [...blocks];
  return blocks.filter((_, i) => i !== index);
}

// Refresh captures the live binding into a static snapshot; revert drops the
// snapshot so the block renders live data again at the next render.
export function refreshBlockInList(
  blocks: readonly ReportBlock[],
  index: number,
): ReportBlock[] {
  return blocks.map((block, i) =>
    i === index ? { ...block, isStatic: true } : block,
  );
}

export function revertBlockInList(
  blocks: readonly ReportBlock[],
  index: number,
): ReportBlock[] {
  return blocks.map((block, i) =>
    i === index && block.dataBinding !== undefined
      ? { ...block, isStatic: false }
      : block,
  );
}

function describeBinding(block: ReportBlock): string {
  if (block.isStatic) return "Static content";
  return `Live: ${block.dataBinding?.entity ?? "unbound"}`;
}

function renderBlockBody(block: ReportBlock) {
  switch (block.type) {
    case "chart":
      return (
        <p style={{ color: "var(--muted)" }}>
          Chart ({String(block.settings["chartKind"] ?? "bar")}) ·{" "}
          {describeBinding(block)}
        </p>
      );
    case "score-cards": {
      const metrics = (block.settings["metrics"] as string[] | undefined) ?? [];
      return (
        <p style={{ color: "var(--muted)" }}>
          Score cards: {metrics.length > 0 ? metrics.join(", ") : "no metrics"} ·{" "}
          {describeBinding(block)}
        </p>
      );
    }
    case "progress-bars": {
      const metrics = (block.settings["metrics"] as string[] | undefined) ?? [];
      return (
        <p style={{ color: "var(--muted)" }}>
          Progress bars: {metrics.length > 0 ? metrics.join(", ") : "no metrics"} ·{" "}
          {describeBinding(block)}
        </p>
      );
    }
    case "section-divider":
      return (
        <hr
          aria-label="Section divider"
          style={{ borderColor: "var(--border-strong)" }}
        />
      );
    case "page-break":
      return (
        <p aria-label="Page break" style={{ color: "var(--muted)" }}>
          — Page break —
        </p>
      );
    case "rich-text":
      return (
        <p style={{ color: "var(--text-soft)" }}>
          {String(block.settings["body"] ?? "") || "Empty text block"}
        </p>
      );
  }
}

export interface BlockCanvasProps {
  readonly blocks: readonly ReportBlock[];
  readonly selectedBlockId?: string | null;
  readonly disabled?: boolean;
  readonly onSelect?: (blockId: string) => void;
  readonly onMoveBlock: (index: number, direction: -1 | 1) => void;
  readonly onRemoveBlock: (index: number) => void;
  readonly onRefreshBlock: (index: number) => void;
  readonly onRevertBlock: (index: number) => void;
}

export default function BlockCanvas({
  blocks,
  selectedBlockId = null,
  disabled = false,
  onSelect,
  onMoveBlock,
  onRemoveBlock,
  onRefreshBlock,
  onRevertBlock,
}: BlockCanvasProps) {
  if (blocks.length === 0) {
    return (
      <section
        aria-label="Report canvas"
        data-testid="report-canvas-empty"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderRadius: "10px",
          color: "var(--muted)",
          padding: "24px",
        }}
      >
        No blocks yet. Use Add block to start building the report.
      </section>
    );
  }

  return (
    <section aria-label="Report canvas" data-testid="report-canvas">
      {blocks.map((block, index) => {
        const selected = block.id === selectedBlockId;
        return (
          <article
            key={block.id}
            data-testid={`report-block-${block.id}`}
            data-block-type={block.type}
            aria-label={`${block.type} block: ${block.title}`}
            onClick={() => onSelect?.(block.id)}
            style={{
              background: "var(--surface)",
              border: selected
                ? "1px solid var(--accent)"
                : "1px solid var(--border)",
              borderRadius: "10px",
              color: "var(--text)",
              marginBottom: "16px",
              padding: "16px",
            }}
          >
            <h3 style={{ color: "var(--text)" }}>{block.title}</h3>
            <p style={{ color: "var(--muted)" }}>
              {block.type} · {describeBinding(block)}
            </p>
            {renderBlockBody(block)}
            <BlockControls
              blockId={block.id}
              blockTitle={block.title}
              isFirst={index === 0}
              isLast={index === blocks.length - 1}
              isLive={!block.isStatic}
              canRevert={block.dataBinding !== undefined}
              disabled={disabled}
              onMoveUp={() => onMoveBlock(index, -1)}
              onMoveDown={() => onMoveBlock(index, 1)}
              onRemove={() => onRemoveBlock(index)}
              onRefresh={() => onRefreshBlock(index)}
              onRevert={() => onRevertBlock(index)}
            />
          </article>
        );
      })}
    </section>
  );
}
