import { useEffect, useRef, useState } from 'react';
import { HNode, Hierarchy } from '../data/model';

interface Props {
  hierarchy: Hierarchy;
  value: HNode;
  onChange: (n: HNode) => void;
  label?: string;
}

/** Dropdown picker over a hierarchy: expandable tree, click a name to select. */
export function TreeSelect({ hierarchy, value, onChange, label }: Props) {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const wrapRef = useRef<HTMLDivElement>(null);

  const openPopover = () => {
    // Expand the root, its children, and the ancestors of the current value.
    const exp = new Set<string>([hierarchy.root.id]);
    let cur: HNode | null = value;
    while (cur) {
      exp.add(cur.id);
      cur = cur.parent;
    }
    setExpanded(exp);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderNode = (n: HNode): JSX.Element => (
    <div key={n.id}>
      <div className={`tsel-row${n.id === value.id ? ' selected' : ''}`} style={{ paddingLeft: 8 + n.depth * 14 }}>
        {n.children.length > 0 ? (
          <button className="tsel-caret" onClick={() => toggle(n.id)}>
            {expanded.has(n.id) ? '▾' : '▸'}
          </button>
        ) : (
          <span className="tsel-caret empty" />
        )}
        <span
          className={`tsel-name${n.contra ? ' contra' : ''}`}
          onClick={() => {
            onChange(n);
            setOpen(false);
          }}
        >
          {n.short}
        </span>
      </div>
      {expanded.has(n.id) && n.children.map(renderNode)}
    </div>
  );

  return (
    <div className="tsel" ref={wrapRef}>
      {label && <span className="ctl-label">{label}</span>}
      <button className="tsel-btn" onClick={() => (open ? setOpen(false) : openPopover())} title={value.path}>
        <span className="tsel-value">{value.short}</span>
        <span className="tsel-arrow">▾</span>
      </button>
      {open && <div className="tsel-pop">{renderNode(hierarchy.root)}</div>}
    </div>
  );
}
