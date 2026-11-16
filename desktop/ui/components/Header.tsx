import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Settings as SettingsIcon } from "lucide-react";
import { t, useI18n } from "../i18n";
import { client, clientLabel, toolChipStyle, toolLabel, type CohortRow } from "../metrics";
import { autoSelection, modelSelection } from "../response";
import type { Dashboard } from "../model/dashboard";
import { CLIENT_ORDER } from "../model/dashboard";
import { SOURCE_TITLES, PROVIDER_TITLES } from "../model/format";
import { cohortBaseTitle, recentModelRows, toolModelHint } from "../model/picker";
import { providerName, sortModelRows } from "../response";
import { useStore } from "../store/store";
import type { ProviderFilter, ToolFilter } from "../store/types";
import { Mark, ProviderBadge, Segmented, ToolChip, useAppStore, useDismiss } from "./primitives";

/** "Model · effort · Subagent · v1" on one line, as listed under More models. */
export function cohortMenuTitle(row: CohortRow) {
  return [cohortBaseTitle(row.sample), row.qualifier].filter(Boolean).join(" · ");
}

const selectedCohort = (dashboard: Dashboard) =>
  dashboard.mode.kind === "cohort"
    ? dashboard.cohorts.find((c) => c.key === dashboard.selectedKey)
    : undefined;

/** The coding tool the selection is bound to, shown as a chip beside the picker label. */
export function pickerTool(dashboard: Dashboard): string | null {
  const { mode } = dashboard;
  if (mode.kind === "auto") return mode.tool;
  const row = selectedCohort(dashboard);
  return row ? client(row.sample) : null;
}

const autoModelName = (dashboard: Dashboard) =>
  dashboard.activeKey ? (dashboard.activeKey.model ?? null) : null;

/** Picker button text; the coding tool is the chip beside it, see `pickerAccessibleLabel`. */
export function pickerLabel(dashboard: Dashboard) {
  const { mode } = dashboard;
  if (mode.kind === "all") return t("header.allModels");
  if (mode.kind === "auto") {
    const name = autoModelName(dashboard);
    return name
      ? t("header.autoWithModel", { model: name })
      : mode.tool
        ? t("header.auto")
        : t("header.autoMostActive");
  }
  if (mode.kind === "model") return mode.key.model ?? t("common.unknownModel");
  const row = selectedCohort(dashboard);
  return row ? cohortMenuTitle(row) : t("header.model");
}

/** Picker label for assistive tech, with the coding tool the chip stands for spelled out. */
export function pickerAccessibleLabel(dashboard: Dashboard) {
  const { mode } = dashboard;
  const tool = pickerTool(dashboard);
  if (mode.kind === "auto" && mode.tool)
    return [t("header.autoIn", { tool: toolLabel(mode.tool) }), autoModelName(dashboard)]
      .filter(Boolean)
      .join(" · ");
  return tool ? `${toolLabel(tool)} · ${pickerLabel(dashboard)}` : pickerLabel(dashboard);
}

/** Arrow keys visit every option and the More models toggle. */
const NAVIGABLE = "[role=option], .picker-more";

