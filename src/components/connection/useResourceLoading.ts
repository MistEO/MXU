import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { maaService } from '@/services/maaService';
import { useAppStore } from '@/stores/appStore';
import { resolveI18nText } from '@/services/contentResolver';
import type { ResourceItem } from '@/types/interface';
import { waitForResResult } from './callbackCache';

interface UseResourceLoadingProps {
  instanceId: string;
  basePath: string;
  translations: Record<string, string>;
}

export function useResourceLoading({
  instanceId,
  basePath,
  translations,
}: UseResourceLoadingProps) {
  const { t } = useTranslation();
  const { setInstanceResourceLoaded, registerResIdName } = useAppStore();

  const [isLoadingResource, setIsLoadingResource] = useState(false);
  const [isResourceLoaded, setIsResourceLoaded] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [showResourceDropdown, setShowResourceDropdown] = useState(false);

  const lastLoadedResourceRef = useRef<string | null>(null);
  const resourceDropdownRef = useRef<HTMLButtonElement>(null);
  const resourceMenuRef = useRef<HTMLDivElement>(null);

  // 加载资源内部实现
  const loadResourceInternal = useCallback(
    async (resource: ResourceItem) => {
      setIsLoadingResource(true);
      setResourceError(null);

      try {
        await maaService.createInstance(instanceId).catch(() => {});

        const resourcePaths = resource.path.map((p) => {
          const cleanPath = p.replace(/^\.\//, '').replace(/^\.\\/, '');
          return `${basePath}/${cleanPath}`;
        });

        const resIds = await maaService.loadResource(instanceId, resourcePaths);

        const resourceDisplayName = resolveI18nText(resource.label, translations) || resource.name;
        resIds.forEach((resId) => {
          registerResIdName(resId, resourceDisplayName);
        });

        if (resIds.length === 0) {
          setResourceError(t('resource.loadFailed'));
          setIsLoadingResource(false);
          return false;
        }

        lastLoadedResourceRef.current = resource.name;

        const results = await Promise.all(resIds.map((resId) => waitForResResult(resId)));

        const hasFailed = results.some((r) => r === 'failed');

        if (hasFailed) {
          setResourceError(t('resource.loadFailed'));
          setIsResourceLoaded(false);
          setInstanceResourceLoaded(instanceId, false);
          setIsLoadingResource(false);
          lastLoadedResourceRef.current = null;
          return false;
        } else {
          setIsResourceLoaded(true);
          setInstanceResourceLoaded(instanceId, true);
          setIsLoadingResource(false);
          return true;
        }
      } catch (err) {
        setResourceError(err instanceof Error ? err.message : t('resource.loadFailed'));
        setIsResourceLoaded(false);
        setInstanceResourceLoaded(instanceId, false);
        setIsLoadingResource(false);
        lastLoadedResourceRef.current = null;
        return false;
      }
    },
    [instanceId, basePath, translations, setInstanceResourceLoaded, registerResIdName, t],
  );

  // 切换资源：销毁旧资源后加载新资源
  const switchResource = useCallback(
    async (newResource: ResourceItem) => {
      setIsLoadingResource(true);
      setResourceError(null);
      setIsResourceLoaded(false);
      setInstanceResourceLoaded(instanceId, false);

      try {
        await maaService.destroyResource(instanceId);
        return await loadResourceInternal(newResource);
      } catch (err) {
        setResourceError(err instanceof Error ? err.message : t('resource.switchFailed'));
        setIsLoadingResource(false);
        lastLoadedResourceRef.current = null;
        return false;
      }
    },
    [instanceId, loadResourceInternal, setInstanceResourceLoaded, t],
  );

  // 处理资源选择
  const handleResourceSelect = useCallback(
    async (resource: ResourceItem, isRunning: boolean) => {
      setShowResourceDropdown(false);

      if (isRunning) {
        setResourceError(t('resource.cannotSwitchWhileRunning'));
        return false;
      }

      if (resource.name === lastLoadedResourceRef.current && isResourceLoaded) {
        return true;
      }

      if (lastLoadedResourceRef.current !== null) {
        return await switchResource(resource);
      } else {
        return await loadResourceInternal(resource);
      }
    },
    [isResourceLoaded, loadResourceInternal, switchResource, t],
  );

  // 获取资源显示名称
  const getResourceDisplayName = useCallback(
    (resource: ResourceItem) => {
      return resolveI18nText(resource.label, translations) || resource.name;
    },
    [translations],
  );

  return {
    // 状态
    isLoadingResource,
    isResourceLoaded,
    resourceError,
    showResourceDropdown,
    lastLoadedResourceRef,
    // Refs
    resourceDropdownRef,
    resourceMenuRef,
    // Setters
    setIsLoadingResource,
    setIsResourceLoaded,
    setResourceError,
    setShowResourceDropdown,
    // Actions
    loadResourceInternal,
    switchResource,
    handleResourceSelect,
    getResourceDisplayName,
  };
}
