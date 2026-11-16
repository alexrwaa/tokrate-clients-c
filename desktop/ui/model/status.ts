import { t } from "../i18n";
import type { Snapshot } from "../store/types";

export type Tone = "good" | "warn" | "muted" | "danger";

/** Footer text for monitoring: a calm dot unless something needs attention. */
export function monitoringState(snapshot: Snapshot): { label: string; tone: Tone } {
  if (!snapshot.settings.monitoring) return { label: t("status.paused"), tone: "muted" };
  const problem =
    /could not|unavailable|unreadable|in memory|rejected/i.test(snapshot.monitorStatus);
  return problem
    ? { label: t("status.monitoringAttention"), tone: "warn" }
    : { label: t("status.monitoring"), tone: "good" };
}

/** Same words as the Mac footer: Local only, Sharing on, Sharing needs attention, choice pending. */
export function sharingState(snapshot: Snapshot): { label: string; tone: Tone } {
  if (snapshot.consentPromptRequired)
    return { label: t("status.sharingPending"), tone: "muted" };
  if (!snapshot.settings.sharing) return { label: t("status.localOnly"), tone: "muted" };
  if (snapshot.status === "Sharing new turns" || snapshot.status.startsWith("Preview"))
    return { label: t("status.sharingOn"), tone: "good" };
  if (snapshot.status.startsWith("Opening"))
    return { label: t("status.startingSharing"), tone: "muted" };
  return { label: t("status.sharingAttention"), tone: "warn" };
}
