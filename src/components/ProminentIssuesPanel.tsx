import { useMemo, useState } from "react";
import type { RatingRow, TagStatRow } from "../parsing";
import { getTagDescriptionOrDefault, getTagRemediation } from "../tagDefinitions";
import { tarsSidUrl } from "../tars";

const SKIP_TAGS = new Set(["Error"]);

type ModelId = "haiku" | "sonnet" | "gpt-mini" | "gpt-4o";

const MODELS: {
  id: ModelId;
  label: string;
  inPerM: number;
  outPerM: number;
}[] = [
  { id: "haiku", label: "Claude Haiku", inPerM: 0.8, outPerM: 4 },
  { id: "sonnet", label: "Claude Sonnet", inPerM: 3, outPerM: 15 },
  { id: "gpt-mini", label: "GPT-4o mini", inPerM: 0.15, outPerM: 0.6 },
  { id: "gpt-4o", label: "GPT-4o", inPerM: 2.5, outPerM: 10 },
];

/** Rough tokens per conversation turn (user + assistant) when the agent reads a transcript. */
const TOKENS_PER_TURN = 220;
const OUT_TOKENS_PER_SESSION = 350;
const OUT_TOKENS_ROLLOUT = 600;

type ProminentIssuesPanelProps = {
  issueStats: TagStatRow[];
  sessions: RatingRow[];
  rangeLabel: string;
  poolLabel: string;
};

function sampleSessionsForTag(rows: RatingRow[], tag: string, limit: number): RatingRow[] {
  const matching = rows.filter((r) => r.qaTags.includes(tag) && r.chatbot_sid?.trim());
  if (matching.length <= limit) return matching;
  const step = matching.length / limit;
  const out: RatingRow[] = [];
  for (let i = 0; i < limit; i++) out.push(matching[Math.floor(i * step)]!);
  return out;
}

