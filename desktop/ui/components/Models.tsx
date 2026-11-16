import { ArrowLeft, Columns2 } from "lucide-react";
import { t, useI18n } from "../i18n";
import {
  clientLabel,
  communityId,
  measurementTitle,
  parserVersion,
  metricVersion,
  type CohortGroup,
  type CohortRow,
  type SortKey,
} from "../metrics";
import type { Board } from "../store/types";
import type { Dashboard } from "../model/dashboard";
import { effortChip, modelName, num } from "../model/format";
import { useStore } from "../store/store";
import {
  modelSelection,
  niceMedianMax,
  providerName,
  sortModelRows,
  type ModelSort,
  type ModelSpeedRow,
} from "../response";
import type { ModelsView } from "../store/types";
import type { EfficiencySort } from "../efficiency";
import { EfficiencyAbout, EfficiencyList } from "./Efficiency";
import { Chip, ProviderBadge, Segmented, ToolNameChip, useAppStore } from "./primitives";

/**
 * Response speed ranks models across tools; Turn speed keeps one list per measurement group;
 * Efficiency ranks model and effort by the indicator over the last 7 d.
 */
function ViewToggle() {
  const { t } = useI18n();
  const store = useAppStore();
  const view = useStore(store, (s) => s.ui.modelsView);
  const viewOptions: { value: ModelsView; label: string }[] = [
    { value: "response", label: t("models.responseSpeed") },
    { value: "turn", label: t("models.turnSpeed") },
    { value: "efficiency", label: t("efficiency.short") },
  ];
  return (
    <Segmented
      label={t("models.speedMeasurement")}
      size="sm"
      value={view}
      options={viewOptions}
      onChange={(v) => store.setModelsView(v)}
    />
  );
}

