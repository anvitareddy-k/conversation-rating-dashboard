import type { PickableTagKind, TagKind } from "./parsing";

/** User-facing names — internal fields stay qaTags / categoryTags / discoveryTags */
export const LABELS = {
  tags: "Tags",
  categories: "Categories",
  discoveryTags: "Discovery tags",
  tagsDesc: "Issue / failure tags on sessions",
  categoriesDesc: "Conversation category labels",
  discoveryTagsDesc: "Subject and topic labels from discovery_tags",
  tagsAndCategories: "Tags + Categories",
} as const;

export type TagOrCategoryKind = PickableTagKind;

export function kindLabel(kind: TagOrCategoryKind | TagKind): string {
  if (kind === "category") return LABELS.categories;
  if (kind === "discovery") return LABELS.discoveryTags;
  if (kind === "qa") return LABELS.tags;
  return "Structural";
}

export function kindLabelSingular(kind: TagOrCategoryKind): string {
  return kind === "category" ? "Category" : "Tag";
}
