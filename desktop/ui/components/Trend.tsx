import { useMemo } from "react";
import {
  buckets,
  client,
  isGrokBuild,
  measurementLabel,
  toolLabel,
  type Metric,
} from "../metrics";
import { t, useI18n } from "../i18n";
import type { Dashboard } from "../model/dashboard";
import { num, signedPercent } from "../model/format";
import { useStore } from "../store/store";
import type { ChartMetric } from "../store/types";
import { EFFICIENCY_MIN_TURNS } from "../efficiency";
import { EfficiencyAbout, EfficiencyDetailRows, requestsOfFloor } from "./Efficiency";
import { Disclosure, Segmented, useAppStore } from "./primitives";
import { TrendChart } from "./TrendChart";

/** First-token time follows the observed runtime: native Codex and T3's Codex parser report it. */
export const supportsFirstToken = (sample: Metric | undefined) =>
  !sample || client(sample) === "codex" || (
    client(sample) === "t3-code" &&
    sample.parserVersion === "codex-rollout-v2" &&
    sample.metricVersion === "turn-v1"
  );

/**
 * Response speed pools the model's turns across tools; turn speed and first token stay on one
 * cohort. Efficiency buckets come precomputed: they need the 7-day reference.
 */
export function useTrendBuckets(
  dashboard: Dashboard,
  metric: ChartMetric,
  source: Metric[] = metric === "response" ? dashboard.responseInRange : dashboard.inRange,
) {
  return useMemo(
    () =>
      metric === "efficiency"
        ? dashboard.efficiency.buckets
        : buckets(source, dashboard.now, dashboard.days, metric),
    [source, dashboard.now, dashboard.days, dashboard.efficiency, metric],
  );
}

