export interface CategoryLocalizedNames {
  readonly th?: string;
  readonly en?: string;
  readonly my?: string;
  readonly [lang: string]: string | undefined;
}

export interface Category {
  readonly id: string;
  readonly slug: string;
  readonly names: CategoryLocalizedNames;
  readonly parentId: string | null;
  readonly sortOrder: number;
  readonly icon: string | null;
  readonly imageUrl: string | null;
  readonly isActive: boolean;
}

export interface CategoryTreeNode extends Category {
  readonly children: readonly CategoryTreeNode[];
}

export function buildCategoryTree(categories: readonly Category[]): readonly CategoryTreeNode[] {
  const map = new Map<string, CategoryTreeNode>();
  const roots: CategoryTreeNode[] = [];

  for (const cat of categories) {
    map.set(cat.id, { ...cat, children: [] });
  }

  for (const cat of categories) {
    const node = map.get(cat.id)!;
    if (cat.parentId && map.has(cat.parentId)) {
      const parent = map.get(cat.parentId)!;
      (parent.children as CategoryTreeNode[]).push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort by sortOrder
  const sortFn = (a: CategoryTreeNode, b: CategoryTreeNode) => a.sortOrder - b.sortOrder;
  roots.sort(sortFn);
  for (const node of map.values()) {
    (node.children as CategoryTreeNode[]).sort(sortFn);
  }

  return roots;
}
