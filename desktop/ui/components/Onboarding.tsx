import { useEffect, useRef, type ReactNode } from "react";
import { Check, Minus } from "lucide-react";
import { useI18n } from "../i18n";
import { SOURCE_TITLES } from "../model/format";
import { useStore } from "../store/store";
import type { SourceStatus } from "../store/types";
import { Mark, useAppStore } from "./primitives";
import { SharingChoice } from "./SharingChoice";

const STEP_TITLE_KEYS = [
  "onboarding.stepWelcome",
  "onboarding.stepSharing",
  "onboarding.stepFinish",
];

function Steps({ step }: { step: number }) {
  const { t } = useI18n();
  const titles = STEP_TITLE_KEYS.map((key) => t(key));
  return (
    <ol
      className="steps"
      aria-label={t("onboarding.stepAria", { step: step + 1, title: titles[step] })}
    >
      {titles.map((title, i) => (
        <li key={title} data-state={i === step ? "current" : i < step ? "done" : "todo"} aria-current={i === step ? "step" : undefined}>
          <span className="visually-hidden">{title}</span>
        </li>
      ))}
    </ol>
  );
}

function Step({ children }: { children: ReactNode }) {
  return <div className="onboarding-step">{children}</div>;
}

function SourceStatusRow({ source }: { source: SourceStatus }) {
  const { t } = useI18n();
  return (
    <li className="detected" data-found={source.found}>
      <span className="detected-icon" aria-hidden="true">
        {source.found ? <Check size={16} /> : <Minus size={16} />}
      </span>
      <span className="detected-name">{SOURCE_TITLES[source.id]}</span>
      <span className="detected-state">{source.found ? t("onboarding.found") : t("onboarding.notFound")}</span>
    </li>
  );
}

function Welcome() {
  const { t } = useI18n();
  const store = useAppStore();
  const sources = useStore(store, (s) => s.snapshot.sources) ?? [];
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  const found = sources.filter((s) => s.found).length;
  return (
    <Step>
      <div className="welcome-mark">
        <Mark size={56} />
      </div>
      <h1 id="onboarding-welcome" tabIndex={-1} ref={heading}>
        {t("onboarding.welcomeTitle")}
      </h1>
      <p className="lede">{t("onboarding.welcomeLede")}</p>
      <h2 className="eyebrow">{t("onboarding.detected")}</h2>
      <ul className="detected-list">
        {sources.map((s) => (
          <SourceStatusRow key={s.id} source={s} />
        ))}
      </ul>
      <p className="hint">
        {sources.length && found === 0 ? t("onboarding.noFolders") : t("onboarding.missingTool")}
      </p>
      <div className="onboarding-actions">
        <button type="button" className="btn btn-primary" onClick={() => store.setOnboardingStep(1)}>
          {t("onboarding.continue")}
        </button>
      </div>
    </Step>
  );
}

function Finish() {
  const { t } = useI18n();
  const store = useAppStore();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus({ preventScroll: true }), []);
  return (
    <Step>
      <div className="tray-art" aria-hidden="true">
        <svg viewBox="0 0 280 64" width="100%">
          <rect x="1" y="1" width="278" height="62" rx="12" className="tray-art-bar" />
          <circle cx="92" cy="32" r="3" className="tray-art-dot" />
          <circle cx="112" cy="32" r="3" className="tray-art-dot" />
          <circle cx="132" cy="32" r="3" className="tray-art-dot" />
          <circle cx="248" cy="32" r="3" className="tray-art-dot" />
          <rect x="170" y="10" width="44" height="44" rx="11" className="tray-art-focus" />
          <g transform="translate(176 16) scale(0.667)">
            <rect width="48" height="48" rx="12" fill="#0B2530" />
            <path d="M11.9 33A14 14 0 1 1 36.1 33" fill="none" stroke="#3CCFB4" strokeWidth="4" strokeLinecap="round" />
            <path d="M24 26 31.1 18.9" stroke="#FF6B4A" strokeWidth="3.5" strokeLinecap="round" />
            <circle cx="24" cy="26" r="2.8" fill="#FF6B4A" />
          </g>
          <circle cx="228" cy="32" r="3" className="tray-art-dot" />
        </svg>
      </div>
      <h1 id="onboarding-finish" tabIndex={-1} ref={heading}>
        {t("onboarding.finishTitle")}
      </h1>
      <p className="lede">{t("onboarding.finishLede")}</p>
      <p className="hint">{t("onboarding.finishHint")}</p>
      <div className="onboarding-actions">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            store.setOnboardingStep(0);
            store.hideFlyout();
          }}
        >
          {t("onboarding.done")}
        </button>
      </div>
    </Step>
  );
}

/** First launch: welcome with detected sources, the sharing choice, and where to find Tokrate. */
export function Onboarding() {
  const { t } = useI18n();
  const store = useAppStore();
  const step = useStore(store, (s) => s.ui.onboardingStep);
  return (
    <div className="onboarding">
      <div className="onboarding-top">
        <Steps step={step} />
      </div>
      <div className="scroll onboarding-scroll">
        {step === 0 && <Welcome />}
        {step === 1 && (
          <Step>
            <SharingChoice headingId="onboarding-sharing" fromOnboarding />
            <div className="onboarding-back">
              <button type="button" className="text-button" onClick={() => store.setOnboardingStep(0)}>
                {t("onboarding.back")}
              </button>
            </div>
          </Step>
        )}
        {step === 2 && <Finish />}
      </div>
    </div>
  );
}
