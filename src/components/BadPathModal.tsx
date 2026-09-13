import { useTranslation } from 'react-i18next';
import { AlertTriangle, FolderOpen } from 'lucide-react';
import { exit } from '@tauri-apps/plugin-process';

export type BadPathType = 'root' | 'temp';

interface BadPathModalProps {
  show: boolean;
  type: BadPathType;
}

export function BadPathModal({ show, type }: BadPathModalProps) {
  const { t } = useTranslation();

  const handleExit = async () => {
    await exit(0);
  };

  if (!show) return null;

  const isRoot = type === 'root';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="mxu-overlay-surface w-full max-w-md mx-4 bg-bg-secondary rounded-xl shadow-2xl border border-border overflow-hidden animate-in zoom-in-95 duration-200">
        {/* 标题栏 */}
        <div className="flex items-center px-4 py-3 bg-bg-tertiary border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            <span className="text-sm font-medium text-text-primary">
              {t('badPath.title', '程序位置不对')}
            </span>
          </div>
        </div>

        {/* 内容区 */}
        <div className="p-5 space-y-4">
          {/* 图标和主要提示 */}
          <div className="flex flex-col items-center text-center space-y-3">
            <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center">
              <FolderOpen className="w-8 h-8 text-warning" />
            </div>
            <div className="space-y-2">
              <p className="text-text-primary font-medium">
                {isRoot
                  ? t('badPath.rootTitle', '别把程序放在磁盘根目录啦！')
                  : t('badPath.tempTitle', '你好像直接双击压缩包里的程序了')}
              </p>
              <p className="text-sm text-text-secondary">
                {isRoot
                  ? t(
                      'badPath.rootDescription',
                      '程序放在 C盘、D盘 这种根目录下会出问题的。找个文件夹放进去再用吧，比如「D:\\我的软件\\」之类的。',
                    )
                  : t(
                      'badPath.tempDescription',
                      '程序现在在临时目录里跑着呢，一关掉可能就没了。先把压缩包解压到一个文件夹里，再打开里面的程序吧。',
                    )}
              </p>
            </div>
          </div>

          {/* 小提示 */}
          <div className="p-3 bg-bg-tertiary rounded-lg">
            <p className="text-xs text-text-muted">
              {t(
                'badPath.hint',
                '小提示：建议解压到一个专门的文件夹，比如「D:\\MaaXXX」，别放桌面或者下载文件夹，那样更方便管理。',
              )}
            </p>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 bg-bg-tertiary border-t border-border">
          <button
            onClick={handleExit}
            className="px-4 py-2 text-sm bg-accent text-white hover:bg-accent-hover rounded-lg transition-colors"
          >
            {t('badPath.exit', '退出程序')}
          </button>
        </div>
      </div>
    </div>
  );
}
