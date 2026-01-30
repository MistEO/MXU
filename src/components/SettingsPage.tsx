import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Paintbrush,
  Key,
  SlidersHorizontal,
  Download,
  Bug,
  Info,
} from 'lucide-react';
import clsx from 'clsx';

import { useAppStore } from '@/stores/appStore';
import type { CustomAccent } from '@/themes';
import { ConfirmDialog } from './ConfirmDialog';
import {
  AppearanceSection,
  HotkeySection,
  MiscSection,
  UpdateSection,
  DebugSection,
  AboutSection,
  CustomAccentModal,
} from './settings';

interface SettingsPageProps {
  onClose?: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const {
    setCurrentPage,
    projectInterface,
    customAccents,
    addCustomAccent,
    updateCustomAccent,
    removeCustomAccent,
    confirmBeforeDelete,
  } = useAppStore();

  // 自定义强调色编辑状态
  const [isAccentModalOpen, setIsAccentModalOpen] = useState(false);
  const [editingAccent, setEditingAccent] = useState<CustomAccent | null>(null);
  const [pendingDeleteAccentId, setPendingDeleteAccentId] = useState<string | null>(null);
  const [undoDeletedAccent, setUndoDeletedAccent] = useState<CustomAccent | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  // 打开创建模态框
  const openCreateAccentModal = useCallback(() => {
    setEditingAccent(null);
    setIsAccentModalOpen(true);
  }, []);

  // 打开编辑模态框
  const openEditAccentModal = useCallback((accent: CustomAccent) => {
    setEditingAccent(accent);
    setIsAccentModalOpen(true);
  }, []);

  // 关闭模态框
  const handleCloseAccentModal = useCallback(() => {
    setIsAccentModalOpen(false);
    setEditingAccent(null);
  }, []);

  // 保存强调色
  const handleSaveAccent = useCallback(
    (accent: CustomAccent) => {
      if (editingAccent) {
        updateCustomAccent(editingAccent.id, accent);
      } else {
        addCustomAccent(accent);
      }
    },
    [editingAccent, addCustomAccent, updateCustomAccent],
  );

  // 执行删除
  const performDeleteCustomAccent = useCallback(
    (id: string) => {
      const accent = customAccents.find((a) => a.id === id);
      if (!accent) return;

      if (undoTimerRef.current) {
        window.clearTimeout(undoTimerRef.current);
        undoTimerRef.current = null;
      }

      removeCustomAccent(id);
      setUndoDeletedAccent(accent);
      undoTimerRef.current = window.setTimeout(() => {
        setUndoDeletedAccent(null);
        undoTimerRef.current = null;
      }, 5000);
    },
    [customAccents, removeCustomAccent],
  );

  // 处理删除（可能需要确认）
  const handleDeleteAccent = useCallback(
    (id: string) => {
      if (confirmBeforeDelete) {
        setPendingDeleteAccentId(id);
      } else {
        performDeleteCustomAccent(id);
      }
    },
    [confirmBeforeDelete, performDeleteCustomAccent],
  );

