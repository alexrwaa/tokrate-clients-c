import { ArrowUpRight } from "lucide-react";
import { useI18n } from "../i18n";
import { useStore } from "../store/store";
import { useAppStore } from "./primitives";

/** Update controls inside Settings. Checks never install; installing always needs a click. */
export function UpdatesSection() {
  const { t } = useI18n();
  const store = useAppStore();
  const update = useStore(store, (s) => s.update);
  const smoke = useStore(store, (s) => s.snapshot.smoke);
  const { preferences: prefs, available } = update;
  const mode = prefs?.mode ?? "unavailable";
  const progress =
    update.progress.total > 0
      ? Math.min(100, Math.round((update.progress.downloaded / update.progress.total) * 100))
      : null;
  const modeMessage =
    mode === "manual"
      ? t("updates.modeManual")
      : mode === "unavailable"
        ? t("updates.portable")
        : t("updates.modeNative");
  return (
    <div className="updates">
      <p>
        {t("updates.installed", { version: prefs?.currentVersion ?? t("updates.unknown") })}{" "}
        {update.status}
      </p>
      {prefs?.settingsWarning && (
        <p role="alert" className="banner banner-danger">
          {prefs.settingsWarning}
        </p>
      )}
      {(mode === "native" || mode === "manual") && !smoke && (
        <div className="switch-row">
          <p className="switch-label" id="auto-updates-label">
            {t("updates.autoLabel")}
          </p>
          <button
            type="button"
            role="switch"
            className="switch"
            aria-checked={prefs?.automaticChecks ?? false}
            aria-labelledby="auto-updates-label"
            onClick={() => void store.setAutomaticUpdateChecks(!prefs?.automaticChecks)}
          >
            <span className="switch-thumb" />
          </button>
        </div>
      )}
      {update.checkInFlight && <p role="status">{t("updates.checking")}</p>}
      {update.installInFlight &&
        (progress === null ? (
          <>
            <progress aria-label={t("updates.progressAria")} />
            <p className="hint">{t("updates.downloading")}</p>
          </>
        ) : (
          <>
            <progress aria-label={t("updates.progressAria")} max={100} value={progress}>
              {progress}%
            </progress>
            <p className="hint">{t("updates.percent", { percent: progress })}</p>
          </>
        ))}
      {available && (
        <div className="update-available" role="status">
          <p>
            <strong>{t("updates.available", { version: available.version })}</strong>
            {available.body ? ` ${available.body.slice(0, 400)}` : ""}
          </p>
          {mode === "manual" ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => store.openWebsite("desktop-downloads")}
            >
              {t("updates.download")}
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          ) : mode === "native" ? (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={update.installInFlight}
              onClick={() => void store.installAvailableUpdate()}
            >
              {update.installInFlight ? t("updates.installing") : t("updates.install")}
            </button>
          ) : null}
        </div>
      )}
      <p className="fine">{modeMessage}</p>
      {(mode === "native" || mode === "manual") && !smoke && (
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={update.checkInFlight || update.installInFlight}
            onClick={() => void store.checkForUpdates(false)}
          >
            {t("updates.check")}
          </button>
        </div>
      )}
      {mode !== "native" && !smoke && (
        <div className="row-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => store.openWebsite("desktop-downloads")}
          >
            {t("updates.openDownloads")}
            <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Compact banner above the dashboard when an update has been found. */
export function UpdateBanner() {
  const { t } = useI18n();
  const store = useAppStore();
  const update = useStore(store, (s) => s.update);
  if (!update.available || update.preferences?.mode === "unavailable") return null;
  const manual = update.preferences?.mode === "manual";
  return (
    <section className="banner banner-accent update-banner" role="status">
      <div>
        <strong>{t("updates.available", { version: update.available.version })}</strong>
        <span>{manual ? t("updates.bannerManual") : t("updates.bannerNative")}</span>
      </div>
      <div className="banner-actions">
        {manual ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => store.openWebsite("desktop-downloads")}
          >
            {t("updates.download")}
            <ArrowUpRight size={16} aria-hidden="true" />
          </button>
        ) : update.preferences?.mode === "native" ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={update.installInFlight}
            onClick={() => void store.installAvailableUpdate()}
          >
            {update.installInFlight ? t("updates.installingShort") : t("updates.installUpdate")}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => store.openSettings("settings-updates")}
        >
          {t("updates.details")}
        </button>
      </div>
    </section>
  );
}
