import { useEffect, useRef, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@/stores/appStore';
import { loggers } from '@/utils/logger';
import { isDebugVersion } from '@/services/updateService';
import type {
  Driver as DriverInstance,
  DriverConfig as DriverFactoryOptions,
  DriverStep as DriveStep,
} from 'driver.js';

type DriverFactory = (options: DriverFactoryOptions) => DriverInstance;

let driverFactoryPromise: Promise<DriverFactory> | null = null;
const log = loggers.app;

async function loadDriverFactory(): Promise<DriverFactory> {
  if (!driverFactoryPromise) {
    driverFactoryPromise = (async () => {
      try {
        await import('driver.js/dist/driver.css');
        const module = await import('driver.js');
        return module.driver;
      } catch (error) {
        // 动态导入临时失败时允许后续重试
        driverFactoryPromise = null;
        throw error;
      }
    })();
  }
  return driverFactoryPromise;
}

/**
 * 检查当前是否有任何模态弹窗（z-50 级别的 fixed 遮罩）正在显示。
 * 涵盖 WelcomeDialog、InstallConfirmModal、VCRedistModal、
 * BadPathModal、VersionWarningModal 等所有全局遮罩。
 */
function hasActiveModal(): boolean {
  // 所有模态弹窗都使用 fixed inset-0 z-50 的模式
  const overlays = document.querySelectorAll('.fixed.inset-0.z-50');
  return overlays.length > 0;
}

/**
 * 新用户引导覆盖层
 * 使用 driver.js 高亮连接设置面板，引导用户完成首次配置。
 * 会等待所有模态弹窗（Welcome、安装确认等）关闭后再显示。
 */
export function OnboardingOverlay() {
  const { t } = useTranslation();
  const { onboardingCompleted, setOnboardingCompleted, setShowAddTaskPanel, projectInterface } =
    useAppStore();

  const isDevMode = useMemo(
    () => import.meta.env.DEV || isDebugVersion(projectInterface?.version),
    [projectInterface?.version],
  );

  const driverRef = useRef<DriverInstance | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedRef = useRef(false);
  // 仅合法完成路径置 true；组件卸载触发的 destroy 走 false 分支，下次重新弹出
  const tourFinishedRef = useRef(false);

  // 启动 driver.js 引导
  const startTour = useCallback(async () => {
    if (startedRef.current || onboardingCompleted) return;

    const element = document.getElementById('connection-panel');
    if (!element) return;

    startedRef.current = true;

    const steps: DriveStep[] = [
      {
        element: '#connection-panel',
        popover: {
          title: t('onboarding.title'),
          description: t('onboarding.message'),
          side: 'left',
          align: 'start',
          showButtons: ['next'],
          nextBtnText: t('onboarding.next'),
        },
      },
      {
        element: '#tab-bar-area',
        popover: {
          title: t('onboarding.tabBarTitle'),
          description: t('onboarding.tabBarMessage'),
          side: 'bottom',
          align: 'start',
          showButtons: ['next'],
          nextBtnText: t('onboarding.next'),
          // 进入"添加任务"步骤前，先打开面板再推进
          onNextClick: (_el, _step, { driver: d }) => {
            setShowAddTaskPanel(true);
            setTimeout(() => d.moveNext(), 150);
          },
        },
      },
      {
        element: '#add-task-panel',
        popover: {
          title: t('onboarding.addTaskTitle'),
          description: t('onboarding.addTaskMessage'),
          side: 'top',
          align: 'center',
          showButtons: ['next'],
          doneBtnText: t('onboarding.gotIt'),
          onNextClick: (_el, _step, { driver: d }) => {
            tourFinishedRef.current = true;
            d.moveNext();
          },
        },
      },
    ];

    try {
      const createDriver = await loadDriverFactory();
      const driverInstance = createDriver({
        steps,
        animate: true,
        overlayColor: 'black',
        overlayOpacity: 0.4,
        stagePadding: 6,
        stageRadius: 8,
        allowClose: false,
        popoverClass: 'mxu-onboarding-popover',
        onPopoverRender: (popover) => {
          if (!isDevMode) return;
          const footer = popover.footerButtons;
          if (!footer || footer.querySelector('.mxu-onboarding-skip')) return;
          const btn = document.createElement('button');
          // className 不能包含 "driver-popover"，否则会被 driver.js 的事件嗅探吞掉点击
          btn.className = 'mxu-onboarding-skip';
          btn.type = 'button';
          btn.textContent = t('onboarding.skipDev');
          btn.addEventListener('click', () => {
            tourFinishedRef.current = true;
            driverRef.current?.destroy();
          });
          footer.insertBefore(btn, footer.firstChild);
        },
        onDestroyed: () => {
          // 唯一的 completed 写入口；中途关闭（含关软件）走 false 分支，下次重新弹
          if (tourFinishedRef.current) {
            setOnboardingCompleted(true);
          } else {
            startedRef.current = false;
          }
        },
      });

      driverRef.current = driverInstance;
      driverInstance.drive();
    } catch (err) {
      startedRef.current = false;
      log.warn('Failed to load onboarding driver:', err);
    }
  }, [onboardingCompleted, t, setOnboardingCompleted, setShowAddTaskPanel, isDevMode]);

  // 等待所有模态弹窗关闭后再启动引导
  useEffect(() => {
    if (onboardingCompleted || startedRef.current) return;

    // 先等一个初始延迟，让界面和可能的模态弹窗都渲染完成
    const initialDelay = setTimeout(() => {
      // 如果此时没有模态弹窗，直接启动
      if (!hasActiveModal()) {
        void startTour();
        return;
      }

      // 否则轮询等待模态弹窗关闭
      pollTimerRef.current = setInterval(() => {
        if (!hasActiveModal()) {
          if (pollTimerRef.current) {
            clearInterval(pollTimerRef.current);
            pollTimerRef.current = null;
          }
          // 模态弹窗关闭后再延迟一小段时间，让退出动画完成
          setTimeout(() => {
            void startTour();
          }, 300);
        }
      }, 200);
    }, 600);

    return () => {
      clearTimeout(initialDelay);
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      if (driverRef.current?.isActive()) {
        driverRef.current.destroy();
      }
    };
  }, [onboardingCompleted, startTour]);

  // driver.js 自己管理 DOM，这个组件不需要渲染任何内容
  return null;
}