  // 撤销删除
  const handleUndoDeleteAccent = useCallback(() => {
    if (!undoDeletedAccent) return;
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    addCustomAccent(undoDeletedAccent);
    setUndoDeletedAccent(null);
  }, [undoDeletedAccent, addCustomAccent]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  // 目录索引配置
  const tocItems = useMemo(() => {
    const items = [{ id: 'appearance', icon: Paintbrush, labelKey: 'settings.appearance' }];
    items.push({ id: 'hotkeys', icon: Key, labelKey: 'settings.hotkeys' });
    items.push({ id: 'misc', icon: SlidersHorizontal, labelKey: 'settings.misc' });
    if (projectInterface?.mirrorchyan_rid) {
      items.push({ id: 'update', icon: Download, labelKey: 'mirrorChyan.title' });
    }
    items.push(
      { id: 'debug', icon: Bug, labelKey: 'debug.title' },
      { id: 'about', icon: Info, labelKey: 'about.title' },
    );
    return items;
  }, [projectInterface?.mirrorchyan_rid]);

  // 当前高亮的 section
  const [activeSection, setActiveSection] = useState('appearance');
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 滚动到指定 section
  const scrollToSection = useCallback((sectionId: string) => {
    const element = document.getElementById(`section-${sectionId}`);
    if (element && scrollContainerRef.current) {
      const container = scrollContainerRef.current;
      const elementTop = element.offsetTop - container.offsetTop;
      container.scrollTo({
        top: elementTop - 16,
        behavior: 'smooth',
      });
    }
  }, []);

  // 监听滚动，更新当前高亮的 section
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const sections = tocItems
        .map((item) => ({
          id: item.id,
          element: document.getElementById(`section-${item.id}`),
        }))
        .filter((s) => s.element);

      const scrollTop = container.scrollTop;

      for (let i = sections.length - 1; i >= 0; i--) {
        const section = sections[i];
        if (section.element) {
          const sectionTop = section.element.offsetTop - container.offsetTop;
          if (scrollTop >= sectionTop - 100) {
            setActiveSection(section.id);
            break;
          }
        }
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [tocItems]);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-bg-primary">
      {/* 顶部导航 */}
      <div className="flex items-center gap-3 px-4 py-3 bg-bg-secondary border-b border-border">
        <button
          onClick={onClose ?? (() => setCurrentPage('main'))}
          className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <h1 className="text-lg font-semibold text-text-primary">{t('settings.title')}</h1>
      </div>

      {/* 主体区域：左侧目录 + 右侧内容 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧固定目录索引 */}
        <nav className="w-40 flex-shrink-0 bg-bg-secondary border-r border-border p-4 space-y-1">
          {tocItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left',
                  isActive
                    ? 'bg-accent text-white'
                    : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary',
                )}
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            );
          })}
        </nav>

        {/* 右侧设置内容 */}
        <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
          <div className="max-w-2xl mx-auto p-6 space-y-8">
            {/* 外观设置 */}
            <AppearanceSection
              onOpenCreateAccentModal={openCreateAccentModal}
              onOpenEditAccentModal={openEditAccentModal}
              onDeleteAccent={handleDeleteAccent}
            />

            {/* 快捷键设置 */}
            <HotkeySection />

            {/* 杂项设置 */}
            <MiscSection />

            {/* MirrorChyan 更新设置 */}
            <UpdateSection />

            {/* 调试 */}
            <DebugSection />

            {/* 关于 */}
            <AboutSection />
          </div>
        </div>
      </div>

      {/* 自定义强调色编辑模态框 */}
      <CustomAccentModal
        isOpen={isAccentModalOpen}
        editingAccent={editingAccent}
        onClose={handleCloseAccentModal}
        onSave={handleSaveAccent}
      />

      {/* 删除自定义强调色确认框 */}
      <ConfirmDialog
        open={pendingDeleteAccentId !== null}
        title={t('settings.deleteCustomAccent')}
        message={t('settings.deleteCustomAccentConfirm')}
        cancelText={t('common.cancel')}
        confirmText={t('common.confirm')}
        destructive
        onCancel={() => setPendingDeleteAccentId(null)}
        onConfirm={() => {
          if (pendingDeleteAccentId) performDeleteCustomAccent(pendingDeleteAccentId);
          setPendingDeleteAccentId(null);
        }}
      />

      {/* Undo 删除提示 */}
      {undoDeletedAccent && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50">
          <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border bg-bg-secondary shadow-2xl">
            <span className="text-sm text-text-secondary">
              {t('settings.customAccentDeleted', { name: undoDeletedAccent.name })}
            </span>
            <button
              type="button"
              onClick={handleUndoDeleteAccent}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-bg-tertiary hover:bg-bg-hover text-text-secondary transition-colors"
            >
              {t('common.undo')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
