import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  Smartphone,
  Monitor,
  Apple,
  Gamepad2,
  RefreshCw,
  Loader2,
  Check,
  AlertCircle,
  Wifi,
  WifiOff,
  CheckCircle,
  Settings2,
  History,
} from 'lucide-react';
import clsx from 'clsx';
import { maaService } from '@/services/maaService';
import { useAppStore } from '@/stores/appStore';
import { resolveI18nText } from '@/services/contentResolver';
import type { AdbDevice, Win32Window, ControllerConfig } from '@/types/maa';
import type { ControllerItem, ResourceItem } from '@/types/interface';
import { parseWin32ScreencapMethod, parseWin32InputMethod } from '@/types/maa';
import { getInterfaceLangKey } from '@/i18n';

// 检测当前操作系统
const isWindows = navigator.platform.toLowerCase().includes('win');
const isMacOS = navigator.platform.toLowerCase().includes('mac');

// ============================================================================
// 全局回调结果缓存（解决回调早于 post 返回的竞态问题）
// ============================================================================
type CallbackResult = 'succeeded' | 'failed';

// 控制器连接结果缓存
const ctrlCallbackCache = new Map<number, CallbackResult>();
// 资源加载结果缓存
const resCallbackCache = new Map<number, CallbackResult>();

// 缓存清理超时时间（30秒）
const CACHE_CLEANUP_TIMEOUT = 30000;

// 全局监听器是否已启动
let globalListenerStarted = false;

// 启动全局回调监听器
function startGlobalCallbackListener() {
  if (globalListenerStarted) return;
  globalListenerStarted = true;
  
  maaService.onCallback((message, details) => {
    // 缓存控制器连接结果
    if (details.ctrl_id !== undefined) {
      if (message === 'Controller.Action.Succeeded') {
        ctrlCallbackCache.set(details.ctrl_id, 'succeeded');
        // 30秒后自动清理
        setTimeout(() => ctrlCallbackCache.delete(details.ctrl_id!), CACHE_CLEANUP_TIMEOUT);
      } else if (message === 'Controller.Action.Failed') {
        ctrlCallbackCache.set(details.ctrl_id, 'failed');
        setTimeout(() => ctrlCallbackCache.delete(details.ctrl_id!), CACHE_CLEANUP_TIMEOUT);
      }
    }
    
    // 缓存资源加载结果
    if (details.res_id !== undefined) {
      if (message === 'Resource.Loading.Succeeded') {
        resCallbackCache.set(details.res_id, 'succeeded');
        setTimeout(() => resCallbackCache.delete(details.res_id!), CACHE_CLEANUP_TIMEOUT);
      } else if (message === 'Resource.Loading.Failed') {
        resCallbackCache.set(details.res_id, 'failed');
        setTimeout(() => resCallbackCache.delete(details.res_id!), CACHE_CLEANUP_TIMEOUT);
      }
    }
  });
}

// 等待控制器连接结果（先查缓存，没有则等待回调）
async function waitForCtrlResult(ctrlId: number, timeoutMs: number = 30000): Promise<CallbackResult> {
  // 先检查缓存
  const cached = ctrlCallbackCache.get(ctrlId);
  if (cached) {
    ctrlCallbackCache.delete(ctrlId);
    return cached;
  }
  
  // 缓存中没有，等待回调
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const checkInterval = setInterval(() => {
      const result = ctrlCallbackCache.get(ctrlId);
      if (result) {
        clearInterval(checkInterval);
        ctrlCallbackCache.delete(ctrlId);
        resolve(result);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        resolve('failed'); // 超时视为失败
      }
    }, 50); // 每50ms检查一次
  });
}

