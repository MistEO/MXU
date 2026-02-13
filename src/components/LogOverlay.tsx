import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { X, GripHorizontal } from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import clsx from 'clsx';

type LogType = 'info' | 'success' | 'warning' | 'error' | 'agent' | 'focus';

interface OverlayLogEntry {
  id: string;
  timestamp: number;
  type: LogType;
  message: string;
  html?: string;
}

const MAX_OVERLAY_LOGS = 200;

export function LogOverlayApp() {
  const { t } = useTranslation();
  const [logs, setLogs] = useState<OverlayLogEntry[]>([]);
  const [isHovered, setIsHovered] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Listen for ALL log events (no instance filtering)
  useEffect(() => {
    const unlisteners: Array<() => void> = [];

    listen<{ instanceId: string; log: OverlayLogEntry }>('log-overlay-new-log', (event) => {
      setLogs((prev) => {
        const next = [...prev, event.payload.log];
        return next.length > MAX_OVERLAY_LOGS ? next.slice(-MAX_OVERLAY_LOGS) : next;
      });
    }).then((unlisten) => unlisteners.push(unlisten));

    listen<{ instanceId: string }>('log-overlay-clear', () => {
      setLogs([]);
    }).then((unlisten) => unlisteners.push(unlisten));

    return () => {
      unlisteners.forEach((fn) => fn());
    };
  }, []);

  // Auto-scroll
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Drag via Tauri native startDragging
  const handleDragStart = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault();
    try {
      await getCurrentWindow().startDragging();
    } catch {
      // ignore
    }
  }, []);

  // Close
  const handleClose = useCallback(async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      // ignore
    }
  }, []);

  const getLogColor = (type: LogType) => {
    switch (type) {
      case 'success':
        return 'text-emerald-400';
      case 'warning':
        return 'text-amber-400';
      case 'error':
        return 'text-red-400';
      case 'agent':
        return 'text-slate-400';
      case 'focus':
        return 'text-blue-400';
      case 'info':
        return 'text-sky-400';
      default:
        return 'text-slate-300';
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    const s = d.getSeconds().toString().padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  return (
    <div
      className="flex flex-col h-screen w-screen overflow-hidden select-none"
      style={{ background: 'transparent' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Title bar - draggable */}
      <div
        onMouseDown={handleDragStart}
        className={clsx(
          'flex items-center justify-between px-3 py-1 cursor-move transition-all duration-200 shrink-0',
          isHovered ? 'bg-black/60' : 'bg-black/25',
        )}
        style={{ borderRadius: '8px 8px 0 0' }}
      >
        <span
          className={clsx(
            'text-[11px] font-medium transition-opacity duration-200',
            isHovered ? 'text-white/80 opacity-100' : 'text-white/40 opacity-50',
          )}
        >
          Log
        </span>
        <button
          onMouseDown={(e) => e.stopPropagation()}
          onClick={handleClose}
          className={clsx(
            'p-0.5 rounded transition-all duration-200',
            isHovered
              ? 'text-white/70 hover:text-red-400 hover:bg-white/10 opacity-100'
              : 'text-white/20 opacity-0 pointer-events-none',
          )}
        >
          <X className="w-3 h-3" />
        </button>
      </div>

      {/* Logs content */}
      <div
        className={clsx(
          'flex-1 overflow-y-auto overflow-x-hidden px-2.5 py-1 font-mono transition-all duration-200 relative',
          isHovered ? 'bg-black/55' : 'bg-black/35',
        )}
        style={{
          borderRadius: '0 0 8px 8px',
          fontSize: '11px',
          lineHeight: '1.5',
          scrollbarWidth: 'thin',
          scrollbarColor: 'rgba(255,255,255,0.15) transparent',
        }}
      >
        {logs.length === 0 ? (
          <div className="h-full flex items-center justify-center text-white/25 text-[11px]">
            {t('settings.logOverlayWaitingLogs')}
          </div>
        ) : (
          <>
            {logs.map((entry) => (
              <div key={entry.id} className="py-px flex gap-1.5">
                <span className="text-white/25 flex-shrink-0 tabular-nums">
                  {formatTime(entry.timestamp)}
                </span>
                {entry.html ? (
                  <span
                    className={clsx('break-all', getLogColor(entry.type))}
                    dangerouslySetInnerHTML={{ __html: entry.html }}
                  />
                ) : (
                  <span className={clsx('break-all', getLogColor(entry.type))}>
                    {entry.message}
                  </span>
                )}
              </div>
            ))}
            <div ref={logsEndRef} />
          </>
        )}

        {/* Resize grip */}
        <div
          onMouseDown={async (e) => {
            e.preventDefault();
            e.stopPropagation();
            try {
              await getCurrentWindow().startResizeDragging('SouthEast');
            } catch {
              // ignore
            }
          }}
          className={clsx(
            'absolute bottom-0 right-0 w-4 h-4 cursor-se-resize flex items-center justify-center transition-opacity duration-200',
            isHovered ? 'opacity-40' : 'opacity-0',
          )}
        >
          <GripHorizontal className="w-2.5 h-2.5 text-white rotate-[-45deg]" />
        </div>
      </div>
    </div>
  );
}
