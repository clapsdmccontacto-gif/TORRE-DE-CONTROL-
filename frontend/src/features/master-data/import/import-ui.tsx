import type { RowIssue } from '@core/modules/master-data/domain/spreadsheet';
import { Download, FileSpreadsheet, LoaderCircle } from 'lucide-react';
import { useRef, useState } from 'react';
import { StatusLabel } from '@/components/status';
import { Button } from '@/components/ui/button';

/** Elegir la planilla (.xlsx o .csv) y descargar la plantilla. */
export function SheetPicker({
  id,
  busy,
  onFile,
  onTemplate,
}: {
  id: string;
  busy: boolean;
  onFile: (file: File) => void;
  onTemplate: () => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={input}
        id={id}
        type="file"
        accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      <Button type="button" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? <LoaderCircle className="animate-spin" /> : <FileSpreadsheet />} Elegir planilla
        (.xlsx o .csv)
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={downloading}
        onClick={() => {
          setDownloading(true);
          void onTemplate().finally(() => setDownloading(false));
        }}
      >
        <Download /> Descargar plantilla
      </Button>
    </div>
  );
}

/** Errores por fila (las filas con error no se importan). */
export function IssueList({ issues }: { issues: RowIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="grid gap-2">
      <p className="font-medium">
        {issues.length === 1 ? 'Una fila tiene un error' : `${issues.length} filas con error`} (no
        se importan; corríjalas en la planilla y vuelva a cargarla):
      </p>
      <ul className="grid max-h-64 gap-1 overflow-y-auto rounded-md border p-2">
        {issues.map((issue, i) => (
          <li key={`${issue.line}-${i}`}>
            <StatusLabel status="critical">
              Fila {issue.line}: {issue.message}
            </StatusLabel>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MissingColumns({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return (
    <StatusLabel status="critical">
      Faltan columnas obligatorias: {missing.join(', ')}. Use la plantilla.
    </StatusLabel>
  );
}
