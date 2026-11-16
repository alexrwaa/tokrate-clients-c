import { t, useI18n } from "../i18n";
import { Mark, useAppStore, Chip } from "./primitives";
import { ModelPicker } from "./Header";
import { Footer } from "./Footer";
import { chartCopy, MetricToggle, RangeToggle, TrendDetails, useTrendBuckets } from "./Trend";
import { TrendChart } from "./TrendChart";
import {
  clientLabel,
  isGrokBuild,
  isSubagent,
  measurementChip,
  measurementTitle,
  providerRoute,
  relativeTime,
  responseSpeed,
} from "../metrics";
import type { Dashboard } from "../model/dashboard";
import { effortChip, exactTime, modelName, num } from "../model/format";
import { totalTokens } from "../efficiency";
import { useStore } from "../store/store";
import type { Metric } from "../metrics";

const MAX_ROWS = 500;

/**
 * Output plus delegated subagent tokens of a request. While delegated work is not final the plain
 * output count is shown muted; subagent turns are counted in the request that started them.
 */
function RequestTokens({ m }: { m: Metric }) {
  const total = totalTokens(m);
  if (total !== null) return <>{total}</>;
  if (isSubagent(m))
    return (
      <span className="muted-value" title={t("history.countedInParent")}>
        —
      </span>
    );
  return (
    <span className="muted-value" title={t("history.delegatedNotCounted")}>
      {m.outputTokens}
    </span>
  );
}

/** The full-history window: larger chart, the numbers behind it and the bounded 500-row table. */
export function HistoryView({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useI18n();
  const store = useAppStore();
  const metric = useStore(store, (s) => s.ui.chartMetric);
  const copy = chartCopy(dashboard, metric);
  const data = useTrendBuckets(dashboard, copy.metric);
  const rows = dashboard.historyRows.slice(0, MAX_ROWS);
  const dayLabel = dashboard.days === 1 ? t("history.range24") : t("history.range7");
  return (
    <div className="history-view">
      <header className="topbar history-topbar">
        <div className="brand">
          <Mark size={28} />
          <span>{t("history.brand")}</span>
        </div>
        <ModelPicker dashboard={dashboard} />
        <RangeToggle />
      </header>
      <div className="scroll history-scroll">
        {dashboard.isAll ? (
          <section className="card" aria-label={t("trend.aria")}>
            <h2>{t("history.allModels")}</h2>
            <p className="hint">{t("history.chooseHint")}</p>
          </section>
        ) : (
          <div className="history-grid">
            <section className="card trend history-chart" aria-label={t("trend.aria")}>
              <div className="card-head">
                <h2>
                  {t("history.modelLast", { model: modelName(dashboard.sample), range: dayLabel })}
                </h2>
                <MetricToggle dashboard={dashboard} />
              </div>
              <TrendChart
                buckets={data}
                unit={copy.unit}
                days={dashboard.days}
                height={260}
                emptyMessage={copy.empty}
                ariaLabel={t("trend.chartAria", { title: copy.title, range: dayLabel })}
                digits={copy.digits}
                noun={copy.noun}
              />
            </section>
            <section className="card history-details" aria-label={t("history.details")}>
              <h2>{t("history.details")}</h2>
              <TrendDetails dashboard={dashboard} />
            </section>
          </div>
        )}
        <section className="card history-table-card" aria-labelledby="turn-history">
          <h2 id="turn-history">
            {t("history.turnHistory")}{" "}
            <span className="muted-count">{t("history.shown", { count: rows.length })}</span>
          </h2>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">{t("history.completed")}</th>
                  <th scope="col">{t("history.toolAndModel")}</th>
                  <th scope="col" className="num">{t("history.tokens")}</th>
                  <th
                    scope="col"
                    className="num"
                    title={t("history.tokensPerRequestTitle")}
                  >
                    {t("history.tokensPerRequest")}
                  </th>
                  <th scope="col" className="num">{t("history.responseSpeed")}</th>
                  <th scope="col" className="num">{t("history.turnSpeed")}</th>
                  <th scope="col" className="num">{t("history.firstToken")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td>
                      <time dateTime={m.completedAt} title={exactTime(m.completedAt)}>
                        {relativeTime(Date.parse(m.completedAt), dashboard.now)}
                      </time>
                    </td>
                    <td>
                      <span className="table-model">
                        <strong>{modelName(m)}</strong>
                        <Chip>{effortChip(m)}</Chip>
                        {measurementChip(m) && <Chip>{measurementChip(m)}</Chip>}
                      </span>
                      <span className="table-sub">
                        {clientLabel(m)} · {providerRoute(m.provider)}
                      </span>
                    </td>
                    <td className="num">{m.outputTokens}</td>
                    <td className="num">
                      <RequestTokens m={m} />
                    </td>
                    <td className="num" title={isGrokBuild(m) ? t("metric.grokExplanation") : undefined}>
                      {responseSpeed(m) === null ? (
                        "—"
                      ) : (
                        <>
                          <strong>{num(responseSpeed(m))}</strong> tok/s
                          <span className="table-sub">
                            {isGrokBuild(m)
                              ? t((m.responseCount ?? 0) === 1 ? "count.modelCall" : "count.modelCalls", {
                                  n: m.responseCount ?? 0,
                                })
                              : t((m.responseCount ?? 0) === 1 ? "count.response" : "count.responses", {
                                  n: m.responseCount ?? 0,
                                })}
                          </span>
                        </>
                      )}
                    </td>
                    <td className="num">
                      <strong>{num(m.turnThroughputTPS)}</strong> tok/s
                      <span className="table-sub">{measurementTitle(m)}</span>
                    </td>
                    <td className="num">
                      {m.codexTTFTSeconds === null ? "—" : `${num(m.codexTTFTSeconds)} s`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <p className="empty">{t("history.collecting")}</p>}
          </div>
        </section>
      </div>
      <Footer />
    </div>
  );
}
