import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { maaService } from '@/services/maaService';
import { useAppStore } from '@/stores/appStore';
import type { AdbDevice, Win32Window, ControllerConfig } from '@/types/maa';
import { parseWin32ScreencapMethod, parseWin32InputMethod } from '@/types/maa';
import type { ControllerItem } from '@/types/interface';
import { waitForCtrlResult } from './callbackCache';

interface UseDeviceConnectionProps {
  instanceId: string;
  currentController: ControllerItem | undefined;
  controllerType: string | undefined;
}

export function useDeviceConnection({
  instanceId,
  currentController,
  controllerType,
}: UseDeviceConnectionProps) {
  const { t } = useTranslation();
  const {
    cachedAdbDevices,
    cachedWin32Windows,
    setCachedAdbDevices,
    setCachedWin32Windows,
    setInstanceConnectionStatus,
    setInstanceSavedDevice,
    registerCtrlIdName,
    instances,
  } = useAppStore();

  const activeInstance = instances.find((i) => i.id === instanceId);

  const [isSearching, setIsSearching] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [selectedAdbDevice, setSelectedAdbDevice] = useState<AdbDevice | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<Win32Window | null>(null);
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  const [playcoverAddress, setPlaycoverAddress] = useState(
    activeInstance?.savedDevice?.playcoverAddress || '127.0.0.1:1717',
  );

  const deviceDropdownRef = useRef<HTMLButtonElement>(null);
  const deviceMenuRef = useRef<HTMLDivElement>(null);

  // 初始化 MaaFramework
  const ensureMaaInitialized = async () => {
    try {
      await maaService.getVersion();
      return true;
    } catch {
      await maaService.init();
      return true;
    }
  };

  // 连接控制器的内部实现
  const connectControllerInternal = useCallback(
    async (config: ControllerConfig, deviceName: string, targetType: 'device' | 'window') => {
      const ctrlId = await maaService.connectController(instanceId, config);

      registerCtrlIdName(ctrlId, deviceName || '', targetType);

      const result = await waitForCtrlResult(ctrlId);

      if (result === 'succeeded') {
        setIsConnected(true);
        setInstanceConnectionStatus(instanceId, 'Connected');
        setIsConnecting(false);
        return true;
      } else {
        setDeviceError(t('controller.connectionFailed'));
        setIsConnected(false);
        setInstanceConnectionStatus(instanceId, 'Disconnected');
        setIsConnecting(false);
        return false;
      }
    },
    [instanceId, registerCtrlIdName, setInstanceConnectionStatus, t],
  );

  // 搜索设备
  const handleSearch = useCallback(async () => {
    if (!currentController) return;

    setIsSearching(true);
    setDeviceError(null);

    try {
      const initialized = await ensureMaaInitialized();
      if (!initialized) {
        throw new Error(t('maa.initFailed'));
      }

      const savedDevice = activeInstance?.savedDevice;

      if (controllerType === 'Adb') {
        const devices = await maaService.findAdbDevices();
        setCachedAdbDevices(devices);

        let autoSelected: AdbDevice | null = null;
        if (savedDevice?.adbDeviceName) {
          const matched = devices.filter((d) => d.name === savedDevice.adbDeviceName);
          if (matched.length === 1) {
            autoSelected = matched[0];
          }
        } else if (devices.length > 0) {
          autoSelected = devices[0];
        }

        if (autoSelected) {
          handleSelectAdbDevice(autoSelected);
        } else if (devices.length > 0) {
          setShowDeviceDropdown(true);
        }
      } else if (controllerType === 'Win32' || controllerType === 'Gamepad') {
        const classRegex =
          currentController.win32?.class_regex || currentController.gamepad?.class_regex;
        const windowRegex =
          currentController.win32?.window_regex || currentController.gamepad?.window_regex;
        const windows = await maaService.findWin32Windows(classRegex, windowRegex);
        setCachedWin32Windows(windows);

        let autoSelected: Win32Window | null = null;
        if (savedDevice?.windowName) {
          const matched = windows.filter((w) => w.window_name === savedDevice.windowName);
          if (matched.length === 1) {
            autoSelected = matched[0];
          }
        } else if (windows.length > 0) {
          autoSelected = windows[0];
        }

        if (autoSelected) {
          handleSelectWindow(autoSelected);
        } else if (windows.length > 0) {
          setShowDeviceDropdown(true);
        }
      }
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
    } finally {
      setIsSearching(false);
    }
  }, [
    currentController,
    controllerType,
    activeInstance?.savedDevice,
    setCachedAdbDevices,
    setCachedWin32Windows,
    t,
  ]);

  // 选择 ADB 设备并自动连接
  const handleSelectAdbDevice = useCallback(
    async (device: AdbDevice) => {
      setSelectedAdbDevice(device);
      setShowDeviceDropdown(false);

      setInstanceSavedDevice(instanceId, { adbDeviceName: device.name });

      setIsConnecting(true);
      setDeviceError(null);

      try {
        if (isConnected) {
          await maaService.destroyInstance(instanceId).catch(() => {});
          setIsConnected(false);
        }

        const initialized = await ensureMaaInitialized();
        if (!initialized) {
          throw new Error(t('maa.initFailed'));
        }

        await maaService.createInstance(instanceId).catch(() => {});

        const config: ControllerConfig = {
          type: 'Adb',
          adb_path: device.adb_path,
          address: device.address,
          screencap_methods: device.screencap_methods,
          input_methods: device.input_methods,
          config: device.config,
        };

        await connectControllerInternal(config, device.name || device.address, 'device');
      } catch (err) {
        setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
        setIsConnected(false);
        setInstanceConnectionStatus(instanceId, 'Disconnected');
        setIsConnecting(false);
      }
    },
    [
      instanceId,
      isConnected,
      setInstanceSavedDevice,
      setInstanceConnectionStatus,
      connectControllerInternal,
      t,
    ],
  );

  // 选择 Win32 窗口并自动连接
  const handleSelectWindow = useCallback(
    async (win: Win32Window) => {
      setSelectedWindow(win);
      setShowDeviceDropdown(false);

      setInstanceSavedDevice(instanceId, { windowName: win.window_name });

      setIsConnecting(true);
      setDeviceError(null);

      try {
        if (isConnected) {
          await maaService.destroyInstance(instanceId).catch(() => {});
          setIsConnected(false);
        }

        const initialized = await ensureMaaInitialized();
        if (!initialized) {
          throw new Error(t('maa.initFailed'));
        }

        await maaService.createInstance(instanceId).catch(() => {});

        let config: ControllerConfig;
        if (controllerType === 'Win32') {
          config = {
            type: 'Win32',
            handle: win.handle,
            screencap_method: parseWin32ScreencapMethod(currentController?.win32?.screencap || ''),
            mouse_method: parseWin32InputMethod(currentController?.win32?.mouse || ''),
            keyboard_method: parseWin32InputMethod(currentController?.win32?.keyboard || ''),
          };
        } else {
          config = {
            type: 'Gamepad',
            handle: win.handle,
          };
        }

        await connectControllerInternal(config, win.window_name || win.class_name, 'window');
      } catch (err) {
        setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
        setIsConnected(false);
        setInstanceConnectionStatus(instanceId, 'Disconnected');
        setIsConnecting(false);
      }
    },
    [
      instanceId,
      isConnected,
      controllerType,
      currentController,
      setInstanceSavedDevice,
      setInstanceConnectionStatus,
      connectControllerInternal,
      t,
    ],
  );

  // PlayCover 连接
  const handleConnectPlayCover = useCallback(async () => {
    setIsConnecting(true);
    setDeviceError(null);

    try {
      const initialized = await ensureMaaInitialized();
      if (!initialized) {
        throw new Error(t('maa.initFailed'));
      }

      await maaService.createInstance(instanceId).catch(() => {});

      setInstanceSavedDevice(instanceId, { playcoverAddress });

      const config: ControllerConfig = {
        type: 'PlayCover',
        address: playcoverAddress,
      };

      await connectControllerInternal(config, playcoverAddress, 'device');
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
      setIsConnected(false);
      setInstanceConnectionStatus(instanceId, 'Disconnected');
      setIsConnecting(false);
    }
  }, [
    instanceId,
    playcoverAddress,
    setInstanceSavedDevice,
    setInstanceConnectionStatus,
    connectControllerInternal,
    t,
  ]);

  // 获取选中设备的显示文本
  const getSelectedDeviceText = useCallback(() => {
    const savedDevice = activeInstance?.savedDevice;

    if (controllerType === 'Adb') {
      if (selectedAdbDevice) {
        return `${selectedAdbDevice.name} (${selectedAdbDevice.address})`;
      }
      if (savedDevice?.adbDeviceName) {
        return savedDevice.adbDeviceName;
      }
      return t('controller.selectDevice');
    }
    if (controllerType === 'Win32' || controllerType === 'Gamepad') {
      if (selectedWindow) {
        return selectedWindow.window_name || selectedWindow.class_name;
      }
      if (savedDevice?.windowName) {
        return savedDevice.windowName;
      }
      return t('controller.selectWindow');
    }
    return t('controller.selectDevice');
  }, [controllerType, selectedAdbDevice, selectedWindow, activeInstance?.savedDevice, t]);

  // 判断是否可以连接
  const canConnect = useCallback(() => {
    if (controllerType === 'Adb') return !!selectedAdbDevice;
    if (controllerType === 'Win32' || controllerType === 'Gamepad') return !!selectedWindow;
    if (controllerType === 'PlayCover') return playcoverAddress.trim().length > 0;
    return false;
  }, [controllerType, selectedAdbDevice, selectedWindow, playcoverAddress]);

  return {
    // 状态
    isSearching,
    isConnecting,
    isConnected,
    deviceError,
    selectedAdbDevice,
    selectedWindow,
    showDeviceDropdown,
    playcoverAddress,
    cachedAdbDevices,
    cachedWin32Windows,
    // Refs
    deviceDropdownRef,
    deviceMenuRef,
    // Setters
    setIsConnected,
    setIsConnecting,
    setDeviceError,
    setSelectedAdbDevice,
    setSelectedWindow,
    setShowDeviceDropdown,
    setPlaycoverAddress,
    // Actions
    handleSearch,
    handleSelectAdbDevice,
    handleSelectWindow,
    handleConnectPlayCover,
    getSelectedDeviceText,
    canConnect,
    ensureMaaInitialized,
    connectControllerInternal,
  };
}
