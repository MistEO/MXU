import type { ResourceItem, ControllerItem } from '@/types/interface';

/**
 * 清理相对路径前缀 "./" 或 ".\"
 */
function cleanRelativePath(path: string): string {
  return path.replace(/^\.\//, '').replace(/^\.\\/, '');
}

/**
 * 计算完整的资源路径列表
 *
 * 根据 PI V2.2.0 协议，资源路径应该包括：
 * 1. resource.path - 资源的基础路径
 * 2. controller.attach_resource_path - 控制器附加的资源路径（在 resource.path 之后加载）
 *
 * @param resource 当前选中的资源
 * @param controller 当前选中的控制器（可选）
 * @param basePath interface.json 所在目录的绝对路径
 * @returns 完整的资源路径列表（绝对路径）
 */
export function computeResourcePaths(
  resource: ResourceItem,
  controller: ControllerItem | undefined,
  basePath: string,
): string[] {
  const paths: string[] = [];

  // 1. 添加 resource.path
  for (const p of resource.path) {
    const cleanPath = cleanRelativePath(p);
    paths.push(`${basePath}/${cleanPath}`);
  }

  // 2. 添加 controller.attach_resource_path（如果存在）
  if (controller?.attach_resource_path) {
    for (const p of controller.attach_resource_path) {
      const cleanPath = cleanRelativePath(p);
      paths.push(`${basePath}/${cleanPath}`);
    }
  }

  return paths;
}
