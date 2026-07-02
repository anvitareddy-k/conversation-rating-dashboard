import { kindLabel, type TagOrCategoryKind } from "../labels";

export function KindBadge({ kind }: { kind: TagOrCategoryKind }) {
  return (
    <span className={`kind-badge ${kind === "discovery" ? "category" : "tag"}`}>
      {kindLabel(kind)}
    </span>
  );
}