export function MetricToggle({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useI18n();
  const store = useAppStore();
  const metric = useStore(store, (s) => s.ui.chartMetric);
  const firstToken = supportsFirstToken(dashboard.sample);
  const speedHelp = t("trend.speedHelp");
  return (
    <div className="metric-toggle">
      <Segmented
        label={t("trend.metric")}
        size="sm"
        value={chartCopy(dashboard, metric).metric}
        onChange={(v) => store.setChartMetric(v)}
        options={[
          { value: "response", label: t("trend.responseSpeed"), title: speedHelp },
          { value: "throughput", label: t("trend.turnSpeed"), title: speedHelp },
          {
            value: "ttft",
            label: t("trend.firstToken"),
            disabled: !firstToken,
            title: firstToken ? undefined : t("trend.noFirstToken"),
          },
          { value: "efficiency", label: t("efficiency.short"), title: t("efficiency.definition") },
        ]}
      />
    </div>
  );
}

export function RangeToggle() {
  const { t } = useI18n();
  const store = useAppStore();
  const days = useStore(store, (s) => s.snapshot.settings.days);
  return (
    <Segmented
      label={t("trend.range")}
      size="sm"
      value={String(days) as "1" | "7"}
      onChange={(v) => void store.setDays(v === "1" ? 1 : 7)}
      options={[
        { value: "1", label: t("trend.range24") },
        { value: "7", label: t("trend.range7") },
      ]}
    />
  );
}

/** The selected model has turns but none with per-response timing (for example Grok Build). */
export const responseSpeedUnavailable = (dashboard: Dashboard) =>
  !!dashboard.sample && dashboard.hero.value === null && dashboard.responseTotals.turns === 0;

/** Why there is no response speed: names the coding tool when its source records only whole turns. */
export const responseUnavailableText = (sample: Metric | undefined) =>
  sample && client(sample) === "grok-build"
    ? t("trend.noResponseGrok", { tool: toolLabel("grok-build") })
    : t("trend.noResponse");

/**
 * Chart copy for the chosen metric. `null` is automatic: Response, or Turn when the model has no
 * response data. An explicit choice is never overridden, even when it has no data.
 */
export function chartCopy(dashboard: Dashboard, metric: ChartMetric | null) {
  const firstToken = supportsFirstToken(dashboard.sample);
  const unavailable = responseSpeedUnavailable(dashboard);
  const effective: ChartMetric =
    metric && (firstToken || metric !== "ttft")
      ? metric
      : unavailable
        ? "throughput"
        : "response";
  const efficiency = dashboard.efficiency;
  return {
    metric: effective,
    unit:
      effective === "ttft" ? "s" : effective === "efficiency" ? efficiency.unit : "tok/s",
    /** Decimals and the word for one observation in the chart tooltip. */
    digits: effective === "efficiency" ? 0 : 1,
    noun: effective === "efficiency" ? "request" : "turn",
    title: {
      response: t("trend.responseSpeed"),
      throughput: t("trend.turnSpeed"),
      ttft: t("trend.firstToken"),
      efficiency: t("efficiency.name"),
    }[effective],
    empty:
      effective === "ttft"
        ? t("trend.noFirstTokenRange")
        : effective === "response" && unavailable
          ? responseUnavailableText(dashboard.sample)
          : effective === "efficiency"
            ? efficiency.selected?.indicator != null || dashboard.isAll
              ? t("trend.notEnoughRequests")
              : t("efficiency.insufficient")
            : t("trend.collecting"),
    summary: {
      response: dashboard.responseSummary,
      throughput: dashboard.summary.throughput,
      ttft: dashboard.summary.ttft,
      // The indicator spans the whole 7-day history, whatever the chart range.
      efficiency: {
        median: efficiency.selected?.indicator ?? null,
        min: null,
        max: null,
        count: efficiency.selected?.turns ?? 0,
      },
    }[effective],
  };
}

export function Trend({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useI18n();
  const store = useAppStore();
  const metric = useStore(store, (s) => s.ui.chartMetric);
  const copy = chartCopy(dashboard, metric);
  const data = useTrendBuckets(dashboard, copy.metric);
  const { summary } = copy;
  const dayLabel = dashboard.days === 1 ? t("trend.range24") : t("trend.range7");
  // No evidence at all collapses to one status line instead of an empty chart.
  if (!dashboard.sample)
    return (
      <section className="card status-card" aria-label={t("trend.aria")}>
        <p>{t("trend.collecting")}</p>
      </section>
    );
  return (
    <section className="card trend" aria-label={t("trend.aria")}>
      <div className="card-head">
        <MetricToggle dashboard={dashboard} />
        <RangeToggle />
      </div>
      <TrendChart
        buckets={data}
        unit={copy.unit}
        days={dashboard.days}
        height={112}
        emptyMessage={copy.empty}
        ariaLabel={t("trend.chartAria", { title: copy.title, range: dayLabel })}
        digits={copy.digits}
        noun={copy.noun}
      />
      <p className="trend-foot">
        {copy.metric === "efficiency" ? (
          dashboard.efficiency.selected?.indicator != null ? (
            <>
              <strong>{dashboard.efficiency.selected.indicator}</strong>{" "}
              {t("efficiency.indicatorWord")} · {t("count.requests", { n: summary.count })}{" "}
              {t("trend.in7d")}
            </>
          ) : dashboard.efficiency.selected ? (
            <>{requestsOfFloor(summary.count)}</>
          ) : (
            <>{t("trend.collecting")}</>
          )
        ) : summary.count ? (
          <>
            {t("trend.median")} <strong>{num(summary.median)}</strong> {copy.unit} ·{" "}
            {t("trend.turnsInRange", {
              count: summary.count,
              noun: t(summary.count === 1 ? "chart.turn" : "chart.turns"),
              range: dayLabel,
            })}
            {copy.metric === "response" && dashboard.responseTotals.responses > 0 && (
              <>
                {" "}
                · {t("count.responses", { n: dashboard.responseTotals.responses })}
              </>
            )}
          </>
        ) : (
          <>{t("trend.collecting")}</>
        )}
      </p>
      <Disclosure label={t("trend.details")} className="trend-details">
        <TrendDetails dashboard={dashboard} />
      </Disclosure>
    </section>
  );
}

function StatRow({
  label,
  median,
  min,
  max,
  count,
  unit,
}: {
  label: string;
  median: number | null;
  min: number | null;
  max: number | null;
  count: number;
  unit: string;
}) {
  return (
    <div className="stat-row">
      <dt>{label}</dt>
      <dd>
        <strong>
          {num(median)} {unit}
        </strong>
        <span>
          {t("trend.minMax", {
            min: num(min),
            max: num(max),
            count,
            noun: t(count === 1 ? "chart.turn" : "chart.turns"),
          })}
        </span>
      </dd>
    </div>
  );
}

/** The numbers behind the headline: ranges, recent window, period change and baseline signals. */
export function TrendDetails({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useI18n();
  const { summary, recent15m, change, signals, sample } = dashboard;
  const dayLabel = dashboard.days === 1 ? t("trend.range24") : t("trend.range7");
  const firstToken = supportsFirstToken(sample);
  const pct = (v: number | null) => (v === null ? "—" : signedPercent(v));
  return (
    <div className="details">
      <dl className="stats">
        <StatRow
          label={t("trend.responseSpeedRange", { range: dayLabel })}
          unit="tok/s"
          {...dashboard.responseSummary}
        />
        <StatRow
          label={t("trend.turnSpeedRange", { range: dayLabel })}
          unit="tok/s"
          {...summary.throughput}
        />
        {firstToken ? (
          <StatRow
            label={t("trend.firstTokenRange", { range: dayLabel })}
            unit="s"
            {...summary.ttft}
          />
        ) : (
          <div className="stat-row">
            <dt>{t("trend.firstToken")}</dt>
            <dd>
              <span>{t("trend.notCaptured")}</span>
            </dd>
          </div>
        )}
        <StatRow
          label={t("trend.last15Response")}
          unit="tok/s"
          {...dashboard.recentResponse15m}
        />
        <StatRow
          label={t("trend.last15Turn")}
          unit="tok/s"
          {...recent15m.throughput}
        />
      </dl>
      <dl className="stats">
        <div className="stat-row">
          <dt>{t("trend.efficiency7d")}</dt>
          <dd>
            {dashboard.efficiency.selected?.indicator != null ? (
              <>
                <strong>
                  {dashboard.efficiency.selected.indicator} {t("efficiency.indicatorWord")}
                </strong>
                <span>{t("trend.typical")}</span>
              </>
            ) : (
              <span>
                {dashboard.efficiency.selected
                  ? requestsOfFloor(dashboard.efficiency.selected.turns)
                  : t("efficiency.requestsFloor", { turns: 0, min: EFFICIENCY_MIN_TURNS })}
              </span>
            )}
          </dd>
        </div>
        {dashboard.efficiency.selected && <EfficiencyDetailRows row={dashboard.efficiency.selected} />}
      </dl>
      <EfficiencyAbout />
      <p className="detail-line">
        <strong>{t("trend.vs24")}</strong>
        <span>
          {t("trend.vs24Line", {
            response: pct(change.response),
            turn: pct(change.throughput),
          })}
          {firstToken && t("trend.vs24FirstToken", { value: pct(change.ttft) })}
        </span>
        <small>{t("trend.needs5")}</small>
      </p>
      <p className="detail-line">
        <strong>{t("trend.baseline")}</strong>
        <span>{signals.throughput}</span>
        {firstToken && <span>{signals.ttft}</span>}
        <small>{t("trend.workload")}</small>
      </p>
      <p className="detail-line detail-fine">
        {t("trend.pools")}
        {isGrokBuild(sample) && ` ${t("metric.grokExplanation")}`}{" "}
        {t("trend.turnSpeedDef", {
          measurement: sample ? measurementLabel(sample) : t("metric.turnSpeed"),
        })}
        {firstToken && ` ${t("trend.firstTokenNote")}`} {t("trend.bucketNote")}
      </p>
    </div>
  );
}
