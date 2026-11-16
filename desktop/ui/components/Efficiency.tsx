import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { t, useI18n } from "../i18n";
import {
  EFFICIENCY_MIN_TURNS,
  efficiencyScaleMax,
  sortEfficiencyRows,
  type EfficiencyDashboard,
  type EfficiencyRow,
  type EfficiencySort,
} from "../efficiency";
import { compactTokens, effortText, percentText } from "../model/format";
import { Chip, InfoDisclosure, ProviderBadge } from "./primitives";

/** "n of 20 requests" for a group that has not reached the floor yet. */
export const requestsOfFloor = (turns: number) =>
  t("efficiency.requestsFloor", { turns, min: EFFICIENCY_MIN_TURNS });

/** The one-line definition, its ⓘ explanation and, in lists, the "Indicator" badge. */
export function EfficiencyAbout({ badge = false }: { badge?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="eff-about">
      {badge && <Chip tone="accent">{t("efficiency.indicator")}</Chip>}
      <span className="eff-about-text">{t("efficiency.definition")}</span>
      <InfoDisclosure label={t("efficiency.about")}>{t("efficiency.explanation")}</InfoDisclosure>
    </div>
  );
}

/** The statistics behind one group's indicator, as `.stat-row`s for a `.stats` list. */
export function EfficiencyDetailRows({ row }: { row: EfficiencyRow }) {
  const { t } = useI18n();
  return (
    <>
      <div className="stat-row">
        <dt>{t("efficiency.eligible")}</dt>
        <dd>
          <strong>{row.turns}</strong>
          <span>{t("efficiency.eligibleHint")}</span>
        </dd>
      </div>
      <div className="stat-row">
        <dt>{t("efficiency.medianTokens")}</dt>
        <dd>
          <strong>{compactTokens(row.medianTokens)}</strong>
          <span>
            {t("efficiency.middleHalf", {
              p25: compactTokens(row.p25Tokens),
              p75: compactTokens(row.p75Tokens),
            })}
          </span>
        </dd>
      </div>
      <div className="stat-row">
        <dt>{t("efficiency.reasoningShare")}</dt>
        <dd>
          <strong>{percentText(row.reasoningShare)}</strong>
          <span>{t("efficiency.medianOutput")}</span>
        </dd>
      </div>
      <div className="stat-row">
        <dt>{t("efficiency.delegatedShare")}</dt>
        <dd>
          <strong>{percentText(row.delegatedShare)}</strong>
          <span>{t("efficiency.allTokens")}</span>
        </dd>
      </div>
    </>
  );
}

function EfficiencyListRow({
  row,
  scaleMax,
}: {
  row: EfficiencyRow;
  scaleMax: number;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const id = useId();
  const fill =
    row.indicator === null ? 0 : Math.min(100, Math.max(4, (row.indicator / scaleMax) * 100));
  const sub =
    row.indicator === null
      ? t("efficiency.notEnough")
      : t("efficiency.tokensPerRequest", {
          tokens: compactTokens(row.medianTokens),
          count: t(row.turns === 1 ? "count.request" : "count.requests", { n: row.turns }),
        });
  return (
    <li>
      <button
        type="button"
        className="model-row eff-row"
        aria-expanded={open}
        aria-controls={id}
        title={`${t("efficiency.rowTitle", {
          model: row.model,
          effort: effortText(row.effort),
        })}\n${t("efficiency.rowTitleSub")}`}
        onClick={() => setOpen(!open)}
      >
        <span className="model-main">
          <span className="model-name">
            <ProviderBadge model={row.model} provider={row.provider} size={16} />
            <span className="model-name-text">{row.model}</span>
            <Chip tone={row.effort === "unknown" ? "neutral" : "accent"}>{effortText(row.effort)}</Chip>
          </span>
          <span className="model-sub">{sub}</span>
        </span>
        <span className="model-value">
          {row.indicator === null ? (
            <span className="model-sub">{requestsOfFloor(row.turns)}</span>
          ) : (
            <span className="model-number">
              {row.indicator}
              <small> {t("efficiency.indicatorWord")}</small>
            </span>
          )}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="chevron" />
        {row.indicator !== null && (
          <span className="eff-bar" aria-hidden="true">
            <span className="eff-bar-fill" style={{ width: `${fill}%` }} />
            <span className="eff-bar-tick" style={{ left: `${(100 / scaleMax) * 100}%` }} />
          </span>
        )}
      </button>
      {open && (
        <div className="eff-detail" id={id}>
          <dl className="stats">
            <EfficiencyDetailRows row={row} />
          </dl>
        </div>
      )}
    </li>
  );
}

/**
 * Models ranked by efficiency indicator, highest first. Bars share one scale with a tick at 100
 * ("typical"); groups under 20 requests show their progress instead of a value.
 */
export function EfficiencyList({
  efficiency,
  sort,
  flush,
}: {
  efficiency: EfficiencyDashboard;
  sort: EfficiencySort;
  flush: boolean;
}) {
  const { t } = useI18n();
  const rows = sortEfficiencyRows(efficiency.rows, sort);
  if (!rows.length) return <p className="empty">{t("efficiency.insufficient")}</p>;
  const scaleMax = efficiencyScaleMax(rows);
  const tick = (100 / scaleMax) * 100;
  return (
    <div className="model-group">
      {!efficiency.reference && (
        <p className="muted-line eff-note">{t("efficiency.insufficient")}</p>
      )}
      {efficiency.reference && (
        <div className="eff-scale" aria-hidden="true">
          <span className={tick > 85 ? "eff-scale-end" : undefined} style={{ left: `${tick}%` }}>
            {t("efficiency.typical")}
          </span>
        </div>
      )}
      <ul className={flush ? "model-list model-list-flush" : "model-list"}>
        {rows.map((row) => (
          <EfficiencyListRow key={row.key} row={row} scaleMax={scaleMax} />
        ))}
      </ul>
    </div>
  );
}
