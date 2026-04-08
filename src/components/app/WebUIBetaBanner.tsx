import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isTauri } from '@/utils/paths';

const ISSUE_URL = 'https://github.com/MistEO/MXU/issues';

export function WebUIBetaBanner() {
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState(false);

  if (isTauri() || dismissed) return null;

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-amber-500/15 text-amber-700 dark:text-amber-300 border-b border-amber-500/20 select-none shrink-0">
      <svg
        className="w-3.5 h-3.5 shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
      <span className="flex-1 min-w-0">
        {t('webuiBeta.message')}{' '}
        <a
          href={ISSUE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:text-amber-900 dark:hover:text-amber-100 font-medium"
        >
          {t('webuiBeta.reportIssue')}
        </a>
        {' · '}
        {t('webuiBeta.desktopHint')}
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="shrink-0 p-0.5 rounded hover:bg-amber-500/20 transition-colors"
        aria-label={t('common.close')}
      >
        <svg className="w-3 h-3" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M2 2l8 8M10 2l-8 8" />
        </svg>
      </button>
    </div>
  );
}
