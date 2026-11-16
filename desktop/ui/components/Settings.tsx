import { useEffect, type ReactNode } from "react";
import { ArrowLeft, ArrowUpRight, Check, FolderOpen, Minus, RotateCcw } from "lucide-react";
import { useI18n, type Language } from "../i18n";
import { client } from "../metrics";
import { folderName, SOURCE_TITLES } from "../model/format";
import { SentExample } from "./SharingChoice";
import { useStore } from "../store/store";
import type { SourceId, SourceStatus } from "../store/types";
import { Chip, Disclosure, Segmented, StatusDot, Switch, useAppStore } from "./primitives";
import { UpdatesSection } from "./Updates";

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="card settings-section" id={id} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{title}</h2>
      {children}
    </section>
  );
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="switch-row">
      <div>
        <p className="switch-label" id={`${id}-label`}>
          {label}
        </p>
        {hint && (
          <p className="hint" id={`${id}-hint`}>
            {hint}
          </p>
        )}
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        label={label}
        describedBy={hint ? `${id}-hint` : undefined}
        disabled={disabled}
      />
    </div>
  );
}

function SourceRow({ source, turns }: { source: SourceStatus; turns: number }) {
  const { t } = useI18n();
  const store = useAppStore();
  const title = SOURCE_TITLES[source.id];
  return (
    <li className="source-row">
      <div className="source-main">
        <p className="source-name">
          <span>{title}</span>
          {source.found ? (
            <Chip tone="accent">
              <Check size={12} aria-hidden="true" /> {t("settings.found")}
            </Chip>
          ) : (
            <Chip>
              <Minus size={12} aria-hidden="true" /> {t("settings.notFound")}
            </Chip>
          )}
        </p>
        <p className="hint" title={source.root}>
          {source.isDefault ? t("settings.folderDefault") : t("settings.folderCustom")} ·{" "}
          {folderName(source.root)}
          {turns > 0 &&
            ` · ${t("settings.turnsIn7d", {
              count: turns,
              noun: t(turns === 1 ? "chart.turn" : "chart.turns"),
            })}`}
        </p>
      </div>
      <div className="source-actions">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-label={t("settings.chooseFolder", { tool: title })}
          onClick={() => void store.chooseFolder(source.id)}
        >
          <FolderOpen size={16} aria-hidden="true" />
          {t("settings.choose")}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          aria-label={t("settings.resetAria", { tool: title })}
          disabled={source.isDefault}
          onClick={() => void store.resetFolder(source.id)}
        >
          <RotateCcw size={16} aria-hidden="true" />
          {t("settings.reset")}
        </button>
      </div>
    </li>
  );
}

/** Language switch: two options, applied on the spot and remembered in the portable profile. */
function LanguageRow() {
  const { t, language, setLanguage } = useI18n();
  return (
    <div className="switch-row language-row">
      <div>
        <p className="switch-label">{t("settings.language")}</p>
        <p className="hint">{t("settings.languageHint")}</p>
      </div>
      <Segmented<Language>
        label={t("settings.language")}
        size="sm"
        value={language}
        onChange={(value) => setLanguage(value)}
        options={[
          { value: "zh-CN", label: t("settings.languageZh") },
          { value: "en-US", label: t("settings.languageEn") },
        ]}
      />
    </div>
  );
}

