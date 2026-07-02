import type { TagKind } from "./parsing";

/** User-facing names — internal fields stay qaTags / discoveryTags */
export const LABELS = {
  tags: "Tags",
  categories: "Categories",
  tagsDesc: "Issue / failure tags on sessions",
  categoriesDesc: "Conversation category labels",
  tagsAndCategories: "Tags + Categories",
} as const;

export type TagOrCategoryKind = "qa" | "discovery";

export function kindLabel(kind: TagOrCategoryKind | TagKind): string {
  if (kind === "discovery") return LABELS.categories;
  if (kind === "qa") return LABELS.tags;
  return "Structural";
}

export function kindLabelSingular(kind: TagOrCategoryKind): string {
  return kind === "discovery" ? "Category" : "Tag";
}
