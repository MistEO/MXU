import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  Smartphone,
  Monitor,
  Apple,
  Gamepad2,
  FolderOpen,
  RefreshCw,
  Loader2,
  Check,
  AlertCircle,
  Wifi,
  WifiOff,
  CheckCircle,
  Settings2,
} from 'lucide-react';
import clsx from 'clsx';
import { maaService } from '@/services/maaService';
import { useAppStore } from '@/stores/appStore';
import { resolveI18nText } from '@/services/contentResolver';
import type { AdbDevice, Win32Window, ControllerConfig } from '@/types/maa';
import type { ControllerItem, ResourceItem } from '@/types/interface';
import { parseWin32ScreencapMethod, parseWin32InputMethod } from '@/types/maa';

export function ConnectionPanel() {
  const { t } = useTranslation();
  const {
    projectInterface,
    basePath,
    language,
    interfaceTranslations,
    activeInstanceId,
    instances,
    cachedAdbDevices,
    cachedWin32Windows,
    setCachedAdbDevices,
    setCachedWin32Windows,
    selectedController,
    selectedResource,
    setSelectedController,
    setSelectedResource,
    instanceConnectionStatus,
    instanceResourceLoaded,
    setInstanceConnectionStatus,
    setInstanceResourceLoaded,
    setInstanceSavedDevice,
    connectionPanelExpanded,
    setConnectionPanelExpanded,
  } = useAppStore();
  
  // 获取当前活动实例
  const activeInstance = instances.find(i => i.id === activeInstanceId);
  
  // 获取当前实例的连接和资源状态（从 store）
  const storedConnectionStatus = activeInstanceId ? instanceConnectionStatus[activeInstanceId] : undefined;
  const storedResourceLoaded = activeInstanceId ? instanceResourceLoaded[activeInstanceId] : false;

  // 设备相关状态
  const [isSearching, setIsSearching] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [selectedAdbDevice, setSelectedAdbDevice] = useState<AdbDevice | null>(null);
  const [selectedWindow, setSelectedWindow] = useState<Win32Window | null>(null);
  const [showDeviceDropdown, setShowDeviceDropdown] = useState(false);
  // PlayCover 地址从保存的配置初始化
  const [playcoverAddress, setPlaycoverAddress] = useState(
    activeInstance?.savedDevice?.playcoverAddress || '127.0.0.1:1717'
  );

  // 资源相关状态
  const [isLoadingResource, setIsLoadingResource] = useState(false);
  const [isResourceLoaded, setIsResourceLoaded] = useState(false);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [showResourceDropdown, setShowResourceDropdown] = useState(false);
  
  // 等待中的操作 ID（用于回调匹配）
  const [pendingCtrlId, setPendingCtrlId] = useState<number | null>(null);
  const [pendingResIds, setPendingResIds] = useState<Set<number>>(new Set());

  const langKey = language === 'zh-CN' ? 'zh_cn' : 'en_us';
  const translations = interfaceTranslations[langKey];

  // 获取当前实例 ID
  const instanceId = activeInstanceId || '';

  // 获取控制器列表和当前选中的控制器
  const controllers = projectInterface?.controller || [];
  const currentControllerName = selectedController[instanceId] || controllers[0]?.name;
  const currentController = controllers.find(c => c.name === currentControllerName) || controllers[0];
  const controllerType = currentController?.type;

  // 获取资源列表和当前选中的资源
  const resources = projectInterface?.resource || [];
  const currentResourceName = selectedResource[instanceId] || resources[0]?.name;
  const currentResource = resources.find(r => r.name === currentResourceName) || resources[0];

  // 当设备和资源都准备好时自动折叠
  useEffect(() => {
    if (isConnected && isResourceLoaded) {
      setConnectionPanelExpanded(false);
    }
  }, [isConnected, isResourceLoaded, setConnectionPanelExpanded]);
  
  // 当实例切换时，重置和恢复状态
  useEffect(() => {
    // 从 store 恢复连接状态
    const isInstanceConnected = storedConnectionStatus === 'Connected';
    const isInstanceResourceLoaded = storedResourceLoaded;
    
    setIsConnected(isInstanceConnected);
    setIsResourceLoaded(isInstanceResourceLoaded);
    
    // 重置临时状态
    setIsSearching(false);
    setIsConnecting(false);
    setIsLoadingResource(false);
    setDeviceError(null);
    setResourceError(null);
    setShowDeviceDropdown(false);
    setShowResourceDropdown(false);
    
    // 从缓存的设备列表中恢复选中的设备
    const savedDevice = activeInstance?.savedDevice;
    if (savedDevice?.adbDeviceName && cachedAdbDevices.length > 0) {
      // 从缓存中找到匹配的 ADB 设备
      const matchedDevice = cachedAdbDevices.find(d => d.name === savedDevice.adbDeviceName);
      setSelectedAdbDevice(matchedDevice || null);
    } else {
      setSelectedAdbDevice(null);
    }
    
    if (savedDevice?.windowName && cachedWin32Windows.length > 0) {
      // 从缓存中找到匹配的窗口
      const matchedWindow = cachedWin32Windows.find(w => w.window_name === savedDevice.windowName);
      setSelectedWindow(matchedWindow || null);
    } else {
      setSelectedWindow(null);
    }
    
    // 恢复 PlayCover 地址
    if (savedDevice?.playcoverAddress) {
      setPlaycoverAddress(savedDevice.playcoverAddress);
    } else {
      setPlaycoverAddress('127.0.0.1:1717');
    }
    
    // 如果已连接但未展开，自动折叠
    if (isInstanceConnected && isInstanceResourceLoaded) {
      setConnectionPanelExpanded(false);
    } else {
      setConnectionPanelExpanded(true);
    }
  }, [activeInstanceId]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // 监听 MaaFramework 回调事件，处理连接和资源加载完成
  useEffect(() => {
    // 没有等待中的操作，不需要监听
    if (pendingCtrlId === null && pendingResIds.size === 0) return;
    
    let unlisten: (() => void) | null = null;
    
    maaService.onCallback((message, details) => {
      // 处理控制器连接回调
      if (pendingCtrlId !== null && details.ctrl_id === pendingCtrlId) {
        if (message === 'Controller.Action.Succeeded') {
          setIsConnected(true);
          setInstanceConnectionStatus(instanceId, 'Connected');
          setIsConnecting(false);
          setPendingCtrlId(null);
        } else if (message === 'Controller.Action.Failed') {
          setDeviceError(t('controller.connectionFailed'));
          setIsConnected(false);
          setInstanceConnectionStatus(instanceId, 'Disconnected');
          setIsConnecting(false);
          setPendingCtrlId(null);
        }
      }
      
      // 处理资源加载回调
      if (pendingResIds.size > 0 && details.res_id !== undefined) {
        if (message === 'Resource.Loading.Succeeded') {
          setPendingResIds(prev => {
            const next = new Set(prev);
            next.delete(details.res_id!);
            // 所有资源都加载完成
            if (next.size === 0) {
              setIsResourceLoaded(true);
              setInstanceResourceLoaded(instanceId, true);
              setIsLoadingResource(false);
            }
            return next;
          });
        } else if (message === 'Resource.Loading.Failed') {
          setResourceError(t('resource.loadFailed'));
          setIsResourceLoaded(false);
          setInstanceResourceLoaded(instanceId, false);
          setIsLoadingResource(false);
          setPendingResIds(new Set());
        }
      }
    }).then(fn => {
      unlisten = fn;
    });
    
    return () => {
      if (unlisten) unlisten();
    };
  }, [pendingCtrlId, pendingResIds, instanceId, setInstanceConnectionStatus, setInstanceResourceLoaded, t]);

  // 判断是否需要搜索设备（PlayCover 不需要搜索）
  const needsDeviceSearch = controllerType === 'Adb' || controllerType === 'Win32' || controllerType === 'Gamepad';

  // 初始化 MaaFramework
  const ensureMaaInitialized = async () => {
    try {
      await maaService.getVersion();
      return true;
    } catch {
      // 未初始化，使用默认路径初始化（exe 目录下的 maafw）
      await maaService.init();
      return true;
    }
  };

  // 搜索设备
  const handleSearch = async () => {
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
        
        // 尝试自动匹配保存的设备名称
        let autoSelected: AdbDevice | null = null;
        if (savedDevice?.adbDeviceName) {
          const matched = devices.filter(d => d.name === savedDevice.adbDeviceName);
          if (matched.length === 1) {
            autoSelected = matched[0];
          }
        }
        
        if (autoSelected) {
          // 自动选中并连接
          handleSelectAdbDevice(autoSelected);
        } else if (devices.length === 1) {
          setSelectedAdbDevice(devices[0]);
          setShowDeviceDropdown(true);
        } else if (devices.length > 0) {
          setShowDeviceDropdown(true);
        }
      } else if (controllerType === 'Win32' || controllerType === 'Gamepad') {
        const classRegex = currentController.win32?.class_regex || currentController.gamepad?.class_regex;
        const windowRegex = currentController.win32?.window_regex || currentController.gamepad?.window_regex;
        const windows = await maaService.findWin32Windows(classRegex, windowRegex);
        setCachedWin32Windows(windows);
        
        // 尝试自动匹配保存的窗口名称
        let autoSelected: Win32Window | null = null;
        if (savedDevice?.windowName) {
          const matched = windows.filter(w => w.window_name === savedDevice.windowName);
          if (matched.length === 1) {
            autoSelected = matched[0];
          }
        }
        
        if (autoSelected) {
          // 自动选中并连接
          handleSelectWindow(autoSelected);
        } else if (windows.length === 1) {
          setSelectedWindow(windows[0]);
          setShowDeviceDropdown(true);
        } else if (windows.length > 0) {
          setShowDeviceDropdown(true);
        }
      }
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
    } finally {
      setIsSearching(false);
    }
  };

  // 连接设备
  const handleConnect = async () => {
    if (!currentController) return;
    
    setIsConnecting(true);
    setDeviceError(null);

    try {
      const initialized = await ensureMaaInitialized();
      if (!initialized) {
        throw new Error(t('maa.initFailed'));
      }

      await maaService.createInstance(instanceId).catch(() => {});

      let config: ControllerConfig;

      if (controllerType === 'Adb' && selectedAdbDevice) {
        config = {
          type: 'Adb',
          adb_path: selectedAdbDevice.adb_path,
          address: selectedAdbDevice.address,
          screencap_methods: selectedAdbDevice.screencap_methods,
          input_methods: selectedAdbDevice.input_methods,
          config: selectedAdbDevice.config,
        };
      } else if (controllerType === 'Win32' && selectedWindow) {
        config = {
          type: 'Win32',
          handle: selectedWindow.handle,
          screencap_method: parseWin32ScreencapMethod(currentController.win32?.screencap || ''),
          mouse_method: parseWin32InputMethod(currentController.win32?.mouse || ''),
          keyboard_method: parseWin32InputMethod(currentController.win32?.keyboard || ''),
        };
      } else if (controllerType === 'PlayCover') {
        // 保存 PlayCover 地址到实例配置
        setInstanceSavedDevice(instanceId, { playcoverAddress });
        config = {
          type: 'PlayCover',
          address: playcoverAddress,
        };
      } else if (controllerType === 'Gamepad' && selectedWindow) {
        config = {
          type: 'Gamepad',
          handle: selectedWindow.handle,
        };
      } else {
        throw new Error(t('controller.selectDevice'));
      }

      const agentPath = `${basePath}/MaaAgentBinary`;
      const ctrlId = await maaService.connectController(instanceId, config, agentPath);
      
      // 记录等待中的 ctrl_id，后续由回调处理完成状态
      setPendingCtrlId(ctrlId);
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
      setIsConnected(false);
      setInstanceConnectionStatus(instanceId, 'Disconnected');
      setIsConnecting(false);
    }
  };

  // 加载资源
  const handleLoadResource = async () => {
    if (!currentResource) {
      setResourceError(t('resource.selectResource'));
      return;
    }

    setIsLoadingResource(true);
    setResourceError(null);

    try {
      await maaService.createInstance(instanceId).catch(() => {});
      // 拼接绝对路径，移除相对路径前缀 "./" 或 "."
      const resourcePaths = currentResource.path.map(p => {
        const cleanPath = p.replace(/^\.\//, '').replace(/^\.\\/, '');
        return `${basePath}/${cleanPath}`;
      });
      const resIds = await maaService.loadResource(instanceId, resourcePaths);
      
      // 记录等待中的 res_ids，后续由回调处理完成状态
      setPendingResIds(new Set(resIds));
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : t('resource.loadFailed'));
      setIsResourceLoaded(false);
      setInstanceResourceLoaded(instanceId, false);
      setIsLoadingResource(false);
    }
  };

  // 获取控制器图标
  const getControllerIcon = (type?: string) => {
    switch (type) {
      case 'Adb': return <Smartphone className="w-4 h-4" />;
      case 'Win32': return <Monitor className="w-4 h-4" />;
      case 'PlayCover': return <Apple className="w-4 h-4" />;
      case 'Gamepad': return <Gamepad2 className="w-4 h-4" />;
      default: return <Smartphone className="w-4 h-4" />;
    }
  };

  // 获取选中设备的显示文本
  const getSelectedDeviceText = () => {
    if (controllerType === 'Adb' && selectedAdbDevice) {
      return `${selectedAdbDevice.name} (${selectedAdbDevice.address})`;
    }
    if ((controllerType === 'Win32' || controllerType === 'Gamepad') && selectedWindow) {
      return selectedWindow.window_name || selectedWindow.class_name;
    }
    return t('controller.selectDevice');
  };

  // 选择 ADB 设备并自动连接（如已连接会先断开旧连接）
  const handleSelectAdbDevice = async (device: AdbDevice) => {
    setSelectedAdbDevice(device);
    setShowDeviceDropdown(false);
    
    // 保存设备名称到实例配置
    setInstanceSavedDevice(instanceId, { adbDeviceName: device.name });
    
    // 自动连接
    setIsConnecting(true);
    setDeviceError(null);
    
    try {
      // 先断开旧连接
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
      
      const agentPath = `${basePath}/MaaAgentBinary`;
      const ctrlId = await maaService.connectController(instanceId, config, agentPath);
      
      // 记录等待中的 ctrl_id，后续由回调处理完成状态
      setPendingCtrlId(ctrlId);
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
      setIsConnected(false);
      setInstanceConnectionStatus(instanceId, 'Disconnected');
      setIsConnecting(false);
    }
  };

  // 选择 Win32 窗口并自动连接（如已连接会先断开旧连接）
  const handleSelectWindow = async (win: Win32Window) => {
    setSelectedWindow(win);
    setShowDeviceDropdown(false);
    
    // 保存窗口名称到实例配置
    setInstanceSavedDevice(instanceId, { windowName: win.window_name });
    
    // 自动连接
    setIsConnecting(true);
    setDeviceError(null);
    
    try {
      // 先断开旧连接
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
      
      const agentPath = `${basePath}/MaaAgentBinary`;
      const ctrlId = await maaService.connectController(instanceId, config, agentPath);
      
      // 记录等待中的 ctrl_id，后续由回调处理完成状态
      setPendingCtrlId(ctrlId);
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
      setIsConnected(false);
      setInstanceConnectionStatus(instanceId, 'Disconnected');
      setIsConnecting(false);
    }
  };

  // 获取设备列表
  const getDeviceList = () => {
    if (controllerType === 'Adb') {
      return cachedAdbDevices.map(device => ({
        id: `${device.adb_path}:${device.address}`,
        name: device.name,
        description: device.address,
        selected: selectedAdbDevice?.address === device.address,
        onClick: () => handleSelectAdbDevice(device),
      }));
    }
    if (controllerType === 'Win32' || controllerType === 'Gamepad') {
      return cachedWin32Windows.map(window => ({
        id: String(window.handle),
        name: window.window_name || '(无标题)',
        description: window.class_name,
        selected: selectedWindow?.handle === window.handle,
        onClick: () => handleSelectWindow(window),
      }));
    }
    return [];
  };

  // 判断是否可以连接
  const canConnect = () => {
    if (controllerType === 'Adb') return !!selectedAdbDevice;
    if (controllerType === 'Win32' || controllerType === 'Gamepad') return !!selectedWindow;
    if (controllerType === 'PlayCover') return playcoverAddress.trim().length > 0;
    return false;
  };

  // 获取资源显示名称
  const getResourceDisplayName = (resource: ResourceItem) => {
    return resolveI18nText(resource.label, translations) || resource.name;
  };

  // 获取控制器显示名称
  const getControllerDisplayName = (controller: ControllerItem) => {
    return resolveI18nText(controller.label, translations) || controller.name;
  };

  const deviceList = getDeviceList();

  // 状态指示器
  const StatusIndicator = () => (
    <div className="flex items-center gap-2">
      {isConnecting ? (
        <span className="flex items-center gap-1 text-accent text-xs">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('controller.connecting')}
        </span>
      ) : isConnected ? (
        <span className="flex items-center gap-1 text-green-500 text-xs">
          <Wifi className="w-3 h-3" />
          {t('controller.connected')}
        </span>
      ) : (
        <span className="flex items-center gap-1 text-text-muted text-xs">
          <WifiOff className="w-3 h-3" />
          {t('controller.disconnected')}
        </span>
      )}
      {isResourceLoaded && (
        <span className="flex items-center gap-1 text-green-500 text-xs">
          <CheckCircle className="w-3 h-3" />
          {t('resource.loaded')}
        </span>
      )}
    </div>
  );

  if (!projectInterface || controllers.length === 0) {
    return null;
  }

  return (
    <div className="bg-bg-secondary rounded-lg border border-border">
      {/* 标题栏（可点击折叠） */}
      <button
        onClick={() => setConnectionPanelExpanded(!connectionPanelExpanded)}
        className={clsx(
          'w-full flex items-center justify-between px-3 py-2 hover:bg-bg-hover transition-colors',
          !connectionPanelExpanded ? 'rounded-lg' : 'rounded-t-lg border-b border-border'
        )}
      >
        <div className="flex items-center gap-2">
          <Settings2 className="w-4 h-4 text-text-secondary" />
          <span className="text-sm font-medium text-text-primary">
            {t('connection.title')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <StatusIndicator />
          {!connectionPanelExpanded ? (
            <ChevronDown className="w-4 h-4 text-text-muted" />
          ) : (
            <ChevronUp className="w-4 h-4 text-text-muted" />
          )}
        </div>
      </button>

      {/* 可折叠内容 */}
      {connectionPanelExpanded && (
        <div className="p-3 space-y-3">
          {/* 控制器选择 - 标题和按钮同一行 */}
          {controllers.length > 1 && (
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs text-text-secondary flex-shrink-0">
                {getControllerIcon(controllerType)}
                <span>{t('controller.title')}</span>
              </div>
              <div className="flex flex-wrap gap-1 justify-end">
                {controllers.map(controller => (
                  <button
                    key={controller.name}
                    onClick={async () => {
                      // 切换控制器时先断开旧连接
                      if (isConnected) {
                        await maaService.destroyInstance(instanceId).catch(() => {});
                      }
                      setSelectedController(instanceId, controller.name);
                      setIsConnected(false);
                      setInstanceConnectionStatus(instanceId, 'Disconnected');
                      setSelectedAdbDevice(null);
                      setSelectedWindow(null);
                    }}
                    disabled={isConnecting}
                    className={clsx(
                      'px-2 py-0.5 text-xs rounded-md transition-colors',
                      currentControllerName === controller.name
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                      isConnecting && 'opacity-50 cursor-not-allowed'
                    )}
                  >
                    {getControllerDisplayName(controller)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* PlayCover 地址输入和连接按钮 */}
          {controllerType === 'PlayCover' && (
            <div className="flex gap-2">
              <input
                type="text"
                value={playcoverAddress}
                onChange={(e) => setPlaycoverAddress(e.target.value)}
                placeholder="127.0.0.1:1717"
                disabled={isConnected || isConnecting}
                className={clsx(
                  'flex-1 min-w-0 px-2.5 py-1.5 rounded-md border bg-bg-tertiary border-border text-sm',
                  'text-text-primary placeholder:text-text-muted',
                  'focus:outline-none focus:border-accent transition-colors',
                  isConnected && 'opacity-60 cursor-not-allowed'
                )}
              />
              <button
                onClick={handleConnect}
                disabled={isConnecting || isConnected || !canConnect()}
                className={clsx(
                  'flex items-center justify-center px-3 py-1.5 rounded-md border transition-colors',
                  isConnected
                    ? 'bg-green-500/20 border-green-500/50 cursor-not-allowed'
                    : isConnecting || !canConnect()
                    ? 'bg-bg-tertiary border-border opacity-50 cursor-not-allowed'
                    : 'bg-accent border-accent text-white hover:bg-accent-hover'
                )}
                title={t('controller.connect')}
              >
                {isConnecting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-text-secondary" />
                ) : isConnected ? (
                  <Check className="w-3.5 h-3.5 text-green-500" />
                ) : (
                  <Wifi className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          )}

          {/* 设备选择（Adb/Win32/Gamepad）- 下拉框和刷新按钮同一行 */}
          {needsDeviceSearch && (
            <div className="flex gap-2">
              <div className="relative flex-1 min-w-0">
                <button
                  onClick={() => setShowDeviceDropdown(!showDeviceDropdown)}
                  disabled={isConnecting}
                  className={clsx(
                    'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md border transition-colors text-sm',
                    'bg-bg-tertiary border-border',
                    isConnecting
                      ? 'opacity-60 cursor-not-allowed'
                      : 'hover:border-accent cursor-pointer'
                  )}
                >
                  <span className={clsx(
                    'truncate',
                    (controllerType === 'Adb' ? selectedAdbDevice : selectedWindow)
                      ? 'text-text-primary'
                      : 'text-text-muted'
                  )}>
                    {getSelectedDeviceText()}
                  </span>
                  <ChevronDown className={clsx(
                    'w-4 h-4 text-text-muted transition-transform flex-shrink-0',
                    showDeviceDropdown && 'rotate-180'
                  )} />
                </button>

                {/* 下拉菜单 - 向下展开 */}
                {showDeviceDropdown && (
                  <div className="absolute z-[100] w-full mt-1 bg-bg-secondary border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {deviceList.length > 0 ? (
                      deviceList.map(item => (
                        <button
                          key={item.id}
                          onClick={item.onClick}
                          className={clsx(
                            'w-full flex items-center justify-between px-2.5 py-1.5 text-left transition-colors',
                            'hover:bg-bg-hover',
                            item.selected && 'bg-accent/10'
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-sm text-text-primary truncate">{item.name}</div>
                            <div className="text-xs text-text-muted truncate">{item.description}</div>
                          </div>
                          {item.selected && <Check className="w-4 h-4 text-accent flex-shrink-0 ml-2" />}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-3 text-center text-text-muted text-xs">
                        {isSearching ? t('common.loading') : t('controller.noDevices')}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 刷新按钮 - 与加载资源按钮保持一致的尺寸 */}
              <button
                onClick={handleSearch}
                disabled={isSearching || isConnecting}
                className={clsx(
                  'flex items-center justify-center px-3 py-1.5 rounded-md border transition-colors',
                  'bg-bg-tertiary border-border',
                  isSearching || isConnecting
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-bg-hover hover:border-accent'
                )}
                title={t('controller.refresh')}
              >
                {isSearching ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-text-secondary" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 text-text-secondary" />
                )}
              </button>
            </div>
          )}

          {/* 设备错误提示 */}
          {deviceError && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-red-500/10 text-red-500 text-xs">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{deviceError}</span>
            </div>
          )}

          {/* 分隔线 */}
          <div className="border-t border-border" />

          {/* 资源选择 - 下拉框和加载按钮，与设备选择对齐 */}
          <div className="flex gap-2">
            {/* 资源下拉框 */}
            <div className="relative flex-1 min-w-0">
              <button
                onClick={() => setShowResourceDropdown(!showResourceDropdown)}
                disabled={isLoadingResource || isResourceLoaded}
                className={clsx(
                  'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md border transition-colors text-sm',
                  'bg-bg-tertiary border-border',
                  isResourceLoaded
                    ? 'opacity-60 cursor-not-allowed'
                    : 'hover:border-accent cursor-pointer'
                )}
              >
                <span className={clsx(
                  'truncate',
                  currentResource ? 'text-text-primary' : 'text-text-muted'
                )}>
                  {currentResource
                    ? getResourceDisplayName(currentResource)
                    : t('resource.selectResource')}
                </span>
                <ChevronDown className={clsx(
                  'w-4 h-4 text-text-muted transition-transform flex-shrink-0',
                  showResourceDropdown && 'rotate-180'
                )} />
              </button>

              {/* 资源下拉菜单 - 向上展开避免遮挡 */}
              {showResourceDropdown && (
                <div className="absolute z-[100] w-full bottom-full mb-1 bg-bg-secondary border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {resources.map(resource => (
                    <button
                      key={resource.name}
                      onClick={() => {
                        setSelectedResource(instanceId, resource.name);
                        setShowResourceDropdown(false);
                        setIsResourceLoaded(false);
                        setInstanceResourceLoaded(instanceId, false);
                      }}
                      className={clsx(
                        'w-full flex items-center justify-between px-2.5 py-1.5 text-left transition-colors',
                        'hover:bg-bg-hover',
                        currentResourceName === resource.name && 'bg-accent/10'
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
                      {currentResourceName === resource.name && (
                        <Check className="w-4 h-4 text-accent flex-shrink-0 ml-2" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 加载资源按钮 - 与刷新按钮保持一致的尺寸 */}
            <button
              onClick={handleLoadResource}
              disabled={isLoadingResource || isResourceLoaded || !currentResource}
              className={clsx(
                'flex items-center justify-center px-3 py-1.5 rounded-md border transition-colors',
                isResourceLoaded
                  ? 'bg-green-500/20 border-green-500/50 cursor-not-allowed'
                  : isLoadingResource || !currentResource
                  ? 'bg-bg-tertiary border-border opacity-50 cursor-not-allowed'
                  : 'bg-accent border-accent text-white hover:bg-accent-hover'
              )}
              title={t('resource.load')}
            >
              {isLoadingResource ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-text-secondary" />
              ) : isResourceLoaded ? (
                <CheckCircle className="w-3.5 h-3.5 text-green-500" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5" />
              )}
            </button>
          </div>

          {/* 资源错误提示 */}
          {resourceError && (
            <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-red-500/10 text-red-500 text-xs">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{resourceError}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
