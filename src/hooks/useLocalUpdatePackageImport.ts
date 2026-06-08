import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import {
  importLocalUpdatePackage,
  LocalUpdatePackageError,
  getSupportedUpdatePackageExtensions,
  savePendingUpdateInfo,
} from '@/services/updateService';
import { loggers } from '@/utils/logger';

export function useLocalUpdatePackageImport() {
  const { t } = useTranslation();
  const {
    projectInterface,
    mirrorChyanSettings,
    downloadStatus,
    installStatus,
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

  const importPackage = useCallback(
    async (filePath: string) => {
      const toastId = toast.loading(t('mirrorChyan.verifyingLocalPackage'));
      setUpdateCheckLoading(true);

      try {
        const updateInfo = await importLocalUpdatePackage({
          filePath,
          projectInterface,
          cdk: mirrorChyanSettings.cdk || undefined,
          channel: mirrorChyanSettings.channel,
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
      mirrorChyanSettings.cdk,
      mirrorChyanSettings.channel,
      setUpdateInfo,
      setUpdateCheckLoading,
      setDownloadStatus,
      setDownloadProgress,
      setDownloadSavePath,
      setShowInstallConfirmModal,
      getErrorMessage,
      t,
    ],
  );

  const importSinglePackage = useCallback(
    async (filePaths: string[]) => {
      if (filePaths.length !== 1) {
        toast.error(t('mirrorChyan.localPackageErrors.multipleFiles'));
        return;
      }
      await importPackage(filePaths[0]);
    },
    [importPackage, t],
  );

  return {
    importPackage,
    importSinglePackage,
    supportedExtensions: getSupportedUpdatePackageExtensions(),
    disabled: downloadStatus === 'downloading' || installStatus === 'installing',
  };
}
