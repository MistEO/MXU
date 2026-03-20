import { useAppStore } from '@/stores/appStore';
import { loggers } from '@/utils';
import type { Instance } from '@/types/interface';

const log = loggers.task;

const STORAGE_KEY_LAST_CHECK = 'mxu_schedule_lastCheckAt';
const STORAGE_KEY_TRIGGERED = 'mxu_schedule_triggeredSlots';

const CHECK_INTERVAL_MS = 60_000; // 每 60 秒轮询一次
const SLOT_TTL_MS = 48 * 60 * 60 * 1000; // 触发记录保留 48 小时
const MAX_COMPENSATE_MS = 3 * 60 * 60 * 1000; // 最多补偿 3 小时内的遗漏
const DEBOUNCE_MS = 2_000; // 事件触发后 2 秒内去重
const CURRENT_SLOT_COMPENSATION_GRACE_MS = 5 * 60 * 1000; // 当前小时超过 5 分钟后补触发也记为补偿

export type ScheduleTriggerCallback = (
  instance: Instance,
  policyName: string,
  slotLabel: string,
  isCompensation: boolean,
) => Promise<boolean>;

function formatSlotKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  return `${y}-${m}-${d}-${h}`;
}

function hourStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours());
}

function buildTriggeredSlotKey(instanceId: string, slotStr: string): string {
  return `${instanceId}:${slotStr}`;
}

function normalizeTriggeredSlotKey(key: string): string | null {
  const lastColon = key.lastIndexOf(':');
  if (lastColon <= 0) {
    return null;
  }

  const slotStr = key.substring(lastColon + 1);
  if (!/^\d{4}-\d{2}-\d{2}-\d{2}$/.test(slotStr)) {
    return null;
  }

  const prefix = key.substring(0, lastColon);
  const firstColon = prefix.indexOf(':');
  const instanceId = firstColon === -1 ? prefix : prefix.substring(0, firstColon);

  return instanceId ? buildTriggeredSlotKey(instanceId, slotStr) : null;
}

function shouldMarkSlotAsCompensation(
  slotDate: Date,
  currentHour: Date,
  nowTs: number,
  lastCheckAt: number,
  hadPreviousCheck: boolean,
): boolean {
  const slotTs = slotDate.getTime();
  const currentHourTs = currentHour.getTime();

  if (slotTs < currentHourTs) {
    return true;
  }

  if (slotTs !== currentHourTs) {
    return false;
  }

  if (!hadPreviousCheck) {
    return false;
  }

  if (nowTs - slotTs <= CURRENT_SLOT_COMPENSATION_GRACE_MS) {
    return false;
  }

  return lastCheckAt < slotTs;
}

