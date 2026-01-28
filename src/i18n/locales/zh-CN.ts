export default {
  // 通用
  common: {
    confirm: '确定',
    cancel: '取消',
    undo: '撤销',
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
    resizeOrCollapse: '拖动调整宽度，向右拖动到底可折叠',
    copySuffix: '（副本）',
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

  // 窗口控制按钮
  windowControls: {
    minimize: '最小化',
    maximize: '最大化',
    restore: '还原',
    close: '关闭',
  },

  // 设置
  settings: {
    title: '设置',
    appearance: '外观',
    hotkeys: '快捷键',
    language: '语言',
    theme: '主题',
    themeLight: '浅色',
    themeDark: '深色',
    accentColor: '强调色',
    themeSystem: '系统',
    showOptionPreview: '显示选项预览',
    showOptionPreviewHint: '在任务列表中显示选项的快捷预览信息',
    openLogDir: '打开日志目录',
    // 自定义强调色
    customAccents: '自定义强调色',
    addCustomAccent: '添加',
    editCustomAccent: '编辑自定义强调色',
    deleteCustomAccent: '删除',
    noCustomAccents: '暂无自定义强调色',
    customAccentNameRequired: '请输入名称',
    deleteCustomAccentConfirm: '确定要删除这个自定义强调色吗？',
    customAccentDeleted: '已删除 {{name}}',
    accentName: '名称',
    accentNamePlaceholder: '例如：小黑紫',
    autoAccentName: '{{hex}}',
    accentMainColor: '主色',
    accentHoverColor: '悬停色',
    accentLightColor: '浅色背景',
    accentLightDarkColor: '深色背景',
    hotkeysStartTasks: '开始任务快捷键',
    hotkeysStopTasks: '结束任务快捷键',
    hotkeysHint:
      '仅在主界面中生效，用于开始 / 结束当前实例的任务。支持组合键（如 Ctrl+F10、Ctrl+Shift+F11），纯 F5/F12 仍保留为系统/浏览器快捷键。',
    hotkeysConflict: '开始和结束快捷键不应相同，请选择不同的按键',
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
      searchingWindow: '搜索窗口...',
      connecting: '连接设备...',
      connectingWindow: '连接窗口...',
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
    clickToToggle: '单击选中/取消',
    renameTask: '重命名任务',
    customName: '自定义名称',
    originalName: '原始名称',
    cannotEditRunningTask: '已执行或正在执行的任务无法编辑选项',
    // 描述内容加载
    loadingDescription: '加载描述中...',
    loadedFromFile: '内容来自本地文件',
    loadedFromUrl: '内容来自网络',
    loadDescriptionFailed: '加载失败',
    // 任务运行状态
    status: {
      idle: '未执行',
      pending: '等待中',
      running: '执行中',
      succeeded: '已完成',
      failed: '执行失败',
    },
    // 任务兼容性
    incompatibleController: '不支持当前控制器',
    incompatibleResource: '不支持当前资源',
  },

  // 选项
  option: {
    select: '请选择',
    input: '请输入',
    yes: '是',
    no: '否',
    invalidInput: '输入格式不正确',
  },

  // 选项编辑器
  optionEditor: {
    loadingDescription: '加载描述中...',
    loadedFromFile: '内容来自本地文件',
    loadedFromUrl: '内容来自网络',
    loadDescriptionFailed: '加载失败',
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
    selectWindow: '请选择窗口',
    noDevices: '未找到设备',
    noWindows: '未找到窗口',
    playcoverHint: '输入 PlayCover 应用监听地址',
    lastSelected: '上次选择 · 点击搜索',
    savedDeviceNotFound: '未找到上次的设备，请检查连接或重新选择',
  },

  // 资源
  resource: {
    title: '资源包',
    selectResource: '选择资源包',
    loading: '加载资源中...',
    loaded: '资源已加载',
    loadFailed: '资源加载失败',
    loadResource: '加载资源',
    switchFailed: '切换资源失败',
    cannotSwitchWhileRunning: '任务运行中无法切换资源',
    incompatibleController: '不支持当前控制器',
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
    // 帧率设置
    frameRate: {
      title: '实时截图帧率',
      hint: '仅影响画面预览流畅度与系统资源占用，不影响任务识别与执行',
      unlimited: '不限',
      fps5: '每秒 5 帧',
      fps1: '每秒 1 帧',
      every5s: '5 秒一帧',
      every30s: '30 秒一帧',
    },
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
    // 日志消息
    messages: {
      // 连接消息
      connecting: '正在连接{{target}} ...',
      connected: '{{target}}连接成功:',
      connectFailed: '{{target}}连接失败:',
      targetDevice: '设备',
      targetWindow: '窗口',
      // 资源加载消息
      loadingResource: '正在加载资源: {{name}}',
      resourceLoaded: '资源加载成功: {{name}}',
      resourceFailed: '资源加载失败: {{name}}',
      // 任务消息
      taskStarting: '任务开始: {{name}}',
      taskSucceeded: '任务完成: {{name}}',
      taskFailed: '任务失败: {{name}}',
      stopTask: '停止任务',
      // 定时任务消息
      scheduleStarting: '定时执行开始 [{{policy}}] {{time}}',
      // Agent 消息
      agentStarting: 'Agent 正在启动...',
      agentStarted: 'Agent 已启动',
      agentConnected: 'Agent 已连接',
      agentDisconnected: 'Agent 已断开',
      agentFailed: 'Agent 启动失败',
    },
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
    interfaceVersion: '{{name}} 版本',
    maafwVersion: 'maafw 版本',
    mxuVersion: 'mxu 版本',
    environment: '运行环境',
    envTauri: 'Tauri 桌面端',
    envBrowser: '浏览器',
    systemInfo: '系统信息',
    operatingSystem: '操作系统',
    architecture: '系统架构',
    tauriVersion: 'Tauri 版本',
    pathInfo: '路径信息',
    cwd: '当前工作目录',
    exeDir: '程序所在目录',
    resetWindowSize: '重置窗口尺寸',
    openConfigDir: '打开配置目录',
    openLogDir: '打开日志目录',
    clearCache: '清空缓存',
    cacheCleared: '缓存已清空',
    cacheStats: '缓存条目: {{count}} 条',
    devMode: '开发模式',
    devModeHint: '启用后允许按 F5 刷新 UI',
    saveDraw: '保存调试图像',
    saveDrawHint: '保存识别和操作的调试图像到日志目录（重启软件后自动关闭）',
    tcpCompatMode: '通信兼容模式',
    tcpCompatModeHint: '若启动任务后软件立即闪退，可尝试开启。仅限此情况使用，否则会影响运行效率',
  },

  // 欢迎弹窗
  welcome: {
    dismiss: '我知道了',
  },

  // 新用户引导
  onboarding: {
    title: '从这里开始',
    message: '首先在「连接设置」中选择设备并加载资源，然后就可以开始运行任务了。',
    gotIt: '知道了',
  },

  // 实例
  instance: {
    defaultName: '配置',
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
    noEnabledTasks: '没有启用的任务',
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
    title: '更新',
    debugModeNotice: '当前为调试版本，已禁用自动更新功能',
    channel: '更新频道',
    channelStable: '正式版',
    channelBeta: '公测版',
    cdk: 'Mirror酱 CDK',
    cdkPlaceholder: '输入您的 CDK（可选）',
    serviceName: 'Mirror酱',
    cdkHintAfterLink:
      ' 是独立的第三方加速下载服务，需要付费使用，并非「{{projectName}}」收费。其运营成本由订阅收入支撑，部分收益将回馈项目开发者。欢迎订阅 CDK 享受高速下载，同时支持项目持续开发。未填写 CDK 时将自动通过 GitHub 下载，若失败请尝试配置网络代理。',
    getCdk: '没有CDK？立即订阅',
    cdkHint: '请检查您的 CDK 是否正确或已过期',
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
    downloadFailed: '下载失败',
    viewDetails: '查看详情',
    noDownloadUrl: '无可用下载链接，请填写 CDK 或检查网络环境',
    openFolder: '打开目录',
    retry: '重试',
    preparingDownload: '准备下载...',
    downloadFromGitHub: '通过 海外渠道（GitHub）下载',
    downloadFromMirrorChyan: '通过 Mirror酱 CDN 下载',
    // 更新安装
    installing: '正在安装更新...',
    installComplete: '安装完成',
    installFailed: '安装失败',
    installNow: '立即安装',
    installUpdate: '安装更新',
    installStages: {
      extracting: '正在解压...',
      checking: '检查更新类型...',
      applying: '正在应用更新...',
      cleanup: '清理临时文件...',
      done: '更新完成',
      incremental: '增量更新',
      full: '全量更新',
      fallback: '正在执行兜底更新...',
    },
    restartRequired: '更新已安装，请重启应用以生效',
    restartNow: '立即重启',
    restarting: '正在重启...',
    // 更新完成后
    updateCompleteTitle: '更新完成',
    updateCompleteMessage: '已成功更新到最新版本',
    previousVersion: '更新前版本',
    gotIt: '知道了',
    // MirrorChyan API 错误码
    errors: {
      1001: '参数不正确，请检查配置',
      7001: 'CDK 已过期，请续费或更换 CDK',
      7002: 'CDK 错误，请检查输入是否正确',
      7003: 'CDK 今日下载次数已达上限',
      7004: 'CDK 类型与资源不匹配',
      7005: 'CDK 已被封禁，请联系客服',
      8001: '当前系统/架构暂无可用资源',
      8002: '系统参数错误',
      8003: '架构参数错误',
      8004: '更新通道参数错误',
      1: '服务异常，请稍后重试',
      unknown: '未知错误 ({{code}}): {{message}}',
      negative: '服务器错误，请联系技术支持',
    },
  },

  // 代理设置
  proxy: {
    title: '网络代理',
    url: '代理地址',
    urlPlaceholder: '例如：http://127.0.0.1:7890',
    urlHint: '支持 HTTP/SOCKS5，留空则不使用代理',
    urlHintDisabled: '已填写 Mirror酱 CDK，代理功能已禁用',
    invalid: '代理地址格式不正确',
    examples: '示例格式',
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
    executingPolicy: '正在按照「{{name}}」定时执行',
    startedAt: '开始时间: {{time}}',
    // 索引对应 Date.getDay()：0=周日, 1=周一, ..., 6=周六
    weekdays: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
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

  // 版本警告
  versionWarning: {
    title: 'MaaFramework 版本过低',
    message:
      '当前 MaaFramework 版本 ({{current}}) 低于最低支持版本 ({{minimum}})，部分功能可能无法正常工作。',
    suggestion: '请联系项目开发者更新 MaaFramework 版本。',
    understand: '我已了解',
  },

  // 权限提示
  permission: {
    title: '需要管理员权限',
    message: '当前控制器需要管理员权限才能正常操作目标窗口。请以管理员身份重启应用。',
    hint: '重启后将自动恢复当前配置。',
    restart: '以管理员身份重启',
    restarting: '正在重启...',
  },

  // VC++ 运行库
  vcredist: {
    title: '缺少运行库',
    description: 'MaaFramework 需要 Microsoft Visual C++ 运行库才能正常工作。',
    downloading: '正在下载运行库...',
    downloadFailed: '下载失败',
    waitingInstall: '正在等待安装完成，请在弹出的安装程序中完成安装...',
    retrying: '正在重新加载...',
    success: '运行库安装成功！',
    stillFailed: '安装完成，但加载仍然失败。请重启电脑后再试。',
    restartHint: '如果问题仍然存在，请重启电脑后再试。',
    retry: '重试',
  },

  // 程序路径问题提示
  badPath: {
    title: '程序位置不对',
    rootTitle: '别把程序放在磁盘根目录啦！',
    rootDescription:
      '程序放在 C盘、D盘 这种根目录下会出问题的。找个文件夹放进去再用吧，比如「D:\\MyApps\\」之类的。',
    tempTitle: '你好像直接双击压缩包里的程序了',
    tempDescription:
      '程序现在在临时目录里跑着呢，一关掉可能就没了。先把压缩包解压到一个文件夹里，再打开里面的程序吧。',
    hint: '小提示：建议解压到一个专门的文件夹，比如「D:\\MaaXXX」，别放桌面或者下载文件夹，那样更方便管理。',
    exit: '退出程序',
  },
};
