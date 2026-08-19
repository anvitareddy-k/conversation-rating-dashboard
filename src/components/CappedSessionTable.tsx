import { useMemo, useState } from "react";
import type { RatingRow } from "../parsing";
import { formatSessionTime } from "../parsing";
import { LABELS } from "../labels";
import { tarsSidUrl } from "../tars";

const PAGE = 100;

type SessionTableProps = {
  rows: RatingRow[];
  qaSelected: string[];
  categorySelected: string[];
  onToggleQa: (tag: string) => void;
  onToggleCategory: (tag: string) => void;
};

export function CappedSessionTable({
  rows,
  qaSelected,
  categorySelected,
  onToggleQa,
  onToggleCategory,
}: SessionTableProps) {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE);

  const sorted = useMemo(() => {
    if (!open) return [];
    return [...rows].sort((a, b) => a.overall_score - b.overall_score);
  }, [rows, open]);

  const visible = sorted.slice(0, shown);

  return (
    <details
      className="collapse-table-drawer session-drawer"
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary>
        Session list ({rows.length.toLocaleString()}) — click chips above to filter
      </summary>
      {open ? (
        <div style={{ overflowX: "auto", maxHeight: 420, overflowY: "auto" }}>
          <table className="tag-table session-table">
            <thead>
              <tr>
                <th>Chatbot SID</th>
                <th>Score</th>
                <th>Axes</th>
                <th>{LABELS.tags}</th>
                <th>{LABELS.categories}</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.chatbot_sid || `${r.time}-${r.overall_score}`}>
                  <td className="mono">
                    {r.chatbot_sid ? (
                      <a href={tarsSidUrl(r.chatbot_sid)} target="_blank" rel="noopener noreferrer">
                        {r.chatbot_sid}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>{Number.isFinite(r.overall_score) ? r.overall_score.toFixed(2) : "—"}</td>
                  <td className="axes">
                    {Number.isFinite(r.axis1) ? r.axis1 : "—"}/
                    {Number.isFinite(r.axis2) ? r.axis2 : "—"}/
                    {Number.isFinite(r.axis3) ? r.axis3 : "—"}
                  </td>
                  <td>
                    <div className="mini-tags">
                      {r.qaTags.map((t) => (
                        <span
                          key={t}
                          className={`mini-tag qa ${qaSelected.includes(t) ? "hit" : ""}`}
                          onClick={() => onToggleQa(t)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && onToggleQa(t)}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>
                    <div className="mini-tags">
                      {r.categoryTags.map((t) => (
                        <span
                          key={t}
                          className={`mini-tag category ${categorySelected.includes(t) ? "hit" : ""}`}
                          onClick={() => onToggleCategory(t)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => e.key === "Enter" && onToggleCategory(t)}
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="time-cell">{formatSessionTime(r.time)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length > shown ? (
            <button
              type="button"
              className="session-show-more"
              onClick={() => setShown((n) => n + PAGE)}
            >
              Show more ({shown.toLocaleString()} of {sorted.length.toLocaleString()})
            </button>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
