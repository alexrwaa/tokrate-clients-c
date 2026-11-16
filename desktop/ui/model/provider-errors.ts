import { t } from "../i18n";
import { DAY, relativeTime } from "../metrics";
import type {
  Board,
  ErrorRecovery,
  ProviderErrorGroup,
  RelevantErrorAlert,
} from "../store/types";

/** Other groups named after the main one, "Also: {model} ({n})". */
const MAX_ALSO = 2;

const times = (count: number) =>
  t(count === 1 ? "providerErrors.time" : "providerErrors.times");
const requests = (count: number) => t(count === 1 ? "count.request" : "count.requests", { n: "" }).trim();
const serverErrors = (count: number) => t(count === 1 ? "count.error" : "count.errors", { n: "" }).trim();

/** The sentence for the main group (contract "Local provider errors", "Provider throttling" and "Provider edge blocks"). */
function groupText(group: ProviderErrorGroup, ago: string): string {
  switch (group.kind) {
    case "overloaded":
      return t("providerErrors.overloaded", {
        kind:
          group.client === "codex"
            ? t("providerErrors.kindCapacity")
            : t("providerErrors.kindOverloaded"),
        count: group.count,
        times: times(group.count),
        model: group.model,
        ago,
      });
    case "throttled":
      return group.planUsedPercent === undefined
        ? t("providerErrors.throttled", {
            count: group.count,
            times: times(group.count),
            model: group.model,
          })
        : t("providerErrors.throttledUsed", {
            count: group.count,
            times: times(group.count),
            model: group.model,
            percent: group.planUsedPercent,
          });
    case "blocked":
      return t("providerErrors.blocked", {
        count: group.count,
        requests: requests(group.count),
        model: group.model,
        ago,
      });
    case "serverError":
      return t("providerErrors.serverError", {
        count: group.count,
        errors: serverErrors(group.count),
        model: group.model,
        ago,
      });
  }
}

/**
 * The passive line about the user's own provider-side failures (contract "Local provider errors
 * (0.1.23)", throttling from 0.1.24, blocks from 0.1.31), or null when no failure happened in the last 24 hours. The
 * main group is the one with the most recent failure; models are named as the tools report them.
 */
export function providerErrorLine(
  groups: readonly ProviderErrorGroup[] | undefined,
  now: number,
): string | null {
  const recent = (groups ?? [])
    .map((group) => ({ group, at: Date.parse(group.latestAt) }))
    .filter(({ at }) => Number.isFinite(at) && now - at <= DAY)
    .sort((a, b) => b.at - a.at);
  const main = recent[0];
  if (!main) return null;
  const { group, at } = main;
  const ago = relativeTime(at, now);
  const line = groupText(group, ago);
  const also = recent
    .slice(1, 1 + MAX_ALSO)
    .map(({ group: other }) => `${other.model} (${other.count})`);
  return also.length ? line + t("providerErrors.also", { list: also.join(", ") }) : line;
}

/** How long the "no longer report" line stays. */
export const RECOVERY_MS = 30 * 60_000;

export const NO_RECOVERY: ErrorRecovery = { shown: [], cleared: [] };

export interface CommunityErrorInput {
  /**
   * The community alerts that concern the user, most relevant first, as the native shell selects
   * them (also for the notifications); ignored while sharing is off.
   */
  relevant: readonly RelevantErrorAlert[] | undefined;
  sharing: boolean;
  now: number;
}

export interface CommunityErrorLine {
  kind: "alert" | "recovery";
  text: string;
  /** The models the line names (alert lines only). */
  models: string[];
}

const contributors = (n: number) => t(n === 1 ? "count.contributor" : "count.contributors", { n });

