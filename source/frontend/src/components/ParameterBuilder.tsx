import { useState, useEffect } from 'react';

export interface ParamRow {
  name: string;
  in: 'query' | 'header' | 'body' | 'path';
  type: 'string' | 'number' | 'boolean';
  description: string;
  required: boolean;
}

export function parseParams(value: string): ParamRow[] {
  if (!value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

interface ParameterBuilderProps {
  value: string;
  onChange: (v: string) => void;
  showLocation?: boolean;
}

export default function ParameterBuilder({ value, onChange, showLocation = true }: ParameterBuilderProps) {
  const [rows, setRows] = useState<ParamRow[]>(() => parseParams(value));

  const syncToParent = (updated: ParamRow[]) => {
    setRows(updated);
    onChange(updated.length > 0 ? JSON.stringify(updated, null, 2) : '');
  };

  useEffect(() => {
    const parsed = parseParams(value);
    if (JSON.stringify(parsed) !== JSON.stringify(rows)) {
      setRows(parsed);
    }
  }, [value]);

  const addRow = () => {
    syncToParent([...rows, { name: '', in: 'body', type: 'string', description: '', required: false }]);
  };

  const updateRow = (idx: number, field: keyof ParamRow, val: any) => {
    const updated = rows.map((r, i) => i === idx ? { ...r, [field]: val } : r);
    syncToParent(updated);
  };

  const removeRow = (idx: number) => {
    syncToParent(rows.filter((_, i) => i !== idx));
  };

  const gridCols = showLocation
    ? '1fr 80px 70px 1.5fr 50px 30px'
    : '1fr 70px 1.5fr 50px 30px';

  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '6px', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: '0', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '6px 8px' }}>
        <span style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Name</span>
        {showLocation && <span style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Location</span>}
        <span style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Type</span>
        <span style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Description</span>
        <span style={{ fontSize: '10px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase' }}>Req</span>
        <span></span>
      </div>
      {/* Rows */}
      {rows.map((row, idx) => (
        <div key={idx} style={{ display: 'grid', gridTemplateColumns: gridCols, gap: '4px', padding: '4px 8px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' }}>
          <input
            value={row.name}
            onChange={(e) => updateRow(idx, 'name', e.target.value)}
            placeholder="param_name"
            style={{ fontSize: '12px', padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: '3px', fontFamily: 'monospace' }}
          />
          {showLocation && (
            <select
              value={row.in}
              onChange={(e) => updateRow(idx, 'in', e.target.value)}
              style={{ fontSize: '11px', padding: '4px 2px', border: '1px solid #e2e8f0', borderRadius: '3px' }}
            >
              <option value="query">query</option>
              <option value="header">header</option>
              <option value="body">body</option>
              <option value="path">path</option>
            </select>
          )}
          <select
            value={row.type}
            onChange={(e) => updateRow(idx, 'type', e.target.value)}
            style={{ fontSize: '11px', padding: '4px 2px', border: '1px solid #e2e8f0', borderRadius: '3px' }}
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">bool</option>
          </select>
          <input
            value={row.description}
            onChange={(e) => updateRow(idx, 'description', e.target.value)}
            placeholder="What this parameter is"
            style={{ fontSize: '12px', padding: '4px 6px', border: '1px solid #e2e8f0', borderRadius: '3px' }}
          />
          <div style={{ textAlign: 'center' }}>
            <input
              type="checkbox"
              checked={row.required}
              onChange={(e) => updateRow(idx, 'required', e.target.checked)}
            />
          </div>
          <button
            onClick={() => removeRow(idx)}
            style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: '14px', padding: 0 }}
          >×</button>
        </div>
      ))}
      {/* Add row */}
      <div style={{ padding: '6px 8px' }}>
        <button
          onClick={addRow}
          style={{ fontSize: '12px', color: '#6366f1', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
        >
          + Add Parameter
        </button>
      </div>
    </div>
  );
}