class ScheduleService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private checking = false;
  private triggerFn: ScheduleTriggerCallback | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;

  private getLastCheckAt(): number {
    const val = localStorage.getItem(STORAGE_KEY_LAST_CHECK);
    return val ? parseInt(val, 10) : 0;
  }

  private setLastCheckAt(ts: number) {
    localStorage.setItem(STORAGE_KEY_LAST_CHECK, String(ts));
  }

  private getTriggeredSlots(): Set<string> {
    try {
      const val = localStorage.getItem(STORAGE_KEY_TRIGGERED);
      if (!val) {
        return new Set();
      }

      const rawSlots: unknown = JSON.parse(val);
      if (!Array.isArray(rawSlots)) {
        return new Set();
      }

      const normalized = new Set<string>();
      let changed = false;

      for (const item of rawSlots) {
        if (typeof item !== 'string') {
          changed = true;
          continue;
        }

        const normalizedKey = normalizeTriggeredSlotKey(item);
        if (!normalizedKey) {
          changed = true;
          continue;
        }

        normalized.add(normalizedKey);
        if (normalizedKey !== item) {
          changed = true;
        }
      }

      if (changed) {
        this.setTriggeredSlots(normalized);
      }

      return normalized;
    } catch {
      return new Set();
    }
  }

  private setTriggeredSlots(slots: Set<string>) {
    localStorage.setItem(STORAGE_KEY_TRIGGERED, JSON.stringify([...slots]));
  }

  private cleanupOldSlots() {
    const slots = this.getTriggeredSlots();
    if (slots.size === 0) return;

    const cutoff = Date.now() - SLOT_TTL_MS;
    const cleaned = new Set<string>();

    for (const key of slots) {
      // 当前格式: instanceId:YYYY-MM-DD-HH
      // 兼容旧格式: instanceId:policyId:YYYY-MM-DD-HH
      const lastColon = key.lastIndexOf(':');
      const slotStr = key.substring(lastColon + 1);
      const [y, mo, d, h] = slotStr.split('-').map(Number);
      const slotTs = new Date(y, mo - 1, d, h).getTime();
      if (slotTs >= cutoff) {
        cleaned.add(key);
      }
    }

    if (cleaned.size !== slots.size) {
      this.setTriggeredSlots(cleaned);
    }
  }

  setTriggerCallback(fn: ScheduleTriggerCallback | null) {
    this.triggerFn = fn;
  }

  start() {
    if (this.intervalId) return;

    log.info('[调度器] 启动，轮询间隔', CHECK_INTERVAL_MS / 1000, '秒');

    this.check();
    this.intervalId = setInterval(() => this.check(), CHECK_INTERVAL_MS);

    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('focus', this.handleFocus);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('focus', this.handleFocus);

    log.info('[调度器] 已停止');
  }

  private handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      log.info('[调度器] 窗口可见，触发补偿检查');
      this.debouncedCheck();
    }
  };

  private handleFocus = () => {
    log.info('[调度器] 窗口获得焦点，触发补偿检查');
    this.debouncedCheck();
  };

  private debouncedCheck() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.check();
    }, DEBOUNCE_MS);
  }

  async check() {
    if (this.checking || !this.triggerFn) return;
    this.checking = true;

    try {
      const now = new Date();
      const nowTs = now.getTime();
      const storedLastCheckAt = this.getLastCheckAt();
      const hadPreviousCheck = storedLastCheckAt > 0;
      let lastCheckAt = storedLastCheckAt;

      // 首次运行：以当前整点为起点
      if (lastCheckAt === 0) {
        lastCheckAt = hourStart(now).getTime();
        this.setLastCheckAt(lastCheckAt);
      }

      // 限制补偿窗口
      const minCheckTs = nowTs - MAX_COMPENSATE_MS;
      if (lastCheckAt < minCheckTs) {
        log.info(
          `[调度器] lastCheckAt 过旧(${new Date(lastCheckAt).toLocaleString()})，` +
            `截断到 ${new Date(minCheckTs).toLocaleString()}`,
        );
        lastCheckAt = minCheckTs;
      }

      // 枚举 lastCheckAt 到当前时间之间的所有整点时间槽
      const startHour = hourStart(new Date(lastCheckAt));
      const currentHour = hourStart(now);

      const slotsToCheck: Date[] = [];
      const cursor = new Date(startHour);
      while (cursor <= currentHour) {
        slotsToCheck.push(new Date(cursor));
        cursor.setTime(cursor.getTime() + 60 * 60 * 1000);
      }

      if (slotsToCheck.length > 1) {
        log.info(
          `[调度器] 扫描 ${slotsToCheck.length} 个时间槽: ` +
            `${formatSlotKey(slotsToCheck[0])} → ${formatSlotKey(slotsToCheck[slotsToCheck.length - 1])}`,
        );
      }

      this.cleanupOldSlots();
      const triggeredSlots = this.getTriggeredSlots();
      let slotsModified = false;

      for (const slotDate of slotsToCheck) {
        const weekday = slotDate.getDay();
        const hour = slotDate.getHours();
        const slotStr = formatSlotKey(slotDate);
        const isCompensation = shouldMarkSlotAsCompensation(
          slotDate,
          currentHour,
          nowTs,
          lastCheckAt,
          hadPreviousCheck,
        );

        const { instances } = useAppStore.getState();

        for (const inst of instances) {
          const policies = inst.schedulePolicies || [];

          for (const policy of policies) {
            if (!policy.enabled) continue;
            if (!policy.weekdays.includes(weekday)) continue;
            if (!policy.hours.includes(hour)) continue;

            const slotKey = buildTriggeredSlotKey(inst.id, slotStr);
            if (triggeredSlots.has(slotKey)) break;

            // 读取最新实例状态
            const freshInst = useAppStore.getState().instances.find((i) => i.id === inst.id);
            if (!freshInst) continue;

            if (freshInst.isRunning) {
              log.info(
                `[调度器] 实例 "${inst.name}" 正在运行，跳过时间槽 ${slotStr} 策略 "${policy.name}"`,
              );
              triggeredSlots.add(slotKey);
              slotsModified = true;
              break;
            }

            log.info(
              `[调度器] ${isCompensation ? '补偿触发' : '准时触发'}: ` +
                `时间槽 ${slotStr}, 实例 "${inst.name}", 策略 "${policy.name}"`,
            );

            triggeredSlots.add(slotKey);
            slotsModified = true;

            try {
              const timeLabel = `${String(hour).padStart(2, '0')}:00`;
              await this.triggerFn(freshInst, policy.name, timeLabel, isCompensation);
            } catch (err) {
              log.error(`[调度器] 触发失败:`, err);
            }

            // 每个实例每个时间槽只执行第一个匹配策略
            break;
          }
        }
      }

      if (slotsModified) {
        this.setTriggeredSlots(triggeredSlots);
      }

      this.setLastCheckAt(nowTs);
    } finally {
      this.checking = false;
    }
  }
}

export const scheduleService = new ScheduleService();
