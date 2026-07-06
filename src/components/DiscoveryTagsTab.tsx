import { useMemo } from "react";
import { computeTagStats } from "../parsing";
import type { RatingRow } from "../parsing";
import { LABELS } from "../labels";

type DiscoveryTagsTabProps = {
  pool: RatingRow[];
  totalCount: number;
  poolLabel: string;
};

export function DiscoveryTagsTab({ pool, totalCount, poolLabel }: DiscoveryTagsTabProps) {
  const rows = useMemo(
    () => computeTagStats(pool, (r) => r.discoveryTags, totalCount),
    [pool, totalCount]
  );

  return (
    <section className="discovery-tags-view">
      <div className="discovery-tags-header">
        <div>
          <h2 className="discovery-tags-title">{LABELS.discoveryTags}</h2>
          <p className="discovery-tags-subtitle">
            Occurrence counts across {poolLabel} ({pool.length.toLocaleString()} sessions).
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="discovery-tags-empty">
          No {LABELS.discoveryTags.toLowerCase()} in {poolLabel}.
        </p>
      ) : (
        <div className="discovery-tags-table-card">
          <div className="discovery-tags-table-scroll">
            <table className="tag-table discovery-tags-table">
              <thead>
                <tr>
                  <th>Discovery tag</th>
                  <th className="num">Occurrences</th>
                  <th className="num">% of pool</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.tag}>
                    <td className="discovery-tag-name">{row.tag}</td>
                    <td className="num">{row.count.toLocaleString()}</td>
                    <td className="num">{row.pctOfPool.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
