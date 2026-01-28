import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import clsx from 'clsx';
import type { ReactNode } from 'react';

interface TooltipProps {
  /** 触发 Tooltip 的子元素 */
  children: ReactNode;
  /** Tooltip 显示的内容 */
  content: ReactNode;
  /** Tooltip 显示的方向 */
  side?: 'top' | 'right' | 'bottom' | 'left';
  /** Tooltip 对齐方式 */
  align?: 'start' | 'center' | 'end';
  /** 额外的 CSS 类名 */
  className?: string;
  /** Tooltip 与触发元素的偏移距离 */
  sideOffset?: number;
  /** 显示延迟（毫秒） */
  delayDuration?: number;
  /** 最大宽度（Tailwind 类名） */
  maxWidth?: string;
  /** 碰撞边界内边距 */
  collisionPadding?: number;
}

/**
 * 通用 Tooltip 组件
 *
 * 基于 @radix-ui/react-tooltip 封装，特性：
 * - 使用 Portal 挂载到根部，避免被父容器 overflow 裁切
 * - 自动碰撞检测，当空间不足时自动翻转方向
 * - 支持 Tailwind 类名自定义最大宽度
 * - 支持自定义延迟时间
 */
export function Tooltip({
  children,
  content,
  side = 'top',
  align = 'center',
  className,
  sideOffset = 6,
  delayDuration = 300,
  maxWidth = 'max-w-xs',
  collisionPadding = 10,
}: TooltipProps) {
  // 如果没有内容，直接渲染子元素
  if (!content) {
    return <>{children}</>;
  }

  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          align={align}
          sideOffset={sideOffset}
          collisionPadding={collisionPadding}
          avoidCollisions={true}
          className={clsx(
            // 基础样式
            'z-[9999] overflow-hidden rounded-md',
            'border border-border bg-bg-tertiary shadow-lg',
            'px-3 py-2 text-xs text-text-primary',
            // 宽度限制和文本换行
            maxWidth,
            'break-words whitespace-normal',
            // 进入动画
            'animate-in fade-in-0 zoom-in-95',
            // 退出动画
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            // 根据方向设置滑入动画
            'data-[side=top]:slide-in-from-bottom-2',
            'data-[side=right]:slide-in-from-left-2',
            'data-[side=bottom]:slide-in-from-top-2',
            'data-[side=left]:slide-in-from-right-2',
            className,
          )}
        >
          {content}
          <TooltipPrimitive.Arrow
            className="fill-bg-tertiary"
            width={10}
            height={5}
          />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
