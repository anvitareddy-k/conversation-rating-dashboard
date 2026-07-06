import { kindLabel, type TagOrCategoryKind } from "../labels";

export function KindBadge({ kind }: { kind: TagOrCategoryKind }) {
  const cls = kind === "category" ? "category" : "tag";
  return <span className={`kind-badge ${cls}`}>{kindLabel(kind)}</span>;
}
