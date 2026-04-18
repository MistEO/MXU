import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { maaService } from '@/services/maaService';
import { useAppStore } from '@/stores/appStore';
import { resolveI18nText } from '@/services/contentResolver';
import { isDebugVersion } from '@/services/updateService';
import type { ResourceItem, ControllerItem } from '@/types/interface';
import { startGlobalCallbackListener, waitForResResult } from './callbackCache';
import { computeBaseResourcePaths, computeAttachResourcePaths } from '@/utils/resourcePath';

interface UseResourceLoadingProps {
  instanceId: string;
  basePath: string;
  translations: Record<string, string>;
  currentController?: ControllerItem;
}

export function useResourceLoading({
  instanceId,
  basePath,
  translations,
  currentController,
}: UseResourceLoadingProps) {
  const { t } = useTranslation();
  const { setInstanceResourceLoaded, registerResIdName, registerResBatch, addLog } = useAppStore();

  const [isLoadingResource, setIsLoadingResource] = useState(false);
  const [isResourceLoaded, setIsResourceLoaded] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [showResourceDropdown, setShowResourceDropdown] = useState(false);

  const lastLoadedResourceRef = useRef<string | null>(null);
  const resourceDropdownRef = useRef<HTMLButtonElement>(null);
  const resourceMenuRef = useRef<HTMLDivElement>(null);

  const loadResourceInternal = useCallback(
    async (resource: ResourceItem) => {
      setIsLoadingResource(true);
      setResourceError(null);

      try {
        await maaService.createInstance(instanceId).catch(() => {});
        await startGlobalCallbackListener();

        const resourceDisplayName = resolveI18nText(resource.label, translations) || resource.name;

        // Phase 1: load resource.path
        const basePaths = computeBaseResourcePaths(resource, basePath);
        const baseResIds = await maaService.loadResource(instanceId, basePaths);

        registerResBatch(baseResIds);
        baseResIds.forEach((resId) => {
          registerResIdName(resId, resourceDisplayName);
        });

        if (baseResIds.length === 0) {
          setResourceError(t('resource.loadFailed'));
          setIsLoadingResource(false);
          return false;
        }

        const baseResults = await Promise.all(baseResIds.map((resId) => waitForResResult(resId)));
        if (baseResults.some((r) => r === 'failed')) {
          setResourceError(t('resource.loadFailed'));
          setIsResourceLoaded(false);
          setInstanceResourceLoaded(instanceId, false);
          setIsLoadingResource(false);
          lastLoadedResourceRef.current = null;
          return false;
        }

        // Hash check: after base resource loaded, before attach
        if (resource.hash) {
          const piVersion = useAppStore.getState().projectInterface?.version;
          const skipCheck = import.meta.env.DEV || isDebugVersion(piVersion);
          if (!skipCheck) {
            try {
              const actualHash = await maaService.getResourceHash(instanceId);
              if (actualHash && actualHash !== resource.hash) {
                addLog(instanceId, {
                  type: 'warning',
                  message: t('resource.hashMismatch', {
                    expected: resource.hash,
                    actual: actualHash,
                  }),
                });
              }
            } catch {
              // hash check is best-effort
            }
          }
        }

        // Phase 2: load controller.attach_resource_path
        const attachPaths = computeAttachResourcePaths(currentController, basePath);
        if (attachPaths.length > 0) {
          const attachResIds = await maaService.loadResource(instanceId, attachPaths);
          registerResBatch(attachResIds);
          attachResIds.forEach((resId) => {
            registerResIdName(resId, resourceDisplayName);
          });

          if (attachResIds.length > 0) {
            const attachResults = await Promise.all(
              attachResIds.map((resId) => waitForResResult(resId)),
            );
            if (attachResults.some((r) => r === 'failed')) {
              setResourceError(t('resource.loadFailed'));
              setIsResourceLoaded(false);
              setInstanceResourceLoaded(instanceId, false);
              setIsLoadingResource(false);
              lastLoadedResourceRef.current = null;
              return false;
            }
          }
        }

        lastLoadedResourceRef.current = resource.name;
        setIsResourceLoaded(true);
        setInstanceResourceLoaded(instanceId, true);
        setIsLoadingResource(false);
        return true;
      } catch (err) {
        setResourceError(err instanceof Error ? err.message : t('resource.loadFailed'));
        setIsResourceLoaded(false);
        setInstanceResourceLoaded(instanceId, false);
        setIsLoadingResource(false);
        lastLoadedResourceRef.current = null;
        return false;
      }
    },
    [
      instanceId,
      basePath,
      translations,
      currentController,
      setInstanceResourceLoaded,
      registerResIdName,
      registerResBatch,
      addLog,
      t,
    ],
  );

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