function usd(n: number): string {
  if (n < 0.01) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

export function ProminentIssuesPanel({
  issueStats,
  sessions,
  rangeLabel,
  poolLabel,
}: ProminentIssuesPanelProps) {
  const issues = useMemo(
    () => issueStats.filter((r) => !SKIP_TAGS.has(r.tag)).slice(0, 8),
    [issueStats]
  );

  const [focusTag, setFocusTag] = useState<string | null>(null);
  const [sampleN, setSampleN] = useState(20);
  const [modelId, setModelId] = useState<ModelId>("haiku");
  const [copied, setCopied] = useState(false);

  const activeTag = focusTag && issues.some((i) => i.tag === focusTag) ? focusTag : issues[0]?.tag ?? null;

  const sample = useMemo(() => {
    if (!activeTag) return [];
    return sampleSessionsForTag(sessions, activeTag, sampleN);
  }, [sessions, activeTag, sampleN]);

  const avgTurns = useMemo(() => {
    const turns = sample
      .map((r) => r.num_turns)
      .filter((n): n is number => n != null && n > 0);
    if (turns.length) return turns.reduce((a, b) => a + b, 0) / turns.length;
    const all = sessions
      .map((r) => r.num_turns)
      .filter((n): n is number => n != null && n > 0);
    return all.length ? all.reduce((a, b) => a + b, 0) / all.length : 8;
  }, [sample, sessions]);

  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0];
  const n = sample.length;
  const inputTokens = n * avgTurns * TOKENS_PER_TURN;
  const outputTokens = n * OUT_TOKENS_PER_SESSION + OUT_TOKENS_ROLLOUT;
  const cost =
    (inputTokens / 1_000_000) * model.inPerM + (outputTokens / 1_000_000) * model.outPerM;

  const matchingCount = activeTag
    ? sessions.filter((r) => r.qaTags.includes(activeTag)).length
    : 0;

  const maxSample = Math.max(5, Math.min(40, matchingCount || 20));

  const agentPrompt = useMemo(() => {
    if (!activeTag) return "";
    const links = sample
      .map((r) => `- ${r.chatbot_sid} · score ${r.overall_score.toFixed(2)} · ${tarsSidUrl(r.chatbot_sid!)}`)
      .join("\n");
    return `You are reviewing Flexi chatbot conversations for CK-12.

Selected timeline: ${rangeLabel}
Pool: ${poolLabel}
Focus issue tag: ${activeTag}
What it means: ${getTagDescriptionOrDefault(activeTag, "qa")}
How to sort it out: ${getTagRemediation(activeTag)}

Open each TARS link, read the conversation, and for each SID report:
1. Confirm or reject the tag (true positive / false positive)
2. Root cause (prompt, retrieval, vision, slotfill routing, latency, missing feature)
3. A concrete product/prompt fix
Then summarize patterns across the sample (top 3 fixes, ranked).

Sessions (${sample.length} of ${matchingCount} tagged):
${links || "(session rows for this range are still loading)"}`;
  }, [activeTag, sample, rangeLabel, poolLabel, matchingCount]);

  const copyPrompt = async () => {
    if (!agentPrompt) return;
    try {
      await navigator.clipboard.writeText(agentPrompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  if (!issues.length) {
    return (
      <div className="chart-card full-width prominent-issues-card">
        <h2>
          Prominent issues
          <span className="sub">{rangeLabel}</span>
        </h2>
        <p className="muted-inline">No issue tags in the selected timeline.</p>
      </div>
    );
  }

  return (
    <div className="chart-card full-width prominent-issues-card">
      <h2>
        Prominent issues
        <span className="sub">
          {rangeLabel} · {poolLabel} · pick a tag for agent sample + cost
        </span>
      </h2>

      <div className="prominent-issues-grid">
        <div className="prominent-issues-list">
          {issues.map((row) => (
            <button
              key={row.tag}
              type="button"
              className={`prominent-issue-row ${activeTag === row.tag ? "active" : ""}`}
              onClick={() => setFocusTag(row.tag)}
            >
              <span className="prominent-issue-name">{row.tag}</span>
              <span className="prominent-issue-meta">
                {row.count.toLocaleString()} · {row.pctOfPool.toFixed(1)}%
              </span>
              <p className="prominent-issue-fix">{getTagRemediation(row.tag)}</p>
            </button>
          ))}
        </div>

        <div className="prominent-issues-agent">
          <h3 className="prominent-agent-title">Review agent</h3>
          <p className="muted-inline">
            This dashboard cannot open TARS transcripts (CK-12 login). Copy the brief and run it in Cursor
            or another agent that can open the links. Cost is an estimate for reading those transcripts
            with the selected model — not a live API call.
          </p>

          {activeTag ? (
            <>
              <p className="prominent-agent-focus">
                <strong>{activeTag}</strong>
                {matchingCount
                  ? ` · ${matchingCount.toLocaleString()} loaded sessions tagged`
                  : " · load session rows for this range to sample SIDs"}
              </p>
              <p className="prominent-issue-fix">{getTagRemediation(activeTag)}</p>

              <label className="prominent-agent-field">
                Sample size
                <input
                  type="range"
                  min={5}
                  max={maxSample}
                  step={1}
                  value={Math.min(sampleN, maxSample)}
                  onChange={(e) => setSampleN(Number(e.target.value))}
                />
                <span>{Math.min(sampleN, maxSample)} sessions</span>
              </label>

              <label className="prominent-agent-field">
                Model (list prices, USD / 1M tokens)
                <select
                  value={modelId}
                  onChange={(e) => setModelId(e.target.value as ModelId)}
                >
                  {MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label} · in ${m.inPerM} / out ${m.outPerM}
                    </option>
                  ))}
                </select>
              </label>

              <div className="prominent-cost">
                <div>
                  <span className="prominent-cost-value">{usd(cost)}</span>
                  <span className="prominent-cost-label">estimated query cost</span>
                </div>
                <p className="muted-inline">
                  ~{Math.round(inputTokens).toLocaleString()} input tokens (
                  {n} × {avgTurns.toFixed(1)} turns × {TOKENS_PER_TURN}) +{" "}
                  {Math.round(outputTokens).toLocaleString()} output tokens. Not including TARS fetch
                  or your agent overhead.
                </p>
              </div>

              <div className="prominent-agent-actions">
                <button type="button" className="btn-primary" onClick={copyPrompt} disabled={!sample.length}>
                  {copied ? "Copied" : "Copy agent brief + TARS links"}
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