export function ModelPicker({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useI18n();
  const store = useAppStore();
  const selection = dashboard.selection;
  const toolFilter = useStore(store, (s) => s.ui.toolFilter);
  const providerFilter = useStore(store, (s) => s.ui.providerFilter);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root);

  useEffect(() => {
    if (!open) return;
    // Land on the selected option so arrow keys continue from where the user is.
    const selected = root.current?.querySelector<HTMLElement>("[role=option][aria-selected=true]");
    (selected ?? root.current?.querySelector<HTMLElement>(NAVIGABLE))?.focus({
      preventScroll: false,
    });
  }, [open]);

  const choose = (value: string) => {
    void store.selectCohort(value);
    setOpen(false);
    trigger.current?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const options = [...(root.current?.querySelectorAll<HTMLElement>(NAVIGABLE) ?? [])];
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (index < 0 && event.target !== trigger.current) return;
    event.preventDefault();
    const next =
      event.key === "ArrowDown"
        ? options[Math.min(options.length - 1, index + 1)]
        : options[Math.max(0, index - 1)];
    next?.focus();
  };

  const sections = CLIENT_ORDER.map((id) => ({
    id,
    rows: dashboard.cohorts.filter((c) => client(c.sample) === id),
  })).filter((s) => s.rows.length);
  const activeName = dashboard.activeKey?.model ?? null;
  const recent = recentModelRows(dashboard.cohorts);
  const isSelectedCohort = (row: CohortRow) =>
    dashboard.mode.kind === "cohort" && dashboard.selectedKey === row.key;
  // A selection that only exists under More models opens it, so the picker never hides it.
  const selectionInMore =
    dashboard.mode.kind === "model" ||
    (dashboard.mode.kind === "cohort" && !recent.some(({ row }) => isSelectedCohort(row)));
  const tool = pickerTool(dashboard);
  const toolOptions = [
    { value: "all" as ToolFilter, label: t("header.all") },
    ...CLIENT_ORDER.map((id) => ({
      value: id as ToolFilter,
      label: SOURCE_TITLES[id],
      toolStyle: toolChipStyle(id),
    })),
  ];

  return (
    <div
      className="picker"
      ref={root}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        // Tabbing out closes the popover; a null target (native select popup) keeps it open.
        const next = event.relatedTarget as Node | null;
        if (open && next && !root.current?.contains(next)) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("header.pickerAria", { label: pickerAccessibleLabel(dashboard) })}
        onClick={() => {
          if (!open) setMoreOpen(selectionInMore);
          setOpen(!open);
        }}
      >
        {dashboard.mode.kind !== "all" && dashboard.activeKey && (
          <ProviderBadge
            model={dashboard.activeKey.model}
            provider={dashboard.activeKey.provider}
            size={16}
          />
        )}
        {tool && <ToolChip tool={tool} />}
        <span className="picker-label">{pickerLabel(dashboard)}</span>
        <ChevronDown size={16} aria-hidden="true" className="chevron" />
      </button>
      {open && (
        <div className="popover picker-popover" role="dialog" aria-label={t("header.chooseModel")}>
          <div className="picker-filters">
            <Segmented
              label={t("header.codingTool")}
              className="tool-filter"
              size="sm"
              value={toolFilter}
              options={toolOptions}
              onChange={(v) => store.setToolFilter(v)}
            />
            <label className="picker-provider">
              <span>{t("header.providerRoute")}</span>
              <select
                value={providerFilter}
                onChange={(e) => store.setProviderFilter(e.target.value as ProviderFilter)}
              >
                <option value="all">{t("header.allRoutes")}</option>
                {Object.entries(PROVIDER_TITLES).map(([value, label]) => (
                  <option key={value} value={value}>
                    {value === "unknown" ? t("common.unknownRoute") : label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="picker-list" role="listbox" aria-label={t("header.models")}>
            <PickerOption
              selected={selection === autoSelection(null)}
              onSelect={() => choose(autoSelection(null))}
              title={t("header.autoMostActive")}
              hint={
                activeName && dashboard.mode.kind === "auto" && !dashboard.mode.tool
                  ? t("header.autoFollowsNow", { model: activeName })
                  : t("header.autoFollows")
              }
            />
            {dashboard.tools.length > 0 && (
              <div role="group" aria-label={t("header.autoWithinTool")}>
                <div className="picker-section">{t("header.autoWithinTool")}</div>
                {dashboard.tools.map((id) => (
                  <PickerOption
                    key={id}
                    selected={selection === autoSelection(id)}
                    onSelect={() => choose(autoSelection(id))}
                    tool={id}
                    title={SOURCE_TITLES[id]}
                    hint={toolModelHint(dashboard, id) ?? undefined}
                  />
                ))}
              </div>
            )}
            {recent.length > 0 && (
              <div role="group" aria-label={t("header.recentModels")}>
                <div className="picker-section">{t("header.recentModels")}</div>
                {recent.map(({ row, title }) => (
                  <PickerOption
                    key={row.key}
                    selected={isSelectedCohort(row)}
                    onSelect={() => choose(row.key)}
                    tool={client(row.sample)}
                    spokenTool
                    title={title}
                  />
                ))}
              </div>
            )}
            <PickerOption
              selected={selection === "all"}
              onSelect={() => choose("all")}
              title={t("header.allModels")}
              hint={t("header.compareEvery")}
            />
            <button
              type="button"
              className="picker-more"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen(!moreOpen)}
            >
              <span>{t("header.moreModels")}</span>
              <ChevronDown size={16} aria-hidden="true" className="chevron" />
            </button>
            {moreOpen && (
              <>
                {dashboard.modelRows.length > 0 && (
                  <div role="group" aria-label={t("header.pinModel")}>
                    <div className="picker-section">{t("header.pinModel")}</div>
                    {sortModelRows(dashboard.modelRows, "recent").map((row) => (
                      <PickerOption
                        key={row.key}
                        selected={selection === modelSelection(row.model)}
                        onSelect={() => choose(row.key)}
                        title={[
                          row.model.model ?? t("common.unknownModel"),
                          providerName(row.model.provider),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      />
                    ))}
                  </div>
                )}
                {sections.map((section) => (
                  <div key={section.id} role="group" aria-label={SOURCE_TITLES[section.id]}>
                    <div className="picker-section">
                      {t("header.exactCohorts", { tool: clientLabel(section.rows[0].sample) })}
                    </div>
                    {section.rows.map((row) => (
                      <PickerOption
                        key={row.key}
                        selected={isSelectedCohort(row)}
                        onSelect={() => choose(row.key)}
                        title={cohortMenuTitle(row)}
                      />
                    ))}
                  </div>
                ))}
              </>
            )}
            {!sections.length && <p className="picker-empty">{t("header.noModels")}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function PickerOption({
  selected,
  onSelect,
  title,
  hint,
  tool,
  spokenTool = false,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  hint?: string;
  /** Coding tool shown as a leading chip. */
  tool?: string;
  /** The chip is decorative: say the tool's name for assistive tech when the title lacks it. */
  spokenTool?: boolean;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className="picker-option"
      onClick={onSelect}
    >
      {tool && <ToolChip tool={tool} />}
      <span className="picker-option-text">
        {tool && spokenTool && <span className="visually-hidden">{toolLabel(tool)}, </span>}
        <span className="picker-option-title">{title}</span>
        {hint && <span className="picker-option-hint">{hint}</span>}
      </span>
      {selected && <Check size={16} aria-hidden="true" />}
    </button>
  );
}

export function Header({ dashboard }: { dashboard: Dashboard }) {
  const { t } = useI18n();
  const store = useAppStore();
  const view = useStore(store, (s) => s.ui.view);
  return (
    <header className="topbar">
      <div className="brand">
        <Mark size={28} />
        <span>Tokrate</span>
      </div>
      <ModelPicker dashboard={dashboard} />
      <button
        type="button"
        className="icon-button"
        aria-label={view === "settings" ? t("header.closeSettings") : t("header.openSettings")}
        aria-pressed={view === "settings"}
        title={t("header.settingsTitle")}
        onClick={() => store.setView(view === "settings" ? "home" : "settings")}
      >
        <SettingsIcon size={20} aria-hidden="true" />
      </button>
    </header>
  );
}
