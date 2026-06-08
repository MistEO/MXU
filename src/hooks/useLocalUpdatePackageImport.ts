import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import {
  importLocalUpdatePackage,
  LocalUpdatePackageError,
  getSupportedUpdatePackageExtensions,
  savePendingUpdateInfo,
  isDebugVersion,
} from '@/services/updateService';
import { loggers } from '@/utils/logger';

export function useLocalUpdatePackageImport() {
  const { t } = useTranslation();
  const {
    projectInterface,
    downloadStatus,
    installStatus,
    updateCheckLoading,
    setUpdateInfo,
    setUpdateCheckLoading,
    setDownloadStatus,
    setDownloadProgress,
    setDownloadSavePath,
    setShowInstallConfirmModal,
  } = useAppStore();

  const getErrorMessage = useCallback(
    (error: unknown) => {
      if (error instanceof LocalUpdatePackageError) {
        return t(`mirrorChyan.localPackageErrors.${error.code}`);
      }
      return error instanceof Error ? error.message : t('mirrorChyan.localPackageErrors.checkFailed');
    },
    [t],
  );

  const disabledReason =
    !projectInterface?.mirrorchyan_rid || !projectInterface?.version || !projectInterface?.name
      ? 'missingProjectInfo'
      : import.meta.env.DEV || isDebugVersion(projectInterface.version)
        ? 'debugMode'
        : updateCheckLoading || downloadStatus === 'downloading' || installStatus === 'installing'
          ? 'busy'
          : null;

  const importPackage = useCallback(
    async (filePath: string) => {
      if (disabledReason) {
        toast.error(t(`mirrorChyan.localPackageErrors.${disabledReason}`));
        return;
      }

      const toastId = toast.loading(t('mirrorChyan.verifyingLocalPackage'));
      setUpdateCheckLoading(true);

      try {
        const updateInfo = await importLocalUpdatePackage({
          filePath,
          projectInterface,
        });

        setUpdateInfo(updateInfo);
        setDownloadSavePath(filePath);
        setDownloadProgress({
          downloadedSize: updateInfo.fileSize || 0,
          totalSize: updateInfo.fileSize || 0,
          speed: 0,
          progress: 100,
        });
        setDownloadStatus('completed');
        savePendingUpdateInfo({
          versionName: updateInfo.versionName,
          releaseNote: updateInfo.releaseNote,
          channel: updateInfo.channel,
          downloadSavePath: filePath,
          fileSize: updateInfo.fileSize,
          updateType: updateInfo.updateType,
          downloadSource: updateInfo.downloadSource,
          timestamp: Date.now(),
        });
        setShowInstallConfirmModal(true);
        toast.success(t('mirrorChyan.localPackageReady', { version: updateInfo.versionName }), {
          id: toastId,
        });
      } catch (error) {
        loggers.ui.error('Local update package import failed:', error);
        toast.error(getErrorMessage(error), { id: toastId });
      } finally {
        setUpdateCheckLoading(false);
      }
    },
    [
      projectInterface,
      setUpdateInfo,
      setUpdateCheckLoading,
      setDownloadStatus,
      setDownloadProgress,
      setDownloadSavePath,
      setShowInstallConfirmModal,
      getErrorMessage,
      t,
      disabledReason,
    ],
  );

  return {
    importPackage,
    supportedExtensions: getSupportedUpdatePackageExtensions(),
    disabled: disabledReason !== null,
    disabledReason,
  };
}
