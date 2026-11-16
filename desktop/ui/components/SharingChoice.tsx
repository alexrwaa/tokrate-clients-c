import { useEffect, useRef } from "react";
import { useI18n } from "../i18n";
import { useStore } from "../store/store";
import { Disclosure, useAppStore } from "./primitives";

/** From notice version 2: the server, not the app, derives a coarse region. */
export const REGION_NOTICE =
  "From version 0.1.14 the server derives your continent from the country of your connection when it receives a report (through Cloudflare). Only the continent is stored — not the country and not your IP address — and regions are shown publicly only with at least 3 contributors.";

/** From notice version 3: each turn also carries the output of the subagent work it started. */
export const DELEGATED_NOTICE =
  "From 0.1.16 each turn also includes the output tokens of subagent work it started (delegated output tokens), used for the efficiency indicator.";

/** From notice version 4: each turn also carries where the coding tool ran, as a category. */
export const SURFACE_NOTICE =
  "From 0.1.18 each turn also includes where the coding tool ran, as a category (command line, desktop app, editor extension, SDK or automation, other), never the app's own name.";

/** Under the same notice version 4: each turn also carries its input and prompt-cache token counts. */
export const PROMPT_CACHE_NOTICE =
  "From 0.1.18 each turn also includes its input token count and how many of those tokens were read from or written to the provider's prompt cache.";

/**
 * From notice version 5: sharing also counts, per model and five-minute period, the requests that
 * succeeded and those that failed on the provider's side.
 */
export const REQUEST_COUNT_NOTICE =
  "From 0.1.22 sharing also counts, per model and five-minute period, how many requests succeeded and how many failed because the provider was overloaded or had a server error (Claude Code, Codex, OpenCode and Kimi Code). From 0.1.25, T3 Code adds these counts for its Codex and Claude Code observations; its Antigravity observations do not report request outcomes. Only the counts are sent, never error messages.";

/** From notice version 6: the request counts also include throttled requests. */
export const THROTTLED_NOTICE =
  "From 0.1.24 the request counts also include requests the provider rejected as too many while your plan still had quota left (throttled). Your plan usage itself is never sent.";

/** From notice version 7: complete request-level input usage is sent as coarse size bands. */
export const PROMPT_SIZE_NOTICE =
  "From 0.1.30, when every model request in a turn has usable input counts, sharing includes a six-band summary of per-request input size (including cached input). It sends only band counts and token totals, not prompts. If any request usage is missing or inconsistent, that turn has no size summary; unavailable usage is not reported as zero.";

/** From notice version 8: the request counts also include requests the provider's firewall blocked. */
export const BLOCKED_NOTICE =
  "From 0.1.31 the request counts also include requests the provider’s network firewall blocked before they reached the model (blocked). Only the count is sent, never the error page.";

/** What every shared turn contains, in the wording of the Mac notice. */
export const SENT_FIELDS = [
  "Coding tool, and app, parser and metric versions",
  "Model, provider (for Claude on Amazon Bedrock, its inference-profile region) and effort",
  "Source kind (primary, subagent or unknown)",
  "Token counts and turn duration",
  "Per-request input size bands and token totals, when complete",
  "Output tokens of subagent work a turn started",
  "Where the tool ran, as a category",
  "Response timing within the turn",
  "First-token time, when available",
  "Time rounded to 5 minutes",
  "A random ID for each sample",
];

const FIELD_KEYS = [
  "sharing.field1",
  "sharing.field2",
  "sharing.field3",
  "sharing.field4",
  "sharing.field5",
  "sharing.field6",
  "sharing.field7",
  "sharing.field8",
  "sharing.field9",
  "sharing.field10",
  "sharing.field11",
];

const NOTICE_KEYS = [
  "sharing.noticeRegion",
  "sharing.noticeDelegated",
  "sharing.noticeSurface",
  "sharing.noticePromptCache",
  "sharing.noticeRequestCount",
  "sharing.noticeThrottled",
  "sharing.noticePromptSize",
  "sharing.noticeBlocked",
];

