type Node = { type: string; value?: string; children?: Node[]; data?: Record<string, unknown> };

// Tiptap uses these attribute-free inline tags for underline, overlapping marks,
// and table-cell line breaks. Turn only these into normal Markdown AST nodes.
// All other HTML remains inert; no HTML parser or raw HTML renderer is enabled.
export function remarkRichText() {
  return (tree: Node) => {
    const walk = (parent: Node) => {
      if (!parent.children) return;
      parent.children.forEach(walk);
      const root: Node[] = [];
      const stack: { tag: string; opening: Node; children: Node[] }[] = [];
      const append = (node: Node) => (stack.at(-1)?.children || root).push(node);
      for (const child of parent.children) {
        if (child.type !== 'html') {
          append(child);
          continue;
        }
        if (/^<br\s*\/?\s*>$/i.test(child.value || '')) {
          append({ type: 'break' });
          continue;
        }
        const tag = /^<(\/?)(u|strong|em|s|del)>$/i.exec(child.value || '');
        if (!tag) {
          append(child);
          continue;
        }
        const name = tag[2].toLowerCase();
        if (!tag[1]) {
          stack.push({ tag: name, opening: child, children: [] });
          continue;
        }
        if (stack.at(-1)?.tag !== name) {
          append(child);
          continue;
        }
        const frame = stack.pop()!;
        append({
          type:
            name === 'strong' ? 'strong' : name === 'em' || name === 'u' ? 'emphasis' : 'delete',
          children: frame.children,
          ...(name === 'u' ? { data: { hName: 'u' } } : {}),
        });
      }
      while (stack.length) {
        const frame = stack.pop()!;
        append(frame.opening);
        frame.children.forEach(append);
      }
      parent.children = root;
    };
    walk(tree);
  };
}