function ResponseModelRow({
  row,
  selected,
  max,
  onSelect,
  detailed,
}: {
  row: ModelSpeedRow;
  selected: boolean;
  max: number;
  onSelect: () => void;
  detailed: boolean;
}) {
  useI18n();
  const fill =
    row.median !== null && max > 0 ? Math.min(100, Math.max(4, (row.median / max) * 100)) : 0;
  const grok = row.tools.includes("grok-build");
  const grokOnly = grok && row.tools.length === 1;
  const sub = row.turns
    ? [
        t(row.turns === 1 ? "count.turn" : "count.turns", { n: row.turns }),
        grokOnly
          ? t(row.responses === 1 ? "count.modelCall" : "count.modelCalls", { n: row.responses })
          : t(row.responses === 1 ? "count.response" : "count.responses", { n: row.responses }),
      ].join(" · ")
    : row.untimed
      ? t("models.noTiming")
      : t("models.collecting");
  const title = [
    t("models.rowTitle", {
      model: row.model.model ?? t("common.unknownModel"),
      provider: providerName(row.model.provider),
    }),
    t("models.rowMedian", { count: t("count.turns", { n: row.turns }) }),
    row.untimed
      ? t("models.turnsWithoutTiming", { count: t("count.turns", { n: row.untimed }) })
      : null,
    grok ? `${t("metric.grokNote")}\n${t("metric.grokExplanation")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <li>
      <button
        type="button"
        className="model-row"
        aria-current={selected || undefined}
        title={title}
        onClick={onSelect}
      >
        <span className="model-main">
          <span className="model-name">
            <ProviderBadge model={row.model.model} provider={row.model.provider} size={16} />
            <span className="model-name-text">{row.model.model ?? t("common.unknownModel")}</span>
            {row.tools.map((id) => (
              <ToolNameChip key={id} tool={id} />
            ))}
            {row.hasSubagent && <Chip title={t("models.includesSubagent")}>{t("models.subagent")}</Chip>}
          </span>
          <span className="model-sub">
            {sub}
            {detailed && row.model.provider && row.model.provider !== "unknown" && (
              <> · {providerName(row.model.provider)}</>
            )}
          </span>
        </span>
        <span className="model-value">
          <span className="model-number">
            {num(row.median)}
            <small> tok/s</small>
          </span>
          <span className="minibar" aria-hidden="true">
            <span style={{ width: `${fill}%` }} />
          </span>
        </span>
      </button>
    </li>
  );
}

function ModelRow({
  row,
  selected,
  max,
  onSelect,
  detailed,
  community,
}: {
  row: CohortRow;
  selected: boolean;
  max: number;
  onSelect: () => void;
  detailed: boolean;
  community: number | null;
}) {
  useI18n();
  const { sample, stats, qualifier } = row;
  const median = stats.throughput.median;
  const fill = median !== null && max > 0 ? Math.min(100, Math.max(4, (median / max) * 100)) : 0;
  const title = [
    t("models.cohortTitle", {
      model: modelName(sample),
      tool: clientLabel(sample),
      version: sample.clientVersion ?? t("metric.versionUnknown"),
    }),
    t("models.cohortDefinition", {
      measurement: measurementTitle(sample),
      parser: parserVersion(sample),
      metric: metricVersion(sample),
    }),
    t("models.cohortCounts", {
      turns: t("count.turns", { n: stats.throughput.count }),
      ttft: stats.ttft.count,
    }),
  ].join("\n");
  return (
    <li>
      <button
        type="button"
        className="model-row"
        aria-current={selected || undefined}
        title={title}
        onClick={onSelect}
      >
        <span className="model-main">
          <span className="model-name">
            <span className="model-name-text">{modelName(sample)}</span>
            <Chip tone={effortChip(sample) === t("common.unknownEffort") ? "neutral" : "accent"}>
              {effortChip(sample)}
            </Chip>
          </span>
          <span className="model-sub">
            {[qualifier, t("count.turns", { n: stats.throughput.count })]
              .filter(Boolean)
              .join(" · ")}
            {detailed && (
              <>
                {stats.ttft.median !== null && (
                  <> · {t("models.firstTokenS", { value: num(stats.ttft.median) })}</>
                )}
                {community !== null && (
                  <> · {t("models.communityValue", { value: num(community, 0) })}</>
                )}
              </>
            )}
          </span>
        </span>
        <span className="model-value">
          <span className="model-number">
            {num(median)}
            <small> tok/s</small>
          </span>
          <span className="minibar" aria-hidden="true">
            <span style={{ width: `${fill}%` }} />
          </span>
        </span>
      </button>
    </li>
  );
}

function communityMedians(board: Board | null) {
  const map = new Map<string, number>();
  for (const c of board?.cohorts ?? [])
    if (typeof c.medianThroughput === "number" && c.medianThroughput > 0)
      map.set(c.id, c.medianThroughput);
  return map;
}

function GroupHead({ group }: { group: CohortGroup }) {
  return (
    <h3 className="group-head" title={group.definition}>
      {group.title}
    </h3>
  );
}

export function YourModels({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useI18n();
  const store = useAppStore();
  const view = useStore(store, (s) => s.ui.modelsView);
  if (!dashboard.cohorts.length) return null;
  const rows = sortModelRows(dashboard.modelRows, "speed");
  const max = niceMedianMax(rows);
  const current = dashboard.isAll ? null : dashboard.activeKey;
  return (
    <section className="models" aria-labelledby="your-models">
      <div className="section-head">
        <h2 id="your-models">{t("models.yourModels")}</h2>
        <button
          type="button"
          className="text-button"
          onClick={() => void store.selectCohort("all")}
        >
          <Columns2 size={16} aria-hidden="true" />
          {t("models.compareAll")}
        </button>
      </div>
      <div className="view-toggle">
        <ViewToggle />
        {view === "response" && <span className="muted-line">{t("models.median24")}</span>}
        {view === "efficiency" && <span className="muted-line">{t("models.last7d")}</span>}
      </div>
      {view === "efficiency" ? (
        <>
          <EfficiencyAbout badge />
          <EfficiencyList efficiency={dashboard.efficiency} sort="efficiency" flush={false} />
        </>
      ) : view === "response" ? (
        <div className="model-group">
          <ul className="model-list">
            {rows.map((row) => (
              <ResponseModelRow
                key={row.key}
                row={row}
                selected={
                  !!current &&
                  row.key === modelSelection(current)
                }
                max={max}
                detailed={false}
                onSelect={() => void store.selectCohort(row.key)}
              />
            ))}
          </ul>
        </div>
      ) : (
        dashboard.groups.map((group) => (
          <div className="model-group" key={group.key}>
            <GroupHead group={group} />
            <ul className="model-list">
              {group.rows.map((row) => (
                <ModelRow
                  key={row.key}
                  row={row}
                  selected={
                    dashboard.mode.kind !== "all" && dashboard.selectedKey === row.key
                  }
                  max={group.max}
                  detailed={false}
                  community={null}
                  onSelect={() => void store.selectCohort(row.key)}
                />
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}

/** "Compare all": the model list becomes the content, with a sort control. */
export function CompareAll({
  dashboard,
  board,
}: {
  dashboard: Dashboard;
  board: Board | null;
}) {
  const { t } = useI18n();
  const store = useAppStore();
  const sort = useStore(store, (s) => s.ui.sort);
  const view = useStore(store, (s) => s.ui.modelsView);
  const groups = dashboard.compareGroups;
  const community = communityMedians(board);
  const dayLabel = dashboard.days === 1 ? t("trend.range24") : t("trend.range7");
  const responseSort: ModelSort = sort === "recent" ? "recent" : "speed";
  const responseRows = sortModelRows(dashboard.modelRows, responseSort);
  const responseMax = niceMedianMax(responseRows);
  const efficiencySort: EfficiencySort = sort === "recent" ? "recent" : "efficiency";
  const sorts: { value: SortKey; label: string }[] = [
    { value: "recent", label: t("models.sortMostRecent") },
    { value: "throughput", label: t("models.sortHigherTurn") },
    { value: "ttft", label: t("models.sortLowerFirstToken") },
  ];
  const responseSorts: { value: ModelSort; label: string }[] = [
    { value: "speed", label: t("models.sortHigherResponse") },
    { value: "recent", label: t("models.sortMostRecent") },
  ];
  const efficiencySorts: { value: EfficiencySort; label: string }[] = [
    { value: "efficiency", label: t("models.sortHigherEfficiency") },
    { value: "recent", label: t("models.sortMostRecent") },
  ];
  return (
    <section className="card compare" aria-labelledby="compare-title">
      <div className="section-head">
        <h1 id="compare-title">{t("models.allModels")}</h1>
        <label className="sort">
          <span className="visually-hidden">{t("models.sortBy")}</span>
          {view === "response" || view === "efficiency" ? (
            <select
              value={view === "efficiency" ? efficiencySort : responseSort}
              onChange={(e) => store.setSort(e.target.value === "recent" ? "recent" : "throughput")}
            >
              {(view === "efficiency" ? efficiencySorts : responseSorts).map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          ) : (
            <select value={sort} onChange={(e) => store.setSort(e.target.value as SortKey)}>
              {sorts.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          )}
        </label>
      </div>
      <div className="view-toggle">
        <ViewToggle />
      </div>
      <p className="muted-line">
        {view === "response"
          ? t("models.medianResponse")
          : view === "efficiency"
            ? t("models.efficiencyScope")
            : t("models.medianTurn", { range: dayLabel })}
      </p>
      {view === "efficiency" && <EfficiencyAbout badge />}
      {view === "efficiency" ? (
        <EfficiencyList efficiency={dashboard.efficiency} sort={efficiencySort} flush />
      ) : view === "response" ? (
        responseRows.length ? (
          <div className="model-group">
            <ul className="model-list model-list-flush">
              {responseRows.map((row) => (
                <ResponseModelRow
                  key={row.key}
                  row={row}
                  selected={false}
                  max={responseMax}
                  detailed
                  onSelect={() => void store.selectCohort(row.key)}
                />
              ))}
            </ul>
          </div>
        ) : (
          <p className="empty">{t("models.emptyResponse")}</p>
        )
      ) : groups.length ? (
        groups.map((group) => (
          <div className="model-group" key={group.key}>
            <GroupHead group={group} />
            <ul className="model-list model-list-flush">
              {group.rows.map((row) => (
                <ModelRow
                  key={row.key}
                  row={row}
                  selected={false}
                  max={group.max}
                  detailed
                  community={community.get(communityId(row.sample)) ?? null}
                  onSelect={() => void store.selectCohort(row.key)}
                />
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p className="empty">{t("models.emptyTurn")}</p>
      )}
      <p className="fine">
        {view === "efficiency"
          ? t("models.fineEfficiency")
          : view === "response"
          ? t("models.fineResponse")
          : t("models.fineTurn")}
      </p>
      <button type="button" className="text-button back" onClick={() => void store.selectCohort("auto")}>
        <ArrowLeft size={16} aria-hidden="true" />
        {t("models.backToAuto")}
      </button>
    </section>
  );
}
