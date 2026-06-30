import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Paintbrush,
  Key,
  Settings2,
  Download,
  Bug,
  Info,
  Menu,
  X,
  LayoutGrid,
} from 'lucide-react';
import clsx from 'clsx';
import { useIsMobile } from '@/hooks/useIsMobile';

import { useAppStore } from '@/stores/appStore';
import type { CustomAccent } from '@/themes';
import type { InterfaceSettingsSection, OptionDefinition, ProjectInterface } from '@/types/interface';
import { loadIconAsDataUrl } from '@/services/contentResolver';
import { ConfirmDialog } from './ConfirmDialog';
import {
  AppearanceSection,
  HotkeySection,
  GeneralSection,
  UpdateSection,
  DebugSection,
  AboutSection,
  CustomAccentModal,
} from './settings';

interface SettingsPageProps {
  onClose?: () => void;
}

interface RenderSettingsSection extends InterfaceSettingsSection {
  resolvedLabel: string;
  resolvedDescription?: string;
  resolvedIcon?: string;
}

function resolveSettingsText(
  text: string | undefined,
  fallback: string | undefined,
  translations: Record<string, string>,
): string {
  if (!text) return fallback || '';
  if (!text.startsWith('$')) return text;
  const key = text.slice(1);
  return translations[key] || key;
}

function useResolvedIcon(icon?: string, basePath: string): string | undefined {
  const [iconUrl, setIconUrl] = useState<string | undefined>();

  useEffect(() => {
    let mounted = true;
    if (!icon) {
      setIconUrl(undefined);
      return;
    }
    loadIconAsDataUrl(icon, basePath).then((url) => {
      if (mounted) setIconUrl(url);
    });
    return () => {
      mounted = false;
    };
  }, [icon, basePath]);

  return iconUrl;
}

function OptionDefinitionPreview({
  optionDef,
  basePath,
}: {
  optionDef: OptionDefinition;
  basePath: string;
}) {
  const iconUrl = useResolvedIcon(optionDef.icon, basePath);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        {iconUrl ? <img src={iconUrl} alt="" className="w-4 h-4 object-contain" /> : null}
        <span className="text-sm font-medium text-text-primary">
          {optionDef.label?.startsWith('$') ? optionDef.label.slice(1) : optionDef.label || optionDef.type}
        </span>
      </div>
      {optionDef.description && (
        <div className="text-xs text-text-secondary">
          {optionDef.description.startsWith('$') ? optionDef.description.slice(1) : optionDef.description}
        </div>
      )}
      <div className="text-xs text-text-muted">{optionDef.type}</div>
    </div>
  );
}