// 等待资源加载结果（先查缓存，没有则等待回调）
async function waitForResResult(resId: number, timeoutMs: number = 30000): Promise<CallbackResult> {
  // 先检查缓存
  const cached = resCallbackCache.get(resId);
  if (cached) {
    resCallbackCache.delete(resId);
    return cached;
  }
  
  // 缓存中没有，等待回调
  return new Promise((resolve) => {
    const startTime = Date.now();
    
    const checkInterval = setInterval(() => {
      const result = resCallbackCache.get(resId);
      if (result) {
        clearInterval(checkInterval);
        resCallbackCache.delete(resId);
        resolve(result);
      } else if (Date.now() - startTime > timeoutMs) {
        clearInterval(checkInterval);
        resolve('failed'); // 超时视为失败
      }
    }, 50);
  });
}

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
    registerCtrlIdName,
    registerResIdName,
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
  
  // 记录已加载的资源名称，避免重复加载
  const lastLoadedResourceRef = useRef<string | null>(null);
  
  
  // 下拉框触发按钮和菜单的 ref
  const deviceDropdownRef = useRef<HTMLButtonElement>(null);
  const deviceMenuRef = useRef<HTMLDivElement>(null);
  const resourceDropdownRef = useRef<HTMLButtonElement>(null);
  const resourceMenuRef = useRef<HTMLDivElement>(null);
  const [deviceDropdownPos, setDeviceDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [resourceDropdownPos, setResourceDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  
  // 计算下拉框位置（向下展开）
  const calcDropdownPosition = useCallback((ref: React.RefObject<HTMLButtonElement | null>) => {
    if (!ref.current) return null;
    const rect = ref.current.getBoundingClientRect();
    return {
      top: rect.bottom + 4,
      left: rect.left,
      width: rect.width,
    };
  }, []);
  
  // 计算下拉框位置（向上展开）
  const calcDropdownPositionUp = useCallback((ref: React.RefObject<HTMLButtonElement | null>) => {
    if (!ref.current) return null;
    const rect = ref.current.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
      width: rect.width,
    };
  }, []);

  const langKey = getInterfaceLangKey(language);
  const translations = interfaceTranslations[langKey];
  
  // 启动全局回调监听器（只启动一次）
  useEffect(() => {
    startGlobalCallbackListener();
  }, []);
  
  // 点击外部关闭下拉框
  useEffect(() => {
    if (!showDeviceDropdown && !showResourceDropdown) return;
    
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      // 检查点击是否在触发按钮或下拉菜单内部
      if (showDeviceDropdown) {
        const inButton = deviceDropdownRef.current?.contains(target);
        const inMenu = deviceMenuRef.current?.contains(target);
        if (!inButton && !inMenu) {
          setShowDeviceDropdown(false);
        }
      }
      if (showResourceDropdown) {
        const inButton = resourceDropdownRef.current?.contains(target);
        const inMenu = resourceMenuRef.current?.contains(target);
        if (!inButton && !inMenu) {
          setShowResourceDropdown(false);
        }
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showDeviceDropdown, showResourceDropdown]);

  // 获取当前实例 ID
  const instanceId = activeInstanceId || '';

  // 获取控制器列表并根据操作系统过滤不支持的类型
  const allControllers = projectInterface?.controller || [];
  const controllers = useMemo(() => {
    return allControllers.filter(c => {
      // 非 Windows 系统不支持 Win32 和 Gamepad
      if (!isWindows && (c.type === 'Win32' || c.type === 'Gamepad')) {
        return false;
      }
      // 非 macOS 系统不支持 PlayCover
      if (!isMacOS && c.type === 'PlayCover') {
        return false;
      }
      return true;
    });
  }, [allControllers]);
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
  
  // 监听 store 中连接状态变化（当 Toolbar 自动连接时同步状态）
  useEffect(() => {
    const isInstanceConnected = storedConnectionStatus === 'Connected';
    // 只在状态从非连接变为已连接时更新，避免覆盖正在连接中的状态
    if (isInstanceConnected && !isConnecting) {
      setIsConnected(true);
      setIsConnecting(false);
    } else if (storedConnectionStatus === 'Disconnected' && !isConnecting) {
      setIsConnected(false);
    }
  }, [storedConnectionStatus, isConnecting]);
  
  // 监听 store 中资源加载状态变化
  useEffect(() => {
    // 只在状态从未加载变为已加载时更新，避免覆盖正在加载中的状态
    if (storedResourceLoaded && !isLoadingResource) {
      setIsResourceLoaded(true);
      setIsLoadingResource(false);
      // 同步更新 lastLoadedResourceRef，避免重复加载
      if (currentResourceName) {
        lastLoadedResourceRef.current = currentResourceName;
      }
    } else if (!storedResourceLoaded && !isLoadingResource) {
      setIsResourceLoaded(false);
      lastLoadedResourceRef.current = null;
    }
  }, [storedResourceLoaded, isLoadingResource, currentResourceName]);

  // 判断是否需要搜索设备（PlayCover 不需要搜索）
  const needsDeviceSearch = controllerType === 'Adb' || controllerType === 'Win32' || controllerType === 'Gamepad';
  
  // 记录上一次的控制器名称，用于检测切换
  const prevControllerNameRef = useRef<string | undefined>(currentControllerName);
  
  // 当控制器切换时自动触发设备搜索
  useEffect(() => {
    const prevName = prevControllerNameRef.current;
    prevControllerNameRef.current = currentControllerName;
    
    // 检测是否发生了切换（排除初始化和实例切换的情况）
    if (prevName !== undefined && prevName !== currentControllerName && needsDeviceSearch) {
      handleSearch();
    }
  }, [currentControllerName]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // 连接控制器的内部实现（使用缓存机制解决竞态问题）
  const connectControllerInternal = async (config: ControllerConfig, deviceName: string) => {
    const agentPath = `${basePath}/MaaAgentBinary`;
    const ctrlId = await maaService.connectController(instanceId, config, agentPath);
    
    // 注册 ctrl_id 与设备名的映射，用于日志显示
    if (deviceName) {
      registerCtrlIdName(ctrlId, deviceName);
    }
    
    // 等待连接结果（先查缓存，没有则轮询等待）
    const result = await waitForCtrlResult(ctrlId);
    
    if (result === 'succeeded') {
      setIsConnected(true);
      setInstanceConnectionStatus(instanceId, 'Connected');
      setIsConnecting(false);
    } else {
      setDeviceError(t('controller.connectionFailed'));
      setIsConnected(false);
      setInstanceConnectionStatus(instanceId, 'Disconnected');
      setIsConnecting(false);
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
      let deviceName = '';

      if (controllerType === 'Adb' && selectedAdbDevice) {
        config = {
          type: 'Adb',
          adb_path: selectedAdbDevice.adb_path,
          address: selectedAdbDevice.address,
          screencap_methods: selectedAdbDevice.screencap_methods,
          input_methods: selectedAdbDevice.input_methods,
          config: selectedAdbDevice.config,
        };
        deviceName = selectedAdbDevice.name || selectedAdbDevice.address;
      } else if (controllerType === 'Win32' && selectedWindow) {
        config = {
          type: 'Win32',
          handle: selectedWindow.handle,
          screencap_method: parseWin32ScreencapMethod(currentController.win32?.screencap || ''),
          mouse_method: parseWin32InputMethod(currentController.win32?.mouse || ''),
          keyboard_method: parseWin32InputMethod(currentController.win32?.keyboard || ''),
        };
        deviceName = selectedWindow.window_name || selectedWindow.class_name;
      } else if (controllerType === 'PlayCover') {
        // 保存 PlayCover 地址到实例配置
        setInstanceSavedDevice(instanceId, { playcoverAddress });
        config = {
          type: 'PlayCover',
          address: playcoverAddress,
        };
        deviceName = playcoverAddress;
      } else if (controllerType === 'Gamepad' && selectedWindow) {
        config = {
          type: 'Gamepad',
          handle: selectedWindow.handle,
        };
        deviceName = selectedWindow.window_name || selectedWindow.class_name;
      } else {
        throw new Error(t('controller.selectDevice'));
      }

      await connectControllerInternal(config, deviceName);
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
      setIsConnected(false);
      setInstanceConnectionStatus(instanceId, 'Disconnected');
      setIsConnecting(false);
    }
  };

  // 加载资源（使用缓存机制解决竞态问题）
  const loadResourceInternal = async (resource: ResourceItem) => {
    setIsLoadingResource(true);
    setResourceError(null);

    try {
      await maaService.createInstance(instanceId).catch(() => {});
      // 拼接绝对路径，移除相对路径前缀 "./" 或 "."
      const resourcePaths = resource.path.map(p => {
        const cleanPath = p.replace(/^\.\//, '').replace(/^\.\\/, '');
        return `${basePath}/${cleanPath}`;
      });
      
      const resIds = await maaService.loadResource(instanceId, resourcePaths);
      
      // 注册 res_id 与资源名的映射，用于日志显示
      const resourceDisplayName = resolveI18nText(resource.label, translations) || resource.name;
      resIds.forEach(resId => {
        registerResIdName(resId, resourceDisplayName);
      });
      
      // 如果没有有效的 resIds，直接标记为加载失败
      if (resIds.length === 0) {
        setResourceError(t('resource.loadFailed'));
        setIsLoadingResource(false);
        return;
      }
      
      // 记录已加载的资源名称
      lastLoadedResourceRef.current = resource.name;
      
      // 等待所有资源加载完成（先查缓存，没有则轮询等待）
      const results = await Promise.all(resIds.map(resId => waitForResResult(resId)));
      
      // 检查是否有失败的
      const hasFailed = results.some(r => r === 'failed');
      
      if (hasFailed) {
        setResourceError(t('resource.loadFailed'));
        setIsResourceLoaded(false);
        setInstanceResourceLoaded(instanceId, false);
        setIsLoadingResource(false);
        lastLoadedResourceRef.current = null;
      } else {
        setIsResourceLoaded(true);
        setInstanceResourceLoaded(instanceId, true);
        setIsLoadingResource(false);
      }
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : t('resource.loadFailed'));
      setIsResourceLoaded(false);
      setInstanceResourceLoaded(instanceId, false);
      setIsLoadingResource(false);
      lastLoadedResourceRef.current = null;
    }
  };
  
  // 切换资源：销毁旧资源后加载新资源
  const switchResource = async (newResource: ResourceItem) => {
    setIsLoadingResource(true);
    setResourceError(null);
    setIsResourceLoaded(false);
    setInstanceResourceLoaded(instanceId, false);

    try {
      // 销毁旧的资源
      await maaService.destroyResource(instanceId);
      
      // 加载新资源
      await loadResourceInternal(newResource);
    } catch (err) {
      setResourceError(err instanceof Error ? err.message : t('resource.switchFailed'));
      setIsLoadingResource(false);
      lastLoadedResourceRef.current = null;
    }
  };
  
  // 处理资源选择（自动加载）
  const handleResourceSelect = async (resource: ResourceItem) => {
    setShowResourceDropdown(false);
    
    // 检查是否正在运行任务
    const isRunning = activeInstance?.isRunning || false;
    if (isRunning) {
      // 任务运行中不允许切换资源
      setResourceError(t('resource.cannotSwitchWhileRunning'));
      return;
    }
    
    // 如果选择的是同一个资源且已加载，不做任何操作
    if (resource.name === lastLoadedResourceRef.current && isResourceLoaded) {
      setSelectedResource(instanceId, resource.name);
      return;
    }
    
    // 更新选中状态
    setSelectedResource(instanceId, resource.name);
    
    // 如果之前已加载过资源，需要先销毁再加载
    if (lastLoadedResourceRef.current !== null) {
      await switchResource(resource);
    } else {
      // 首次加载
      await loadResourceInternal(resource);
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
    const savedDevice = activeInstance?.savedDevice;
    
    if (controllerType === 'Adb') {
      if (selectedAdbDevice) {
        return `${selectedAdbDevice.name} (${selectedAdbDevice.address})`;
      }
      // 缓存为空但有历史设备名称
      if (savedDevice?.adbDeviceName) {
        return savedDevice.adbDeviceName;
      }
    }
    if (controllerType === 'Win32' || controllerType === 'Gamepad') {
      if (selectedWindow) {
        return selectedWindow.window_name || selectedWindow.class_name;
      }
      // 缓存为空但有历史窗口名称
      if (savedDevice?.windowName) {
        return savedDevice.windowName;
      }
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
      
      await connectControllerInternal(config, device.name || device.address);
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
      
      await connectControllerInternal(config, win.window_name || win.class_name);
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
      setIsConnected(false);
      setInstanceConnectionStatus(instanceId, 'Disconnected');
      setIsConnecting(false);
    }
  };

  // 点击历史设备条目时，触发搜索并自动匹配连接
  const handleSearchAndConnectHistorical = async () => {
    if (!currentController) return;
    
    setIsSearching(true);
    setDeviceError(null);
    setShowDeviceDropdown(false);

    try {
      const initialized = await ensureMaaInitialized();
      if (!initialized) {
        throw new Error(t('maa.initFailed'));
      }
      
      const savedDevice = activeInstance?.savedDevice;
      
      if (controllerType === 'Adb') {
        const devices = await maaService.findAdbDevices();
        setCachedAdbDevices(devices);
        
        // 尝试匹配保存的设备名称
        if (savedDevice?.adbDeviceName) {
          const matched = devices.find(d => d.name === savedDevice.adbDeviceName);
          if (matched) {
            // 找到匹配的，自动连接
            setIsSearching(false);
            handleSelectAdbDevice(matched);
            return;
          }
          // 没找到匹配的，显示错误提示
          setDeviceError(t('controller.savedDeviceNotFound'));
        }
        
        // 显示搜索结果供用户选择
        if (devices.length > 0) {
          setShowDeviceDropdown(true);
        }
      } else if (controllerType === 'Win32' || controllerType === 'Gamepad') {
        const classRegex = currentController.win32?.class_regex || currentController.gamepad?.class_regex;
        const windowRegex = currentController.win32?.window_regex || currentController.gamepad?.window_regex;
        const windows = await maaService.findWin32Windows(classRegex, windowRegex);
        setCachedWin32Windows(windows);
        
        // 尝试匹配保存的窗口名称
        if (savedDevice?.windowName) {
          const matched = windows.find(w => w.window_name === savedDevice.windowName);
          if (matched) {
            // 找到匹配的，自动连接
            setIsSearching(false);
            handleSelectWindow(matched);
            return;
          }
          // 没找到匹配的，显示错误提示
          setDeviceError(t('controller.savedDeviceNotFound'));
        }
        
        // 显示搜索结果供用户选择
        if (windows.length > 0) {
          setShowDeviceDropdown(true);
        }
      }
    } catch (err) {
      setDeviceError(err instanceof Error ? err.message : t('controller.connectionFailed'));
    } finally {
      setIsSearching(false);
    }
  };

  // 获取设备列表
  const getDeviceList = () => {
    const savedDevice = activeInstance?.savedDevice;
    
    if (controllerType === 'Adb') {
      // 如果缓存中有设备，使用缓存列表
      if (cachedAdbDevices.length > 0) {
        return cachedAdbDevices.map(device => ({
          id: `${device.adb_path}:${device.address}`,
          name: device.name,
          description: device.address,
          selected: selectedAdbDevice?.address === device.address,
          onClick: () => handleSelectAdbDevice(device),
          isHistorical: false,
        }));
      }
      
      // 缓存为空但有历史设备名称，显示历史设备条目
      if (savedDevice?.adbDeviceName) {
        return [{
          id: 'historical-device',
          name: savedDevice.adbDeviceName,
          description: t('controller.lastSelected'),
          selected: true,
          onClick: handleSearchAndConnectHistorical,
          isHistorical: true,
        }];
      }
      
      return [];
    }
    if (controllerType === 'Win32' || controllerType === 'Gamepad') {
      // 如果缓存中有窗口，使用缓存列表
      if (cachedWin32Windows.length > 0) {
        return cachedWin32Windows.map(window => ({
          id: String(window.handle),
          name: window.window_name || '(无标题)',
          description: window.class_name,
          selected: selectedWindow?.handle === window.handle,
          onClick: () => handleSelectWindow(window),
          isHistorical: false,
        }));
      }
      
      // 缓存为空但有历史窗口名称，显示历史窗口条目
      if (savedDevice?.windowName) {
        return [{
          id: 'historical-window',
          name: savedDevice.windowName,
          description: t('controller.lastSelected'),
          selected: true,
          onClick: handleSearchAndConnectHistorical,
          isHistorical: true,
        }];
      }
      
      return [];
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
  const StatusIndicator = () => {
    // 截断文本并添加省略号
    const truncateText = (text: string, maxLength: number) => {
      if (text.length <= maxLength) return text;
      return text.slice(0, maxLength) + '...';
    };
    
    // 获取设备显示文本（优先显示具体设备名）
    const getDeviceStatusText = () => {
      const savedDevice = activeInstance?.savedDevice;
      if (savedDevice?.adbDeviceName) {
        return truncateText(savedDevice.adbDeviceName, 6);
      }
      if (savedDevice?.windowName) {
        return truncateText(savedDevice.windowName, 6);
      }
      if (savedDevice?.playcoverAddress) {
        return truncateText(savedDevice.playcoverAddress, 6);
      }
      // 没有设备名时回退到控制器名称
      if (currentController) {
        return getControllerDisplayName(currentController);
      }
      return t('controller.disconnected');
    };
    
    // 判断是否有历史设备记录
    const hasHistoricalDevice = activeInstance?.savedDevice && (
      activeInstance.savedDevice.adbDeviceName ||
      activeInstance.savedDevice.windowName ||
      activeInstance.savedDevice.playcoverAddress
    );
    
    return (
      <div className="flex items-center gap-2">
        {isConnecting ? (
          <span className="flex items-center gap-1 text-accent text-xs">
            <Loader2 className="w-3 h-3 animate-spin" />
            {t('controller.connecting')}
          </span>
        ) : isConnected ? (
          <span className="flex items-center gap-1 text-green-500 text-xs" title={getDeviceStatusText()}>
            <Wifi className="w-3 h-3" />
            {getDeviceStatusText()}
          </span>
        ) : hasHistoricalDevice && currentController ? (
          <span className="flex items-center gap-1 text-text-muted text-xs" title={getDeviceStatusText()}>
            <WifiOff className="w-3 h-3" />
            {getDeviceStatusText()}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-text-muted text-xs">
            <WifiOff className="w-3 h-3" />
            {t('controller.disconnected')}
          </span>
        )}
        {isResourceLoaded && currentResource && (
          <span className="flex items-center gap-1 text-green-500 text-xs" title={getResourceDisplayName(currentResource)}>
            <CheckCircle className="w-3 h-3" />
            {truncateText(getResourceDisplayName(currentResource), 6)}
          </span>
        )}
      </div>
    );
  };

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
                      // 点击当前已选中的控制器，不做任何操作
                      if (currentControllerName === controller.name) return;
                      
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
                    disabled={isConnecting || isSearching}
                    className={clsx(
                      'px-2 py-0.5 text-xs rounded-md transition-colors',
                      currentControllerName === controller.name
                        ? 'bg-accent text-white'
                        : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover',
                      (isConnecting || isSearching) && 'opacity-50 cursor-not-allowed'
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
                  ref={deviceDropdownRef}
                  onClick={() => {
                    if (!showDeviceDropdown) {
                      setDeviceDropdownPos(calcDropdownPosition(deviceDropdownRef));
                    }
                    setShowDeviceDropdown(!showDeviceDropdown);
                  }}
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

                {/* 下拉菜单 - 使用 fixed 定位避免被父容器裁剪 */}
                {showDeviceDropdown && deviceDropdownPos && (
                  <div
                    ref={deviceMenuRef}
                    className="fixed z-[100] bg-bg-secondary border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto"
                    style={{
                      top: deviceDropdownPos.top,
                      left: deviceDropdownPos.left,
                      width: deviceDropdownPos.width,
                    }}
                  >
                    {deviceList.length > 0 ? (
                      deviceList.map(item => (
                        <button
                          key={item.id}
                          onClick={item.onClick}
                          className={clsx(
                            'w-full flex items-center justify-between px-2.5 py-1.5 text-left transition-colors',
                            'hover:bg-bg-hover',
                            item.selected && !item.isHistorical && 'bg-accent/10',
                            item.isHistorical && 'bg-amber-500/10'
                          )}
                        >
                          <div className="min-w-0 flex-1 flex items-center gap-2">
                            {item.isHistorical && (
                              <History className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-sm text-text-primary truncate">{item.name}</div>
                              <div className={clsx(
                                'text-xs truncate',
                                item.isHistorical ? 'text-amber-500' : 'text-text-muted'
                              )}>{item.description}</div>
                            </div>
                          </div>
                          {item.selected && !item.isHistorical && <Check className="w-4 h-4 text-accent flex-shrink-0 ml-2" />}
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

          {/* 资源选择 - 选中即自动加载 */}
          <div className="relative">
            {/* 资源下拉框 */}
            <button
              ref={resourceDropdownRef}
              onClick={() => {
                if (isLoadingResource || activeInstance?.isRunning) return;
                if (!showResourceDropdown) {
                  setResourceDropdownPos(calcDropdownPositionUp(resourceDropdownRef));
                }
                setShowResourceDropdown(!showResourceDropdown);
              }}
              disabled={isLoadingResource || (activeInstance?.isRunning || false)}
              className={clsx(
                'w-full flex items-center justify-between px-2.5 py-1.5 rounded-md border transition-colors text-sm',
                'bg-bg-tertiary border-border',
                (isLoadingResource || activeInstance?.isRunning)
                  ? 'opacity-60 cursor-not-allowed'
                  : 'hover:border-accent cursor-pointer'
              )}
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className={clsx(
                  'truncate',
                  currentResource ? 'text-text-primary' : 'text-text-muted'
                )}>
                  {currentResource
                    ? getResourceDisplayName(currentResource)
                    : t('resource.selectResource')}
                </span>
                {isLoadingResource && (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-accent flex-shrink-0" />
                )}
                {!isLoadingResource && isResourceLoaded && (
                  <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                )}
              </div>
              <ChevronDown className={clsx(
                'w-4 h-4 text-text-muted transition-transform flex-shrink-0',
                showResourceDropdown && 'rotate-180'
              )} />
            </button>

            {/* 资源下拉菜单 - 使用 fixed 定位向上展开 */}
            {showResourceDropdown && resourceDropdownPos && (
              <div
                ref={resourceMenuRef}
                className="fixed z-[100] bg-bg-secondary border border-border rounded-lg shadow-lg max-h-48 overflow-y-auto"
                style={{
                  bottom: window.innerHeight - resourceDropdownPos.top + 4,
                  left: resourceDropdownPos.left,
                  width: resourceDropdownPos.width,
                }}
              >
                {resources.map(resource => (
                  <button
                    key={resource.name}
                    onClick={() => handleResourceSelect(resource)}
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
