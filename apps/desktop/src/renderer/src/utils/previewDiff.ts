type NodeMatchEntry = {
  kind: 'unchanged' | 'removed' | 'added';
  beforeIndex?: number;
  afterIndex?: number;
};

const DIFF_ADDED_CLASS = 'kbv-preview-diff-added';
const DIFF_REMOVED_CLASS = 'kbv-preview-diff-removed';

const TRANSPARENT_CONTAINER_TAGS = new Set([
  'article',
  'div',
  'main',
  'section'
]);

export function buildPreviewDiffHtml(beforeHtml: string, afterHtml: string): string {
  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    return afterHtml;
  }

  const parser = new DOMParser();
  const beforeDoc = parser.parseFromString(beforeHtml || '', 'text/html');
  const afterDoc = parser.parseFromString(afterHtml || '', 'text/html');

  applyNodeDiff(beforeDoc.body, afterDoc.body, afterDoc);
  return afterDoc.body.innerHTML;
}

function applyNodeDiff(beforeParent: Node, afterParent: Node, targetDoc: Document): void {
  const beforeChildren = getComparableChildren(beforeParent);
  const afterChildren = getComparableChildren(afterParent);
  const sequence = diffSequence(
    beforeChildren.map((node) => getNodeIdentity(node)),
    afterChildren.map((node) => getNodeIdentity(node))
  );

  for (const entry of sequence) {
    if (entry.kind === 'unchanged') {
      const beforeNode = beforeChildren[entry.beforeIndex ?? -1];
      const afterNode = afterChildren[entry.afterIndex ?? -1];
      if (beforeNode && afterNode && shouldDiffChildren(beforeNode, afterNode)) {
        applyNodeDiff(beforeNode, afterNode, targetDoc);
      }
      continue;
    }

    if (entry.kind === 'removed') {
      const beforeNode = beforeChildren[entry.beforeIndex ?? -1];
      if (!beforeNode) {
        continue;
      }

      const anchor = entry.afterIndex !== undefined ? afterChildren[entry.afterIndex] ?? null : null;
      const removedNode = createRemovedNode(beforeNode, targetDoc);
      afterParent.insertBefore(removedNode, anchor);
      continue;
    }

    const afterIndex = entry.afterIndex ?? -1;
    const afterNode = afterChildren[afterIndex];
    if (afterNode) {
      afterChildren[afterIndex] = markAddedNode(afterNode, targetDoc);
    }
  }
}

function getComparableChildren(node: Node): Node[] {
  return Array.from(node.childNodes).filter((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      return child.textContent?.trim().length;
    }
    return true;
  });
}

function shouldDiffChildren(beforeNode: Node, afterNode: Node): boolean {
  if (beforeNode.nodeType !== Node.ELEMENT_NODE || afterNode.nodeType !== Node.ELEMENT_NODE) {
    return false;
  }

  const beforeElement = beforeNode as Element;
  const afterElement = afterNode as Element;
  if (beforeElement.tagName !== afterElement.tagName) {
    return false;
  }

  if (beforeElement.outerHTML === afterElement.outerHTML) {
    return false;
  }

  if (TRANSPARENT_CONTAINER_TAGS.has(beforeElement.tagName.toLowerCase())) {
    return true;
  }

  return hasComparableChildElements(beforeElement) && hasComparableChildElements(afterElement);
}

function hasComparableChildElements(element: Element): boolean {
  return Array.from(element.childNodes).some((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      return child.textContent?.trim().length;
    }
    return child.nodeType === Node.ELEMENT_NODE;
  });
}

function markAddedNode(node: Node, targetDoc: Document): Node {
  if (node.nodeType === Node.ELEMENT_NODE) {
    (node as Element).classList.add(DIFF_ADDED_CLASS);
    return node;
  }

  if (node.nodeType === Node.TEXT_NODE && node.textContent?.trim()) {
    const wrapper = targetDoc.createElement('span');
    wrapper.className = DIFF_ADDED_CLASS;
    wrapper.textContent = node.textContent;
    node.parentNode?.replaceChild(wrapper, node);
    return wrapper;
  }

  return node;
}

function createRemovedNode(node: Node, targetDoc: Document): Node {
  if (node.nodeType === Node.ELEMENT_NODE) {
    const clone = node.cloneNode(true) as Element;
    clone.classList.add(DIFF_REMOVED_CLASS);
    return targetDoc.importNode(clone, true);
  }

  if (node.nodeType === Node.TEXT_NODE) {
    const wrapper = targetDoc.createElement('span');
    wrapper.className = DIFF_REMOVED_CLASS;
    wrapper.textContent = node.textContent;
    return wrapper;
  }

  return targetDoc.importNode(node.cloneNode(true), true);
}

function getNodeIdentity(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return `text:${normalizeText(node.textContent ?? '')}`;
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return `node:${node.nodeType}`;
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();
  const exact = compactWhitespace(element.outerHTML);
  const text = normalizeText(element.textContent ?? '');
  const key = element.getAttribute('id') || element.getAttribute('data-id') || element.getAttribute('name') || '';

  if (exact.length <= 220) {
    return `element:${tag}:${key}:${exact}`;
  }

  return `element:${tag}:${key}:${text.slice(0, 200)}`;
}

function normalizeText(value: string): string {
  return compactWhitespace(value)
    .replace(/\u00a0/g, ' ')
    .trim();
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ');
}

function diffSequence(beforeValues: string[], afterValues: string[]): NodeMatchEntry[] {
  const rows = beforeValues.length;
  const cols = afterValues.length;
  const lcs: number[][] = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = cols - 1; j >= 0; j -= 1) {
      lcs[i][j] = beforeValues[i] === afterValues[j]
        ? lcs[i + 1][j + 1] + 1
        : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  const sequence: NodeMatchEntry[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < cols) {
    if (beforeValues[i] === afterValues[j]) {
      sequence.push({ kind: 'unchanged', beforeIndex: i, afterIndex: j });
      i += 1;
      j += 1;
      continue;
    }

    if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      sequence.push({ kind: 'removed', beforeIndex: i, afterIndex: j });
      i += 1;
      continue;
    }

    sequence.push({ kind: 'added', afterIndex: j });
    j += 1;
  }

  while (i < rows) {
    sequence.push({ kind: 'removed', beforeIndex: i });
    i += 1;
  }

  while (j < cols) {
    sequence.push({ kind: 'added', afterIndex: j });
    j += 1;
  }

  return sequence;
}