/** The alert's form for the user, after the contract's "The community line". */
function alertText(alert: RelevantErrorAlert, now: number): string {
  if (alert.notJustYou)
    return t("providerErrors.notJustYou", {
      count: alert.others,
      contributors: t(alert.others === 1 ? "count.contributor" : "count.contributors", {
        n: "",
      }).trim(),
      model: alert.model,
    });
  const parts = [
    alert.overloaded > 0
      ? t("providerErrors.partOverloaded", { count: alert.overloaded })
      : null,
    alert.serverError > 0
      ? t("providerErrors.partServer", {
          count: alert.serverError,
          errors: serverErrors(alert.serverError),
        })
      : null,
    alert.throttled > 0
      ? t("providerErrors.partThrottled", { count: alert.throttled })
      : null,
    alert.blocked > 0 ? t("providerErrors.partBlocked", { count: alert.blocked }) : null,
  ].filter((part) => part !== null);
  const separator = t("providerErrors.separator");
  const counts =
    parts.length > 1
      ? t("providerErrors.joinTwo", {
          first: parts.slice(0, -1).join(separator),
          last: parts.at(-1) ?? "",
        })
      : parts[0];
  return t("providerErrors.alert", {
    model: alert.model,
    counts,
    contributors: contributors(alert.failingContributors),
    ago: relativeTime(Date.parse(alert.lastFailureAt), now),
  });
}

/**
 * The community alert line (contract "Community error alerts (0.1.23)"), or null when sharing is
 * off or no alert concerns the user. It words the most relevant alert and names up to two more
 * models; which alerts concern the user is decided by the native shell.
 */
export function communityAlertLine({
  relevant,
  sharing,
  now,
}: CommunityErrorInput): CommunityErrorLine | null {
  const main = sharing ? relevant?.[0] : undefined;
  if (!main) return null;
  const also = [...new Set((relevant ?? []).slice(1).map((alert) => alert.model))]
    .filter((model) => model !== main.model)
    .slice(0, MAX_ALSO);
  const line = alertText(main, now);
  return {
    kind: "alert",
    text: also.length ? line + t("providerErrors.also", { list: also.join(", ") }) : line,
    models: [main.model, ...also],
  };
}

/**
 * The line under the local one: the alert line, else for 30 minutes the recovery of the model
 * that cleared last. Null when neither applies.
 */
export function communityErrorLine(
  input: CommunityErrorInput,
  recovery: ErrorRecovery,
): CommunityErrorLine | null {
  const alert = communityAlertLine(input);
  if (alert || !input.sharing) return alert;
  const cleared = recovery.cleared
    .filter(({ at }) => input.now - at < RECOVERY_MS)
    .sort((a, b) => b.at - a.at)[0];
  return cleared
    ? {
        kind: "recovery",
        text: t("providerErrors.recovery", {
          model: cleared.model,
          ago: relativeTime(cleared.at, input.now),
        }),
        models: [],
      }
    : null;
}

/** The muted hint after the local line while sharing is off. */
export const SHARING_HINT = "Turn on sharing to see whether other contributors hit the same errors.";

/**
 * Follows the board across polls. A model whose alert line was shown and that is no longer among
 * the board's alerts is cleared at `now`; sharing off forgets everything, and a poll without a
 * board (unreachable server) learns nothing.
 */
export function advanceRecovery(
  previous: ErrorRecovery,
  board: Pick<Board, "errors"> | null,
  input: CommunityErrorInput,
): ErrorRecovery {
  if (!input.sharing)
    return previous.shown.length || previous.cleared.length ? NO_RECOVERY : previous;
  if (!board) return previous;
  const present = new Set((board.errors?.alerts ?? []).map((a) => a.model));
  const gone = previous.shown.filter((model) => !present.has(model));
  const cleared = [
    ...previous.cleared.filter(
      ({ model, at }) => !present.has(model) && input.now - at < RECOVERY_MS,
    ),
    ...gone.map((model) => ({ model, at: input.now })),
  ];
  const shown = [
    ...new Set([
      ...previous.shown.filter((model) => present.has(model)),
      ...(communityAlertLine(input)?.models ?? []),
    ]),
  ];
  const same =
    shown.length === previous.shown.length &&
    shown.every((model, i) => model === previous.shown[i]) &&
    cleared.length === previous.cleared.length &&
    cleared.every((entry, i) => entry.model === previous.cleared[i]?.model && entry.at === previous.cleared[i]?.at);
  return same ? previous : { shown, cleared };
}