/** Explains the example's fields, what the model name is, and how precisely the time is sent. */
export const FIELD_DESCRIPTION =
  "Region is derived by the server, not sent by the app. The Amazon Bedrock region (providerRegion) is the one the model id itself names and is null for every other route. Model names are sent as your coding tool reports them, so a custom deployment name is shared as is; a name with unusual characters is sent as “unknown”. Uploads are grouped after each five-minute period closes, with a one-minute wait and up to one extra minute of random delay shared by the group. Completed turns normally arrive about 1–7 minutes later; offline or unusually delayed collection can take longer. The completion time remains rounded to five minutes.";

/**
 * The example upload with obviously fake values, as the shell prints it from the serializer that
 * builds real requests (`example_request_json` in core/src/sharing.rs), so it cannot drift.
 */
export function SentExample() {
  const { t } = useI18n();
  const store = useAppStore();
  const { text, failed } = useStore(store, (s) => s.sentExample);
  return (
    <pre className="payload" tabIndex={0} aria-label={t("sharing.exampleAria")}>
      {text ?? (failed ? t("sharing.exampleError") : t("sharing.exampleLoading"))}
    </pre>
  );
}

/**
 * The sharing decision, used as onboarding step two and as the sheet opened from Settings.
 * Both buttons carry equal weight; nothing is stored, no credential store is opened and no request
 * is made until one is chosen. Polling never moves focus: only the heading is focused, once.
 */
export function SharingChoice({
  headingId,
  fromOnboarding,
}: {
  headingId: string;
  fromOnboarding: boolean;
}) {
  const { t } = useI18n();
  const store = useAppStore();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <div className="choice">
      <h1 id={headingId} tabIndex={-1} ref={heading}>
        {t("sharing.title")}
      </h1>
      <p className="lede">{t("sharing.lede")}</p>
      <p className="lede" id={`${headingId}-description`}>
        {t("sharing.lede2")}
      </p>
      <div className="share-lists">
        <div>
          <h2>{t("sharing.sentFor")}</h2>
          <ul>
            {FIELD_KEYS.map((key) => (
              <li key={key}>{t(key)}</li>
            ))}
          </ul>
        </div>
        <div>
          <h2>{t("sharing.neverSent")}</h2>
          <ul>
            <li>{t("sharing.prompts")}</li>
            <li>{t("sharing.code")}</li>
            <li>{t("sharing.paths")}</li>
            <li>{t("sharing.account")}</li>
          </ul>
        </div>
      </div>
      {NOTICE_KEYS.map((key) => (
        <p className="detail-fine region-notice" key={key}>
          {t(key)}
        </p>
      ))}
      <Disclosure label={t("sharing.seeSent")}>
        <div className="details">
          <p className="detail-fine">{t("sharing.exampleIntro")}</p>
          <SentExample />
          <p className="detail-fine">{t("sharing.fieldDescription")}</p>
          <p className="detail-fine">{t("sharing.signingKey")}</p>
          <p className="detail-fine">{t("sharing.acceptNote")}</p>
          <p className="detail-fine links">
            <button type="button" className="inline-link" onClick={() => store.openWebsite("privacy")}>
              {t("sharing.privacyNotice")}
            </button>
            <button type="button" className="inline-link" onClick={() => store.openWebsite("terms")}>
              {t("sharing.terms")}
            </button>
          </p>
        </div>
      </Disclosure>
      <ChoiceError />
      <div className="choice-actions">
        <button
          type="button"
          id="accept-sharing"
          className="btn btn-choice"
          onClick={() => void store.recordSharingChoice(true, fromOnboarding)}
        >
          {t("sharing.accept")}
        </button>
        <button
          type="button"
          id="decline-sharing"
          className="btn btn-choice"
          onClick={() => void store.recordSharingChoice(false, fromOnboarding)}
        >
          {t("sharing.decline")}
        </button>
      </div>
    </div>
  );
}

function ChoiceError() {
  const store = useAppStore();
  const error = useStore(store, (s) => s.error);
  return error ? (
    <p role="alert" className="banner banner-danger">
      {error}
    </p>
  ) : null;
}