function TaskSettingsSection({
  section,
  projectInterface,
  basePath,
}: {
  section: RenderSettingsSection;
  projectInterface: ProjectInterface | null;
  basePath: string;
}) {
  const [expanded, setExpanded] = useState(section.default_expand ?? true);
  const optionKeys = section.option || [];
  const availableOptionKeys = optionKeys.filter((key) => !!projectInterface?.option?.[key]);
  const iconUrl = useResolvedIcon(section.resolvedIcon, basePath);

  return (
    <details
      id={`section-${section.name}`}
      open={expanded}
      onToggle={(e) => setExpanded((e.currentTarget as HTMLDetailsElement).open)}
      className="rounded-xl border border-border bg-bg-secondary overflow-hidden"
    >
      <summary className="list-none cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3 hover:bg-bg-hover transition-colors">
        <div className="flex items-center gap-3 min-w-0">
          {iconUrl ? (
            <img src={iconUrl} alt="" className="w-5 h-5 object-contain flex-shrink-0" />
          ) : (
            <LayoutGrid className="w-5 h-5 text-accent flex-shrink-0" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-text-primary truncate">{section.resolvedLabel}</div>
            {section.resolvedDescription && (
              <div className="text-xs text-text-secondary line-clamp-2">{section.resolvedDescription}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-[11px] text-text-muted">{availableOptionKeys.length}</span>
          <span className={clsx('text-text-secondary transition-transform duration-200', expanded ? 'rotate-90' : 'rotate-0')}>
            <ChevronRight className="w-4 h-4" />
          </span>
        </div>
      </summary>
      <div className="px-4 pb-4 pt-2 space-y-3">
        {availableOptionKeys.length === 0 ? (
          <div className="text-sm text-text-muted">{t('settings.taskSettingsEmpty')}</div>
        ) : (
          availableOptionKeys.map((optionKey) => {
            const optionDef = projectInterface?.option?.[optionKey];
            if (!optionDef) return null;
            return (
              <div key={optionKey} className="rounded-lg border border-border/60 bg-bg-primary/60 p-3">
                <OptionDefinitionPreview optionDef={optionDef} basePath={basePath} />
              </div>
            );
          })
        )}
      </div>
    </details>
  );
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const { t, i18n } = useTranslation();
  const {
    setCurrentPage,
    projectInterface,
    customAccents,
    addCustomAccent,
    updateCustomAccent,
    removeCustomAccent,
    confirmBeforeDelete,
    basePath,
    interfaceTranslations,
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

  const langKey = i18n.language;
  const settingsSections = useMemo<RenderSettingsSection[]>(() => {
    const sections = projectInterface?.settings || [];
    const langMap = interfaceTranslations[langKey] || {};

    return sections.map((section) => ({
      ...section,
      resolvedLabel: resolveSettingsText(section.label, section.name, langMap),
      resolvedDescription: resolveSettingsText(section.description, undefined, langMap),
      resolvedIcon: section.icon,
    }));
  }, [projectInterface?.settings, interfaceTranslations, langKey]);

  // 目录索引配置
  const tocItems = useMemo(() => {
    const items = [{ id: 'appearance', icon: Paintbrush, labelKey: 'settings.appearance' }];
    if (settingsSections.length > 0) {
      items.push({ id: 'task-settings', icon: LayoutGrid, labelKey: 'settings.taskSettings' });
    }
    items.push({ id: 'general', icon: Settings2, labelKey: 'settings.general' });
    items.push({ id: 'hotkeys', icon: Key, labelKey: 'settings.hotkeys' });
    if (projectInterface?.mirrorchyan_rid) {
      items.push({ id: 'update', icon: Download, labelKey: 'mirrorChyan.title' });
    }
    items.push(
      { id: 'debug', icon: Bug, labelKey: 'debug.title' },
      { id: 'about', icon: Info, labelKey: 'about.title' },
    );
    return items;
  }, [projectInterface?.mirrorchyan_rid, settingsSections.length]);

  // 当前高亮的 section
  const [activeSection, setActiveSection] = useState('appearance');
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);

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
    setDrawerOpen(false);
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
        {/* 移动端：汉堡菜单按钮 */}
        {isMobile && (
          <button
            onClick={() => setDrawerOpen(true)}
            className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
            title={t('settings.openNav')}
            aria-label={t('settings.openNav')}
          >
            <Menu className="w-5 h-5 text-text-secondary" />
          </button>
        )}
        <button
          onClick={onClose ?? (() => setCurrentPage('main'))}
          className="p-2 rounded-lg hover:bg-bg-hover transition-colors"
        >
          <ArrowLeft className="w-5 h-5 text-text-secondary" />
        </button>
        <h1 className="text-lg font-semibold text-text-primary">{t('settings.title')}</h1>
      </div>

      {/* 主体区域：左侧目录 + 右侧内容 */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* 桌面端：左侧固定目录索引 */}
        {!isMobile && (
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
        )}

        {/* 移动端：抽屉式导航 */}
        {isMobile && (
          <>
            {/* 半透明遮罩 */}
            <div
              className={clsx(
                'absolute inset-0 z-40 bg-black/40 transition-opacity duration-200',
                drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
              )}
              onClick={() => setDrawerOpen(false)}
            />
            {/* 滑入面板 */}
            <nav
              className={clsx(
                'absolute left-0 top-0 bottom-0 z-50 w-48 bg-bg-secondary border-r border-border p-4 space-y-1',
                'transform transition-transform duration-200 ease-out',
                drawerOpen ? 'translate-x-0' : '-translate-x-full',
              )}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-text-primary">
                  {t('settings.title')}
                </span>
                <button
                  onClick={() => setDrawerOpen(false)}
                  className="p-1 rounded-md hover:bg-bg-hover transition-colors"
                  title={t('settings.closeNav')}
                  aria-label={t('settings.closeNav')}
                >
                  <X className="w-4 h-4 text-text-secondary" />
                </button>
              </div>
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
          </>
        )}

        {/* 右侧设置内容 */}
        <div className="flex-1 overflow-y-auto" ref={scrollContainerRef}>
          <div className="max-w-2xl mx-auto p-6 space-y-8">
            {/* 外观设置 */}
            <AppearanceSection
              onOpenCreateAccentModal={openCreateAccentModal}
              onOpenEditAccentModal={openEditAccentModal}
              onDeleteAccent={handleDeleteAccent}
            />

            {/* 任务设置（来自 interface.settings） */}
            {settingsSections.length > 0 && (
              <section id="section-task-settings" className="space-y-4 scroll-mt-6">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="w-5 h-5 text-accent" />
                  <h2 className="text-lg font-semibold text-text-primary">
                    {t('settings.taskSettings')}
                  </h2>
                </div>
                <div className="space-y-4">
                  {settingsSections.map((section) => (
                    <TaskSettingsSection
                      key={section.name}
                      section={section}
                      projectInterface={projectInterface}
                      basePath={basePath}
                      langKey={langKey}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* 通用设置 */}
            <GeneralSection />

            {/* 快捷键设置 */}
            <HotkeySection />

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
