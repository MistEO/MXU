import { useEffect, useState } from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useLocalUpdatePackageImport } from '@/hooks/useLocalUpdatePackageImport';
import { isTauri } from '@/utils/windowUtils';

export function GlobalUpdateDropOverlay() {
  const { t } = useTranslation();
  const [draggingFile, setDraggingFile] = useState(false);
  const { importSinglePackage, disabled } = useLocalUpdatePackageImport();

  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let mounted = true;

    const setup = async () => {
      try {
        const { getCurrentWebview } = await import('@tauri-apps/api/webview');
        const webview = getCurrentWebview();
        unlisten = await webview.onDragDropEvent((event) => {
          const payload = event.payload;

          if (payload.type === 'over') {
            setDraggingFile(true);
            return;
          }

          if (payload.type === 'drop') {
            setDraggingFile(false);
            if (!disabled) {
              void importSinglePackage(payload.paths);
            }
            return;
          }

          setDraggingFile(false);
        });
      } catch {
        if (mounted) setDraggingFile(false);
      }
    };

    void setup();

    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [disabled, importSinglePackage]);

  if (!draggingFile) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 backdrop-blur-sm pointer-events-none">
      <div className="flex flex-col items-center gap-3 rounded-xl border border-accent/40 bg-bg-secondary/95 px-8 py-7 shadow-2xl">
        {disabled ? (
          <Loader2 className="w-10 h-10 text-warning animate-spin" />
        ) : (
          <UploadCloud className="w-10 h-10 text-accent" />
        )}
        <div className="text-center space-y-1">
          <p className="text-base font-medium text-text-primary">
            {disabled ? t('mirrorChyan.localPackageBusy') : t('mirrorChyan.dropLocalPackage')}
          </p>
          <p className="text-xs text-text-muted">{t('mirrorChyan.localPackageHint')}</p>
        </div>
      </div>
    </div>
  );
}
