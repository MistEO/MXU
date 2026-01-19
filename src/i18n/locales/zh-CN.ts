export default {
  // 通用
  common: {
    confirm: '确定',
    cancel: '取消',
    save: '保存',
    delete: '删除',
    edit: '编辑',
    add: '添加',
    close: '关闭',
    loading: '加载中...',
    error: '错误',
    success: '成功',
    warning: '警告',
    info: '提示',
  },

  // 标题栏
  titleBar: {
    newTab: '新标签页',
    closeTab: '关闭标签页',
    settings: '设置',
    about: '关于',
    renameInstance: '重命名实例',
    instanceName: '实例名称',
    dragToReorder: '拖拽以重新排序',
  },

  // 设置
  settings: {
    title: '设置',
    appearance: '外观',
    language: '语言',
    theme: '主题',
    themeLight: '浅色',
    themeDark: '深色',
    themeSystem: '跟随系统',
    showOptionPreview: '显示选项预览',
    showOptionPreviewHint: '在任务列表中显示选项的快捷预览信息',
  },

  // 任务列表
  taskList: {
    title: '任务列表',
    selectAll: '全选',
    deselectAll: '取消全选',
    collapseAll: '全部折叠',
    expandAll: '全部展开',
    addTask: '添加任务',
    noTasks: '暂无任务',
    dragToReorder: '拖拽以重新排序',
    startTasks: '开始任务',
    stopTasks: '停止任务',
    startingTasks: '启动中...',
    stoppingTasks: '停止中...',
    // 自动连接相关
    autoConnect: {
      searching: '搜索设备...',
      connecting: '连接设备...',
      loadingResource: '加载资源...',
      deviceNotFound: '未找到设备: {{name}}',
      windowNotFound: '未找到窗口: {{name}}',
      noSavedDevice: '没有保存的设备配置',
      connectFailed: '自动连接失败',
      resourceFailed: '资源加载失败',
      needConfig: '请先连接设备并加载资源，或在连接面板保存设备配置',
    },
  },

  // 任务项
  taskItem: {
    options: '配置选项',
    noOptions: '无可配置选项',
    enabled: '已启用',
    disabled: '已禁用',
    expand: '展开选项',
    collapse: '折叠选项',
    remove: '移除任务',
    rename: '重命名',
    renameTask: '重命名任务',
    customName: '自定义名称',
    originalName: '原始名称',
  },

  // 选项
  option: {
    select: '请选择',
    input: '请输入',
    yes: '是',
    no: '否',
    invalidInput: '输入格式不正确',
  },

  // 控制器
  controller: {
    title: '控制器',
    selectController: '选择控制器',
    adb: 'Android 设备',
    win32: 'Windows 窗口',
    playcover: 'PlayCover (macOS)',
    gamepad: '游戏手柄',
    connecting: '连接中...',
    connected: '已连接',
    disconnected: '未连接',
    connectionFailed: '连接失败',
    refreshDevices: '刷新设备',
    refresh: '刷新设备',
    connect: '连接',
    disconnect: '断开连接',
    selectDevice: '请选择设备',
    noDevices: '未找到设备',
    playcoverHint: '输入 PlayCover 应用监听地址',
  },

  // 资源
  resource: {
    title: '资源包',
    selectResource: '选择资源包',
    loading: '加载资源中...',
    loaded: '资源已加载',
    loadFailed: '资源加载失败',
    loadResource: '加载资源',
  },

  // MaaFramework
  maa: {
    notInitialized: 'MaaFramework 未初始化',
    initFailed: '初始化失败',
    version: '版本',
    needConnection: '请先连接设备',
    needResource: '请先加载资源',
  },

  // 截图预览
  screenshot: {
    title: '实时截图',
    autoRefresh: '自动刷新',
    noScreenshot: '暂无截图',
    startStream: '开始实时流',
    stopStream: '停止实时流',
    connectFirst: '请先连接设备',
    fullscreen: '全屏显示',
    exitFullscreen: '退出全屏',
  },

  // 日志/信息流
  logs: {
    title: '运行日志',
    clear: '清空',
    autoscroll: '自动滚动',
    noLogs: '暂无日志',
    copyAll: '复制全部',
    expand: '展开上方面板',
    collapse: '折叠上方面板',
  },

  // 添加任务面板
  addTaskPanel: {
    title: '添加任务',
    searchPlaceholder: '搜索任务...',
    noResults: '没有找到匹配的任务',
    alreadyAdded: '已添加',
  },

  // 关于
  about: {
    title: '关于',
    version: '版本',
    description: '描述',
    license: '许可证',
    contact: '联系方式',
    github: 'GitHub 仓库',
  },

  // 调试
  debug: {
    title: '调试',
    versions: '版本信息',
    interfaceVersion: 'interface 版本',
    maafwVersion: 'maafw 版本',
    mxuVersion: 'mxu 版本',
  },

  // 欢迎弹窗
  welcome: {
    dismiss: '我知道了',
  },

  // 实例
  instance: {
    defaultName: '配置 1',
  },

  // 连接面板
  connection: {
    title: '连接设置',
  },

  // 中控台
  dashboard: {
    title: '中控台',
    toggle: '中控台视图',
    exit: '退出中控台',
    instances: '个实例',
    noInstances: '暂无实例',
    running: '运行中',
    succeeded: '已完成',
    failed: '已失败',
  },

  // 最近关闭
  recentlyClosed: {
    title: '最近关闭',
    empty: '暂无最近关闭的标签页',
    reopen: '重新打开',
    remove: '从列表中移除',
    clearAll: '清空列表',
    justNow: '刚刚',
    minutesAgo: '{{count}} 分钟前',
    hoursAgo: '{{count}} 小时前',
    daysAgo: '{{count}} 天前',
    noTasks: '无任务',
    tasksCount: '{{first}} 等 {{count}} 个任务',
  },

  // MirrorChyan 更新
  mirrorChyan: {
    title: '软件更新',
    channel: '更新频道',
    channelStable: '正式版',
    channelBeta: '公测版',
    cdk: 'Mirror酱 CDK',
    cdkPlaceholder: '输入您的 CDK（可选）',
    cdkHint: 'CDK 用于获取下载链接，无 CDK 也可检查更新',
    getCdk: '获取 CDK',
    checkUpdate: '检查更新',
    checking: '正在检查...',
    upToDate: '当前已是最新版本 ({{version}})',
    newVersion: '发现新版本',
    currentVersion: '当前版本',
    latestVersion: '最新版本',
    releaseNotes: '更新日志',
    downloadNow: '立即下载',
    later: '稍后提醒',
    dismiss: '忽略此版本',
    noReleaseNotes: '暂无更新日志',
    checkFailed: '检查更新失败',
    downloading: '下载中',
    downloadComplete: '下载完成',
    viewDetails: '查看详情',
  },

  // 定时执行
  schedule: {
    title: '定时执行',
    button: '定时',
    addPolicy: '添加定时策略',
    defaultPolicyName: '策略',
    policyName: '策略名称',
    noPolicies: '暂无定时策略',
    noPoliciesHint: '添加策略以自动执行任务',
    repeatDays: '重复日期',
    startTime: '开始时间',
    selectDays: '选择日期...',
    selectHours: '选择时间...',
    noWeekdays: '未选择日期',
    noHours: '未选择时间',
    everyday: '每天',
    everyHour: '每小时',
    all: '全部',
    hoursSelected: '个时间点',
    timeZoneHint: '使用本地时区 (UTC+8)',
    multiSelect: '可多选',
    enable: '启用策略',
    disable: '禁用策略',
    hint: '定时策略将在设定时间自动开始任务',
  },

  // 错误消息
  errors: {
    loadInterfaceFailed: '加载 interface.json 失败',
    invalidInterface: 'interface.json 格式无效',
    invalidConfig: '配置文件格式无效',
    taskNotFound: '任务不存在',
    controllerNotFound: '控制器不存在',
    resourceNotFound: '资源包不存在',
  },

  // 右键菜单
  contextMenu: {
    // Tab 右键菜单
    newTab: '新建标签页',
    duplicateTab: '复制标签页',
    renameTab: '重命名',
    moveLeft: '向左移动',
    moveRight: '向右移动',
    moveToFirst: '移到最左',
    moveToLast: '移到最右',
    closeTab: '关闭标签页',
    closeOtherTabs: '关闭其他标签页',
    closeAllTabs: '关闭所有标签页',
    closeTabsToRight: '关闭右侧标签页',
    
    // 任务右键菜单
    addTask: '添加任务',
    duplicateTask: '复制任务',
    deleteTask: '删除任务',
    renameTask: '重命名任务',
    enableTask: '启用任务',
    disableTask: '禁用任务',
    moveUp: '上移',
    moveDown: '下移',
    moveToTop: '置顶',
    moveToBottom: '置底',
    expandOptions: '展开选项',
    collapseOptions: '折叠选项',
    selectAll: '全选任务',
    deselectAll: '取消全选',
    expandAllTasks: '展开全部',
    collapseAllTasks: '折叠全部',
    
    // 截图面板右键菜单
    reconnect: '重新连接',
    forceRefresh: '强制刷新',
    startStream: '开始实时流',
    stopStream: '停止实时流',
    fullscreen: '全屏显示',
    saveScreenshot: '保存截图',
    copyScreenshot: '复制截图',
    
    // 连接面板右键菜单
    refreshDevices: '刷新设备列表',
    disconnect: '断开连接',
    
    // 通用
    openFolder: '打开所在文件夹',
  },
};
