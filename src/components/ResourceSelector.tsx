import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  FolderOpen,
  Check,
  ChevronDown,
  Loader2,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import clsx from 'clsx';
import { maaService } from '@/services/maaService';
import { useAppStore } from '@/stores/appStore';
import { resolveI18nText } from '@/services/contentResolver';
import type { ResourceItem } from '@/types/interface';
import { getInterfaceLangKey } from '@/i18n';

interface ResourceSelectorProps {
  instanceId: string;
  resources: ResourceItem[];
  selectedResourceName?: string;
  onResourceChange?: (resourceName: string) => void;
  onLoadStatusChange?: (loaded: boolean) => void;
  isRunning?: boolean;
}

export function ResourceSelector({
  instanceId,
  resources,
  selectedResourceName,
  onResourceChange,
  onLoadStatusChange,
  isRunning = false,
}: ResourceSelectorProps) {
  const { t } = useTranslation();
  const { basePath, language, interfaceTranslations, registerResIdName } = useAppStore();

  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  
  // 等待中的资源 ID 集合（用于回调匹配）
  const [pendingResIds, setPendingResIds] = useState<Set<number>>(new Set());
  
  // 记录上一次加载的资源名称，避免重复加载
  const lastLoadedResourceRef = useRef<string | null>(null);
  
  // 下拉框触发按钮和菜单的 ref
  const dropdownRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  
  // 计算下拉框位置
  const calcDropdownPosition = useCallback(() => {
    if (!dropdownRef.current) return null;
    const rect = dropdownRef.current.getBoundingClientRect();
    return {
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    };
  }, []);
  
  // 点击外部关闭下拉框
  useEffect(() => {
    if (!showDropdown) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const inButton = dropdownRef.current?.contains(target);
      const inMenu = menuRef.current?.contains(target);
      if (!inButton && !inMenu) {
        setShowDropdown(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDropdown]);

  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];

  // 当前选中的资源
  const selectedResource = resources.find(r => r.name === selectedResourceName) || resources[0];
  
  // 监听 MaaFramework 回调事件，处理资源加载完成
  useEffect(() => {
    if (pendingResIds.size === 0) return;
    
    let unlisten: (() => void) | null = null;
    
    maaService.onCallback((message, details) => {
      if (details.res_id === undefined || !pendingResIds.has(details.res_id)) return;
      
      if (message === 'Resource.Loading.Succeeded') {
        setPendingResIds(prev => {
          const next = new Set(prev);
          next.delete(details.res_id!);
          // 所有资源都加载完成
          if (next.size === 0) {
            setIsLoaded(true);
            onLoadStatusChange?.(true);
            setIsLoading(false);
          }
          return next;
        });
      } else if (message === 'Resource.Loading.Failed') {
        setError('资源加载失败');
        setIsLoaded(false);
        onLoadStatusChange?.(false);
        setIsLoading(false);
        setPendingResIds(new Set());
        lastLoadedResourceRef.current = null;
      }
    }).then(fn => {
      unlisten = fn;
    });
    
    return () => {
      if (unlisten) unlisten();
    };
  }, [pendingResIds, onLoadStatusChange]);

  // 加载资源
  const loadResource = async (resource: ResourceItem) => {
    setIsLoading(true);
    setError(null);

    try {
      // 确保实例已创建
      await maaService.createInstance(instanceId).catch(() => {});

      // 构建完整资源路径
      const resourcePaths = resource.path.map(p => `${basePath}/${p}`);

      const resIds = await maaService.loadResource(instanceId, resourcePaths);
      
      // 注册 res_id 与资源名的映射用于日志显示
      const resourceDisplayName = resolveI18nText(resource.label, translations) || resource.name;
      resIds.forEach(resId => {
        registerResIdName(resId, resourceDisplayName);
      });
      
      // 记录已加载的资源名称
      lastLoadedResourceRef.current = resource.name;
      
      // 记录等待中的 res_ids，后续由回调处理完成状态
      setPendingResIds(new Set(resIds));
    } catch (err) {
      setError(err instanceof Error ? err.message : '资源加载失败');
      setIsLoaded(false);
      onLoadStatusChange?.(false);
      setIsLoading(false);
      lastLoadedResourceRef.current = null;
    }
  };

  // 切换资源：销毁旧资源后加载新资源
  const switchResource = async (newResource: ResourceItem) => {
    setIsLoading(true);
    setError(null);
    setIsLoaded(false);
    onLoadStatusChange?.(false);

    try {
      // 销毁旧的资源
      await maaService.destroyResource(instanceId);
      
      // 加载新资源
      await loadResource(newResource);
    } catch (err) {
      setError(err instanceof Error ? err.message : '切换资源失败');
      setIsLoading(false);
      lastLoadedResourceRef.current = null;
    }
  };

  // 处理资源选择变更
  const handleResourceSelect = async (resource: ResourceItem) => {
    setShowDropdown(false);
    
    // 如果选择的是同一个资源且已加载，不做任何操作
    if (resource.name === lastLoadedResourceRef.current && isLoaded) {
      onResourceChange?.(resource.name);
      return;
    }
    
    // 更新选中状态
    onResourceChange?.(resource.name);
    
    // 如果之前已加载过资源，需要先销毁再加载
    if (lastLoadedResourceRef.current !== null) {
      await switchResource(resource);
    } else {
      // 首次加载
      await loadResource(resource);
    }
  };

  // 获取资源显示名称
  const getResourceDisplayName = (resource: ResourceItem) => {
    return resolveI18nText(resource.label, translations) || resource.name;
  };

  // 是否禁用下拉框（正在加载或任务运行中）
  const isDisabled = isLoading || isRunning;

  return (
    <div className="space-y-3">
      {/* 标题 */}
      <div className="flex items-center gap-2 text-sm text-text-secondary">
        <FolderOpen className="w-4 h-4" />
        <span>{t('resource.title')}</span>
        {isLoading && (
          <span className="flex items-center gap-1 text-accent text-xs">
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('resource.loading')}
          </span>
        )}
        {!isLoading && isLoaded && (
          <span className="flex items-center gap-1 text-green-500 text-xs">
            <CheckCircle className="w-3 h-3" />
            {t('resource.loaded')}
          </span>
        )}
      </div>

      {/* 资源选择下拉框 */}
      <div className="relative">
        <button
          ref={dropdownRef}
          onClick={() => {
            if (isDisabled) return;
            if (!showDropdown) {
              setDropdownPos(calcDropdownPosition());
            }
            setShowDropdown(!showDropdown);
          }}
          disabled={isDisabled}
          className={clsx(
            'w-full flex items-center justify-between px-3 py-2.5 rounded-lg border transition-colors',
            'bg-bg-tertiary border-border',
            isDisabled
              ? 'opacity-60 cursor-not-allowed'
              : 'hover:border-accent cursor-pointer'
          )}
        >
          <span className={clsx(
            'truncate',
            selectedResource ? 'text-text-primary' : 'text-text-muted'
          )}>
            {selectedResource
              ? getResourceDisplayName(selectedResource)
              : t('resource.selectResource')}
          </span>
          <ChevronDown className={clsx(
            'w-4 h-4 text-text-muted transition-transform',
            showDropdown && 'rotate-180'
          )} />
        </button>

        {/* 下拉菜单 - 使用 fixed 定位避免被父容器裁剪 */}
        {showDropdown && dropdownPos && (
          <div
            ref={menuRef}
            className="fixed z-[100] bg-bg-secondary border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto"
            style={{
              top: dropdownPos.top,
              left: dropdownPos.left,
              width: dropdownPos.width,
            }}
          >
            {resources.map(resource => (
              <button
                key={resource.name}
                onClick={() => handleResourceSelect(resource)}
                className={clsx(
                  'w-full flex items-center justify-between px-3 py-2 text-left transition-colors',
                  'hover:bg-bg-hover',
                  selectedResource?.name === resource.name && 'bg-accent/10'
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary truncate">
                    {getResourceDisplayName(resource)}
                  </div>
                  {resource.description && (
                    <div className="text-xs text-text-muted truncate">
                      {resolveI18nText(resource.description, translations)}
                    </div>
                  )}
                </div>
                {selectedResource?.name === resource.name && (
                  <Check className="w-4 h-4 text-accent flex-shrink-0 ml-2" />
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-red-500 text-sm">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}
