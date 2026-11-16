import { Users } from "lucide-react";
import { useI18n } from "../i18n";
import { alertsForCohorts } from "../metrics";
import {
  communityLine,
  communityRows,
  communityWindowLabel,
  type Dashboard,
} from "../model/dashboard";
import { exactTime, num } from "../model/format";
import { useStore } from "../store/store";
import { Chip, Disclosure, useAppStore } from "./primitives";

/** One line about the community, shown only while sharing is on; the details sit behind a disclosure. */
export function Community({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useI18n();
  const store = useAppStore();
  const settings = useStore(store, (s) => s.snapshot.settings);
  const board = useStore(store, (s) => s.snapshot.board);
  const status = useStore(store, (s) => s.snapshot.status);
  const toolFilter = useStore(store, (s) => s.ui.toolFilter);
  const providerFilter = useStore(store, (s) => s.ui.providerFilter);
  if (!settings.sharing) return null;

  const line = dashboard.isAll ? null : communityLine(board, dashboard);
  const rows = communityRows(board, dashboard, toolFilter, providerFilter);
  const alerts = alertsForCohorts(
    board?.alerts ?? [],
    new Set(rows.map((c) => c.id)),
  );
  const summary = dashboard.isAll
    ? board
      ? t("community.published", {
          count: t(rows.length === 1 ? "count.model" : "count.models", { n: rows.length }),
        })
      : status
    : line
      ? null
      : board
        ? t("community.noData")
        : status;
  const caution = line?.caution
    ? line.caution === "Early data"
      ? t("community.earlyData")
      : t("community.olderData")
    : board?.methodology?.publicationMode === "early_data"
      ? t("community.earlyData")
      : null;

  return (
    <section className="card community" aria-label={t("community.aria")}>
      <div className="community-line">
        <Users size={18} aria-hidden="true" className="community-icon" />
        {line ? (
          <p>
            <span>
              {t("community.median", {
                value: num(line.median, 0),
                window: line.windowLabel,
              })}
            </span>
            {line.position !== null && (
              <span className="community-position">
                {line.position === 0
                  ? t("community.atMedian")
                  : t(line.position > 0 ? "community.faster" : "community.slower", {
                      percent: Math.abs(line.position),
                    })}
              </span>
            )}
          </p>
        ) : (
          <p>{summary}</p>
        )}
        {caution && (
          <Chip tone="warn" title={t("community.earlyTitle")}>
            {caution}
          </Chip>
        )}
      </div>
      <Disclosure label={t("community.details")}>
        <div className="details">
          {board ? (
            <p className="detail-fine">
              {t("community.window", {
                window: communityWindowLabel(board.window),
                state: board.state ?? t("common.unknown"),
                time: exactTime(board.dataAsOf ?? ""),
              })}
            </p>
          ) : (
            <p className="detail-fine">{status}</p>
          )}
          {rows.map((c) => (
            <div className="community-row" key={c.id}>
              <div>
                <strong>{c.model ?? t("common.unknownModel")}</strong>
                <span>
                  {c.reasoningEffort
                    ? t("common.effort", { effort: c.reasoningEffort })
                    : t("common.unknownEffort")}{" "}
                  · {t("count.contributors", { n: c.contributors ?? 0 })} ·{" "}
                  {t("count.turns", { n: c.throughputTurns ?? c.turns ?? 0 })}
                  {c.ttftTurns ? ` · ${t("community.withFirstToken", { count: c.ttftTurns })}` : ""}
                </span>
                <span>
                  {t("community.turnSpeed", {
                    state: c.signals?.throughput?.state ?? t("community.collecting"),
                  })}
                  {c.ttftTurns
                    ? ` · ${t("community.firstToken", {
                        state: c.signals?.ttft?.state ?? t("community.collecting"),
                      })}`
                    : ""}
                </span>
              </div>
              <div className="community-numbers">
                <strong>{num(c.medianThroughput)} tok/s</strong>
                {typeof c.medianTtftMs === "number" && (
                  <span>{t("community.firstTokenS", { value: num(c.medianTtftMs / 1000) })}</span>
                )}
              </div>
            </div>
          ))}
          {!rows.length && board && <p className="detail-fine">{t("community.noPublished")}</p>}
          {alerts.map((a, i) => (
            <p className="detail-line" key={i}>
              {a.message ??
                `${a.metric ?? t("community.performance")}: ${a.state ?? t("community.changeObserved")}`}
            </p>
          ))}
          <p className="detail-fine">{t("community.missingAlerts")}</p>
        </div>
      </Disclosure>
    </section>
  );
}
