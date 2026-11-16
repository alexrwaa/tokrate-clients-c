import { CODING_TOOLS, PROVIDER_LABELS, client, clientLabel, type Metric } from "../metrics";
import { t } from "../i18n";
import type { SourceId } from "../store/types";

/** One decimal by default; an em dash when there is no value. */
export const num = (v: number | null | undefined, digits = 1) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(digits) : "—";

/** Gauge readout: whole numbers from 100 up keep the large number inside the dial. */
export const readout = (v: number | null | undefined) =>
  typeof v === "number" && Number.isFinite(v)
    ? v.toFixed(v >= 100 ? 0 : 1)
    : "—";

export const exactTime = (value: string | number) => {
  const time = typeof value === "string" ? Date.parse(value) : value;
  return Number.isFinite(time) ? new Date(time).toLocaleString() : t("common.unavailable");
};

/** "Oct 4, 2:00 PM": compact bucket time for chart tooltips. */
export const shortTime = (time: number) =>
  Number.isFinite(time)
    ? new Date(time).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : t("common.unavailable");

/** "+12%" / "−8%" with a typographic minus. */
export const signedPercent = (percent: number) => {
  const value = Math.round(percent);
  return value > 0 ? `+${value}%` : value < 0 ? `−${Math.abs(value)}%` : "0%";
};

export const SOURCE_TITLES = Object.fromEntries(
  Object.entries(CODING_TOOLS).map(([id, { title }]) => [id, title]),
) as Record<SourceId, string>;

/** Provider filter options in picker order: every attributable provider, then the unknown route. */
export const PROVIDER_TITLES: Record<string, string> = {
  ...PROVIDER_LABELS,
  unknown: "Unknown route",
};

export const modelName = (m: Metric | undefined) =>
  m?.model ?? t("metric.unknownModel");

/** "high effort", "effort unknown": the vocabulary word is part of the chip. */
export const effortText = (effort: string | null | undefined) =>
  effort && effort !== "unknown"
    ? t("common.effort", { effort })
    : t("common.unknownEffort");
export const effortChip = (m: Metric) => effortText(m.reasoningEffort);
/** The bare effort word for titles, where the chip's label would be redundant. */
export const effortWord = (effort: string | null | undefined) =>
  effort && effort !== "unknown" ? effort : t("common.unknownEffort");

/** Token counts compactly: 950, 4.9k, 12k, 1.2M. */
export function compactTokens(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  const n = Math.round(v);
  if (Math.abs(n) < 1000) return String(n);
  const [value, suffix] = Math.abs(n) < 999500 ? [n / 1e3, "k"] : [n / 1e6, "M"];
  const rounded = Math.abs(value) < 9.95 ? value.toFixed(1) : String(Math.round(value));
  return `${rounded.replace(/\.0$/, "")}${suffix}`;
}

/** "42%" from a 0..1 share; an em dash without a value. */
export const percentText = (share: number | null | undefined) =>
  typeof share === "number" && Number.isFinite(share) ? `${Math.round(share * 100)}%` : "—";

/** "Claude Code · v2.1.0" style secondary line; qualifier only when entries would look identical. */
export const cohortSubtitle = (m: Metric, qualifier: string | null) =>
  [clientLabel(m), qualifier].filter(Boolean).join(" · ");

/** Single-line plain text for assistive tech and tooltips. */
export const cohortSummary = (m: Metric, qualifier: string | null = null) =>
  [
    modelName(m),
    clientLabel(m),
    effortText(m.reasoningEffort),
    qualifier,
  ]
    .filter(Boolean)
    .join(", ");

/** Compact folder name: the last path segment, with the full path left for a tooltip. */
export function folderName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  if (!parts.length) return trimmed || t("common.defaultFolder");
  const last = parts[parts.length - 1];
  const parent = parts[parts.length - 2];
  return parent ? `${parent}/${last}` : last;
}

export const sourceOf = (m: Metric): SourceId => client(m) as SourceId;