export function SettingsView() {
  const { t } = useI18n();
  const store = useAppStore();
  const snapshot = useStore(store, (s) => s.snapshot);
  const anchor = useStore(store, (s) => s.ui.settingsAnchor);
  const { settings } = snapshot;
  const sources = snapshot.sources ?? [];
  const turnsBy = (id: SourceId) =>
    snapshot.records.filter((m) => client(m) === id).length;

  useEffect(() => {
    if (!anchor) return;
    document.getElementById(anchor)?.scrollIntoView({ block: "start" });
    store.clearSettingsAnchor();
  }, [anchor, store]);

  return (
    <div className="settings-view">
      <header className="topbar topbar-settings">
        <button
          type="button"
          className="icon-button"
          aria-label={t("settings.back")}
          onClick={() => store.setView("home")}
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <h1>{t("settings.title")}</h1>
      </header>
      <div className="scroll">
        <Section id="settings-general" title={t("settings.general")}>
          <SwitchRow
            id="show-speed"
            label={t("settings.showSpeed")}
            hint={t("settings.showSpeedHint")}
            checked={settings.showSpeed}
            onChange={(showSpeed) => void store.patch({ showSpeed })}
          />
          <SwitchRow
            id="show-provider-badge"
            label={t("settings.showProviderBadge")}
            hint={t("settings.showProviderBadgeHint")}
            checked={settings.showProviderBadge}
            onChange={(showProviderBadge) => void store.patch({ showProviderBadge })}
          />
          <SwitchRow
            id="show-tool-chip"
            label={t("settings.showToolChip")}
            hint={t("settings.showToolChipHint")}
            checked={settings.showToolChip}
            onChange={(showToolChip) => void store.patch({ showToolChip })}
          />
          <SwitchRow
            id="monitoring"
            label={t("settings.monitoring")}
            hint={snapshot.monitorStatus}
            checked={settings.monitoring}
            onChange={(monitoring) => void store.patch({ monitoring })}
          />
          <p className="fine">{t("settings.monitoringHint")}</p>
        </Section>

        <Section id="settings-language" title={t("settings.languageSection")}>
          <LanguageRow />
        </Section>

        <Section id="settings-sharing" title={t("settings.sharing")}>
          <SwitchRow
            id="sharing"
            label={t("settings.shareCommunity")}
            hint={settings.sharing ? t("settings.sharingOn") : t("settings.sharingOff")}
            checked={settings.sharing}
            onChange={(enabled) => {
              if (enabled) store.setConsentSheet(true);
              else void store.disableSharing();
            }}
          />
          <p className="status-line" role="status">
            <StatusDot tone={settings.sharing ? "good" : "muted"} />
            <span>
              {snapshot.status}
              {snapshot.pending ? t("settings.queued", { count: snapshot.pending }) : ""}
            </span>
          </p>
          <div className="row-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={!settings.sharing}
              onClick={() => void store.retrySharing()}
            >
              {t("settings.retrySharing")}
            </button>
          </div>
          <SwitchRow
            id="error-notifications"
            label={t("settings.errorNotifications")}
            hint={
              settings.sharing
                ? t("settings.errorNotificationsOn")
                : t("settings.errorNotificationsOff")
            }
            checked={settings.errorNotifications}
            onChange={(errorNotifications) => void store.patch({ errorNotifications })}
            disabled={!settings.sharing}
          />
          <p className="fine">
            {t("settings.sharingFine")}{" "}
            {t("sharing.noticeRegion")} {t("sharing.noticeDelegated")} {t("sharing.noticeSurface")}{" "}
            {t("sharing.noticePromptCache")} {t("sharing.noticeRequestCount")}{" "}
            {t("sharing.noticeThrottled")} {t("sharing.noticeBlocked")}
          </p>
          <Disclosure label={t("settings.seeSent")}>
            <SentExample />
          </Disclosure>
        </Section>

        <Section id="settings-sources" title={t("settings.sources")}>
          <p className="hint">{t("settings.sourcesHint")}</p>
          <ul className="source-list">
            {sources.map((s) => (
              <SourceRow key={s.id} source={s} turns={turnsBy(s.id)} />
            ))}
          </ul>
        </Section>

        <Section id="settings-updates" title={t("settings.updates")}>
          <UpdatesSection />
        </Section>

        <Section id="settings-about" title={t("settings.about")}>
          <div className="link-list">
            <button type="button" className="link-row" onClick={() => store.openHistory()}>
              {t("settings.fullHistory")}
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="link-row"
              onClick={() => store.openWebsite("privacy")}
            >
              {t("settings.privacy")}
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
            <button type="button" className="link-row" onClick={() => store.openWebsite("terms")}>
              {t("settings.terms")}
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          </div>
          <p className="fine">{t("settings.aboutFine")}</p>
          <button type="button" className="btn btn-secondary quit" onClick={() => store.quit()}>
            {t("settings.quit")}
          </button>
        </Section>
      </div>
    </div>
  );
}
