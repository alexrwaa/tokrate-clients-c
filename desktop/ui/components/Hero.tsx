import { ArrowDown, ArrowUp } from "lucide-react";
import { t, useI18n } from "../i18n";
import { isGrokBuild, toolLabel } from "../metrics";
import type { Dashboard } from "../model/dashboard";
import { effortChip, exactTime, num, signedPercent } from "../model/format";
import { Gauge } from "./Gauge";
import { Chip, InfoDisclosure, ProviderBadge } from "./primitives";

/** Vocabulary definition shown next to the response-speed readout. */
export const RESPONSE_DEFINITION = () => t("hero.definition");

/** "last 5 responses · 2 min ago" for the live value; the newest turn's own timing otherwise. */
export function heroCaption(dashboard: Dashboard): string {
  const { hero, heroRelative } = dashboard;
  if (hero.value === null) return t("hero.waiting");
  if (hero.source === "live")
    return t(hero.count === 1 ? "hero.lastResponse" : "hero.lastResponses", {
      n: hero.count,
      ago: heroRelative ?? "",
    });
  return t("hero.latestTurn", { ago: heroRelative ?? "" });
}

export function Hero({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useI18n();
  const { hero, responseDelta, activeKey, sample, liveLatest, scopeTools, heroTurn } = dashboard;
  const grokHero = hero.source === "turn" && isGrokBuild(heroTurn);
  const rounded = responseDelta ? Math.round(responseDelta.percent) : 0;
  const caption = heroCaption(dashboard);
  const effort = sample
    ? effortChip(sample)
    : liveLatest?.reasoningEffort
      ? t("common.effort", { effort: liveLatest.reasoningEffort })
      : null;
  const definition = t("hero.definition");
  const grokNote = t("metric.grokNote");
  const label =
    hero.value === null
      ? t("hero.noResponseYet")
      : t("hero.gaugeLabel", {
          value: num(hero.value),
          caption,
          definition,
          grok: grokHero ? ` ${grokNote}.` : "",
        });
  const completedAt = hero.at === null ? null : new Date(hero.at).toISOString();
  return (
    <section className="hero" aria-label={t("hero.aria")}>
      <Gauge
        value={hero.value}
        max={dashboard.gaugeMax}
        label={label}
        caption={caption}
      />
      {activeKey && hero.value !== null ? (
        <div className="hero-meta">
          <h1 className="hero-model">
            <ProviderBadge model={activeKey.model} provider={activeKey.provider} size={22} />
            <span className="hero-model-name">{activeKey.model ?? t("common.unknownModel")}</span>
            {effort && (
              <Chip tone={effort === t("common.unknownEffort") ? "neutral" : "accent"}>{effort}</Chip>
            )}
          </h1>
          <p className="hero-sub">
            <span>
              {(scopeTools.length
                ? scopeTools.map(toolLabel)
                : liveLatest
                  ? [toolLabel(liveLatest.client)]
                  : []
              ).join(" + ")}
            </span>
            {completedAt && (
              <>
                <span aria-hidden="true">·</span>
                <time
                  dateTime={completedAt}
                  title={t("hero.updated", { time: exactTime(completedAt) })}
                >
                  {dashboard.heroRelative}
                </time>
              </>
            )}
          </p>
          {responseDelta && (
            <p
              className={`delta ${rounded > 0 ? "delta-up" : rounded < 0 ? "delta-down" : ""}`}
              title={t("hero.deltaTitle", {
                median: num(responseDelta.median),
                turns: responseDelta.turns,
              })}
            >
              {rounded > 0 && <ArrowUp size={16} aria-hidden="true" />}
              {rounded < 0 && <ArrowDown size={16} aria-hidden="true" />}
              <span>
                {rounded === 0
                  ? t("hero.onPar")
                  : t("hero.vsMedian", { percent: signedPercent(responseDelta.percent) })}
              </span>
            </p>
          )}
          <p className="definition">
            <span title={grokHero ? t("metric.grokExplanation") : undefined}>
              {definition}
              {grokHero && ` ${grokNote}.`}
            </span>
            <InfoDisclosure label={t("hero.about")}>
              <strong>{t("hero.aria")}</strong> · {t("hero.explanationA")}
              {grokHero && (
                <>
                  <br />
                  {t("metric.grokExplanation")}
                </>
              )}
              <br />
              {t("hero.explanationB")}
            </InfoDisclosure>
          </p>
        </div>
      ) : (
        <div className="hero-meta">
          <p className="hero-empty">
            {dashboard.hasRecords ? t("hero.emptyWithRecords") : t("hero.empty")}
          </p>
        </div>
      )}
    </section>
  );
}
