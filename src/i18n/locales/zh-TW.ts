export default {
  // 通用
  common: {
    confirm: '確定',
    cancel: '取消',
    save: '儲存',
    delete: '刪除',
    edit: '編輯',
    add: '新增',
    close: '關閉',
    loading: '載入中...',
    error: '錯誤',
    success: '成功',
    warning: '警告',
    info: '提示',
    resizeOrCollapse: '拖動調整寬度，向右拖動到底可摺疊',
    copySuffix: '（副本）',
  },

  // 標題列
  titleBar: {
    newTab: '新標籤頁',
    closeTab: '關閉標籤頁',
    settings: '設定',
    about: '關於',
    renameInstance: '重新命名執行個體',
    instanceName: '執行個體名稱',
    dragToReorder: '拖動以重新排序',
  },

  // 視窗控制按钮
  windowControls: {
    minimize: '最小化',
    maximize: '最大化',
    restore: '還原',
    close: '關閉',
  },

  // 設定
  settings: {
    title: '設定',
    appearance: '外觀',
    language: '語言',
    theme: '主題',
    themeLight: '淺色',
    themeDark: '深色',
    accentColor: '強調色',
    themeSystem: '系統',
    showOptionPreview: '顯示選項預覽',
    showOptionPreviewHint: '在任務列表中顯示選項的快捷預覽資訊',
    openLogDir: '開啟日誌目錄',
  },

  // 任務列表
  taskList: {
    title: '任務列表',
    selectAll: '全選',
    deselectAll: '取消全選',
    collapseAll: '全部摺疊',
    expandAll: '全部展開',
    addTask: '新增任務',
    noTasks: '暫無任務',
    dragToReorder: '拖動以重新排序',
    startTasks: '開始任務',
    stopTasks: '停止任務',
    startingTasks: '啟動中...',
    stoppingTasks: '停止中...',
    // 自動連接相关
    autoConnect: {
      searching: '搜尋裝置...',
      searchingWindow: '搜尋視窗...',
      connecting: '連接裝置...',
      connectingWindow: '連接視窗...',
      loadingResource: '載入資源...',
      deviceNotFound: '未找到裝置: {{name}}',
      windowNotFound: '未找到視窗: {{name}}',
      noSavedDevice: '沒有儲存的裝置設定',
      connectFailed: '自動連接失敗',
      resourceFailed: '資源載入失敗',
      needConfig: '請先連接裝置並載入資源，或在連接面板儲存裝置設定',
    },
  },

  // 任務项
  taskItem: {
    options: '設定選項',
    noOptions: '無可設定選項',
    enabled: '已啟用',
    disabled: '已停用',
    expand: '展開選項',
    collapse: '摺疊選項',
    remove: '移除任務',
    rename: '重新命名',
    clickToToggle: '單擊選中/取消',
    renameTask: '重新命名任務',
    customName: '自訂名稱',
    originalName: '原始名稱',
    cannotEditRunningTask: '已執行或正在執行的任務無法編輯選項',
    // 描述內容載入
    loadingDescription: '載入描述中...',
    loadedFromFile: '內容来自本機檔案',
    loadedFromUrl: '內容来自網路',
    loadDescriptionFailed: '載入失敗',
    // 任務執行狀態
    status: {
      idle: '未執行',
      pending: '等待中',
      running: '執行中',
      succeeded: '已完成',
      failed: '執行失敗',
    },
    // 任務相容性
    incompatibleController: '不支援目前控制器',
    incompatibleResource: '不支援目前資源',
  },

  // 選項
  option: {
    select: '請選擇',
    input: '請輸入',
    yes: '是',
    no: '否',
    invalidInput: '輸入格式不正確',
  },

  // 選項編輯器
  optionEditor: {
    loadingDescription: '載入描述中...',
    loadedFromFile: '內容来自本機檔案',
    loadedFromUrl: '內容来自網路',
    loadDescriptionFailed: '載入失敗',
  },

  // 控制器
  controller: {
    title: '控制器',
    selectController: '選擇控制器',
    adb: 'Android 裝置',
    win32: 'Windows 視窗',
    playcover: 'PlayCover (macOS)',
    gamepad: '遊戲控制器',
    connecting: '連接中...',
    connected: '已連接',
    disconnected: '未連接',
    connectionFailed: '連接失敗',
    refreshDevices: '重新整理裝置',
    refresh: '重新整理裝置',
    connect: '連接',
    disconnect: '中斷連接',
    selectDevice: '請選擇裝置',
    selectWindow: '請選擇視窗',
    noDevices: '未找到裝置',
    noWindows: '未找到視窗',
    playcoverHint: '輸入 PlayCover 應用程式監聽位址',
    lastSelected: '上次選擇 · 點擊搜尋',
    savedDeviceNotFound: '未找到上次的裝置，請檢查連接或重新選擇',
  },

  // 資源
  resource: {
    title: '資源包',
    selectResource: '選擇資源包',
    loading: '載入資源中...',
    loaded: '資源已載入',
    loadFailed: '資源載入失敗',
    loadResource: '載入資源',
    switchFailed: '切換資源失敗',
    cannotSwitchWhileRunning: '任務執行中無法切換資源',
    incompatibleController: '不支援目前控制器',
  },

  // MaaFramework
  maa: {
    notInitialized: 'MaaFramework 未初始化',
    initFailed: '初始化失敗',
    version: '版本',
    needConnection: '請先連接裝置',
    needResource: '請先載入資源',
  },

  // 截圖預覽
  screenshot: {
    title: '即時截圖',
    autoRefresh: '自動重新整理',
    noScreenshot: '暫無截圖',
    startStream: '開始即時流',
    stopStream: '停止即時流',
    connectFirst: '請先連接裝置',
    fullscreen: '全螢幕顯示',
    exitFullscreen: '退出全螢幕',
    // 幀率設定
    frameRate: {
      title: '即時截圖幀率',
      hint: '僅影响畫面預覽流暢度與系統資源佔用，不影响任務識別與執行',
      unlimited: '不限',
      fps5: '每秒 5 幀',
      fps1: '每秒 1 幀',
      every5s: '5 秒一幀',
      every30s: '30 秒一幀',
    },
  },

  // 日誌/資訊流
  logs: {
    title: '執行日誌',
    clear: '清空',
    autoscroll: '自動捲動',
    noLogs: '暫無日誌',
    copyAll: '複製全部',
    expand: '展開上方面板',
    collapse: '摺疊上方面板',
    // 日誌訊息
    messages: {
      // 連接訊息
      connecting: '正在連接{{target}} ...',
      connected: '{{target}}連接成功:',
      connectFailed: '{{target}}連接失敗:',
      targetDevice: '裝置',
      targetWindow: '視窗',
      // 資源載入訊息
      loadingResource: '正在載入資源: {{name}}',
      resourceLoaded: '資源載入成功: {{name}}',
      resourceFailed: '資源載入失敗: {{name}}',
      // 任務訊息
      taskStarting: '任務開始: {{name}}',
      taskSucceeded: '任務完成: {{name}}',
      taskFailed: '任務失敗: {{name}}',
      stopTask: '停止任務',
      // 定時任務訊息
      scheduleStarting: '定時執行開始 [{{policy}}] {{time}}',
      // Agent 訊息
      agentStarting: 'Agent 正在啟動...',
      agentStarted: 'Agent 已啟動',
      agentConnected: 'Agent 已連接',
      agentDisconnected: 'Agent 已中斷',
      agentFailed: 'Agent 啟動失敗',
    },
  },

  // 新增任務面板
  addTaskPanel: {
    title: '新增任務',
    searchPlaceholder: '搜尋任務...',
    noResults: '沒有找到符合的任務',
    alreadyAdded: '已新增',
  },

  // 關於
  about: {
    title: '關於',
    version: '版本',
    description: '描述',
    license: '授權',
    contact: '聯絡方式',
    github: 'GitHub 儲存庫',
  },

  // 除錯
  debug: {
    title: '除錯',
    versions: '版本資訊',
    interfaceVersion: '{{name}} 版本',
    maafwVersion: 'maafw 版本',
    mxuVersion: 'mxu 版本',
    environment: '執行環境',
    envTauri: 'Tauri 桌面端',
    envBrowser: '瀏覽器',
    pathInfo: '路徑資訊',
    cwd: '目前工作目錄',
    exeDir: '程式所在目錄',
    resetWindowSize: '重設視窗尺寸',
    openConfigDir: '開啟設定目錄',
    openLogDir: '開啟日誌目錄',
    clearCache: '清空快取',
    cacheCleared: '快取已清空',
    cacheStats: '快取項目: {{count}} 條',
    devMode: '開發模式',
    devModeHint: '啟用後允許按 F5 重新整理 UI',
    saveDraw: '儲存除錯圖像',
    saveDrawHint: '儲存識別和操作的除錯圖像到日誌目錄（重啟軟體後自動關閉）',
  },

  // 欢迎彈窗
  welcome: {
    dismiss: '我知道了',
  },

  // 新用戶引導
  onboarding: {
    title: '從這裡開始',
    message: '首先在「連接設定」中選擇裝置並載入資源，然後就可以開始執行任務了。',
    gotIt: '知道了',
  },

  // 執行個體
  instance: {
    defaultName: '設定',
  },

  // 連接面板
  connection: {
    title: '連接設定',
  },

  // 中控台
  dashboard: {
    title: '中控台',
    toggle: '中控台檢視',
    exit: '退出中控台',
    instances: '個執行個體',
    noInstances: '暫無執行個體',
    running: '執行中',
    succeeded: '已完成',
    failed: '已失敗',
    noEnabledTasks: '沒有啟用的任務',
  },

  // 最近關閉
  recentlyClosed: {
    title: '最近關閉',
    empty: '暫無最近關閉的標籤頁',
    reopen: '重新開啟',
    remove: '從列表中移除',
    clearAll: '清空列表',
    justNow: '剛剛',
    minutesAgo: '{{count}} 分鐘前',
    hoursAgo: '{{count}} 小時前',
    daysAgo: '{{count}} 天前',
    noTasks: '無任務',
    tasksCount: '{{first}} 等 {{count}} 個任務',
  },

  // MirrorChyan 更新
  mirrorChyan: {
    title: '更新',
    debugModeNotice: '目前為除錯版本，已停用自動更新功能',
    channel: '更新頻道',
    channelStable: '正式版',
    channelBeta: '公測版',
    cdk: 'Mirror酱 CDK',
    cdkPlaceholder: '輸入您的 CDK（可選）',
    serviceName: 'Mirror酱',
    cdkHintAfterLink:
      ' 是獨立的第三方加速下載服務，需要付費使用，並非「{{projectName}}」收費。其營運成本由訂閱收入支撐，部分收益將回饋專案開發者。歡迎訂閱 CDK 享受高速下載，同時支援專案持續開發。未填寫 CDK 時將自動透過 GitHub 下載，若失敗請嘗試設定網路代理。',
    getCdk: '沒有CDK？立即訂閱',
    cdkHint: '請檢查您的 CDK 是否正確或已過期',
    checkUpdate: '檢查更新',
    checking: '正在檢查...',
    upToDate: '目前已是最新版本 ({{version}})',
    newVersion: '發現新版本',
    currentVersion: '目前版本',
    latestVersion: '最新版本',
    releaseNotes: '更新日誌',
    downloadNow: '立即下載',
    later: '稍後提醒',
    dismiss: '忽略此版本',
    noReleaseNotes: '暫無更新日誌',
    checkFailed: '檢查更新失敗',
    downloading: '下載中',
    downloadComplete: '下載完成',
    downloadFailed: '下載失敗',
    viewDetails: '查看詳情',
    noDownloadUrl: '無可用下載連結，請填寫 CDK 或檢查網路環境',
    openFolder: '開啟目錄',
    retry: '重試',
    preparingDownload: '準備下載...',
    downloadFromGitHub: '透過 海外渠道（GitHub）下載',
    downloadFromMirrorChyan: '透過 Mirror酱 CDN 下載',
    // 更新安裝
    installing: '正在安裝更新...',
    installComplete: '安裝完成',
    installFailed: '安裝失敗',
    installNow: '立即安裝',
    installUpdate: '安裝更新',
    installStages: {
      extracting: '正在解壓...',
      checking: '檢查更新類型...',
      applying: '正在應用程式更新...',
      cleanup: '清理暫存檔案...',
      done: '更新完成',
      incremental: '增量更新',
      full: '全量更新',
      fallback: '正在執行兜底更新...',
    },
    restartRequired: '更新已安裝，請重啟應用程式以生效',
    restartNow: '立即重啟',
    restarting: '正在重啟...',
    // 更新完成後
    updateCompleteTitle: '更新完成',
    updateCompleteMessage: '已成功更新到最新版本',
    previousVersion: '更新前版本',
    gotIt: '知道了',
    // MirrorChyan API 錯誤码
    errors: {
      1001: '參數不正確，請檢查設定',
      7001: 'CDK 已過期，請續費或更換 CDK',
      7002: 'CDK 錯誤，請檢查輸入是否正確',
      7003: 'CDK 今日下載次數已達上限',
      7004: 'CDK 類型與資源不符合',
      7005: 'CDK 已被封禁，請聯絡客服',
      8001: '目前系統/架構暫無可用資源',
      8002: '系統參數錯誤',
      8003: '架構參數錯誤',
      8004: '更新通道參數錯誤',
      1: '服務異常，請稍後重試',
      unknown: '未知錯誤 ({{code}}): {{message}}',
      negative: '服務器錯誤，請聯絡技術支援',
    },
  },

  // 定時執行
  schedule: {
    title: '定時執行',
    button: '定時',
    addPolicy: '新增定時策略',
    defaultPolicyName: '策略',
    policyName: '策略名稱',
    noPolicies: '暫無定時策略',
    noPoliciesHint: '新增策略以自動執行任務',
    repeatDays: '重複日期',
    startTime: '開始時間',
    selectDays: '選擇日期...',
    selectHours: '選擇時間...',
    noWeekdays: '未選擇日期',
    noHours: '未選擇時間',
    everyday: '每天',
    everyHour: '每小時',
    all: '全部',
    hoursSelected: '個時間点',
    timeZoneHint: '使用本地時區 (UTC+8)',
    multiSelect: '可多選',
    enable: '啟用策略',
    disable: '停用策略',
    hint: '定時策略將在設定時間自動開始任務',
    executingPolicy: '正在按照「{{name}}」定時執行',
    startedAt: '開始時間: {{time}}',
    // 索引對應 Date.getDay()：0=週日, 1=週一, ..., 6=週六
    weekdays: ['週日', '週一', '週二', '週三', '週四', '週五', '週六'],
  },

  // 錯誤訊息
  errors: {
    loadInterfaceFailed: '載入 interface.json 失敗',
    invalidInterface: 'interface.json 格式無效',
    invalidConfig: '設定檔案格式無效',
    taskNotFound: '任務不存在',
    controllerNotFound: '控制器不存在',
    resourceNotFound: '資源包不存在',
  },

  // 右鍵選單
  contextMenu: {
    // Tab 右鍵選單
    newTab: '新增標籤頁',
    duplicateTab: '複製標籤頁',
    renameTab: '重新命名',
    moveLeft: '向左移動',
    moveRight: '向右移動',
    moveToFirst: '移到最左',
    moveToLast: '移到最右',
    closeTab: '關閉標籤頁',
    closeOtherTabs: '關閉其他標籤頁',
    closeAllTabs: '關閉所有標籤頁',
    closeTabsToRight: '關閉右側標籤頁',

    // 任務右鍵選單
    addTask: '新增任務',
    duplicateTask: '複製任務',
    deleteTask: '刪除任務',
    renameTask: '重新命名任務',
    enableTask: '啟用任務',
    disableTask: '停用任務',
    moveUp: '上移',
    moveDown: '下移',
    moveToTop: '置頂',
    moveToBottom: '置底',
    expandOptions: '展開選項',
    collapseOptions: '摺疊選項',
    selectAll: '全選任務',
    deselectAll: '取消全選',
    expandAllTasks: '展開全部',
    collapseAllTasks: '摺疊全部',

    // 截圖面板右鍵選單
    reconnect: '重新連接',
    forceRefresh: '強制重新整理',
    startStream: '開始即時流',
    stopStream: '停止即時流',
    fullscreen: '全螢幕顯示',
    saveScreenshot: '儲存截圖',
    copyScreenshot: '複製截圖',

    // 連接面板右鍵選單
    refreshDevices: '重新整理裝置列表',
    disconnect: '中斷連接',

    // 通用
    openFolder: '開啟所在資料夾',
  },

  // 版本警告
  versionWarning: {
    title: 'MaaFramework 版本過低',
    message:
      '目前 MaaFramework 版本 ({{current}}) 低於最低支援版本 ({{minimum}})，部分功能可能無法正常工作。',
    suggestion: '請聯絡專案開發者更新 MaaFramework 版本。',
    understand: '我已了解',
  },

  // 權限提示
  permission: {
    title: '需要管理員權限',
    message: '目前控制器需要管理員權限才能正常操作目標視窗。請以管理員身分重啟應用程式。',
    hint: '重啟後將自動恢復目前設定。',
    restart: '以管理員身分重啟',
    restarting: '正在重啟...',
  },

  // VC++ 執行库
  vcredist: {
    title: '缺少執行库',
    description: 'MaaFramework 需要 Microsoft Visual C++ 執行库才能正常工作。',
    downloading: '正在下載執行库...',
    downloadFailed: '下載失敗',
    waitingInstall: '正在等待安裝完成，請在彈出的安裝程式中完成安裝...',
    retrying: '正在重新載入...',
    success: '執行库安裝成功！',
    stillFailed: '安裝完成，但載入仍然失敗。請重啟電腦後再試。',
    restartHint: '如果問題仍然存在，請重啟電腦後再試。',
    retry: '重試',
  },

  // 程式路徑問題提示
  badPath: {
    title: '程式位置不對',
    rootTitle: '別把程式放在磁碟根目錄啦！',
    rootDescription:
      '程式放在 C盤、D盤 這種根目錄下會出問題的。找個資料夾放進去再用吧，比如「D:\\MyApps\\」之類的。',
    tempTitle: '你好像直接雙擊壓縮檔裡的程式了',
    tempDescription:
      '程式現在在暫存目錄裡跑著呢，一關掉可能就沒了。先把壓縮檔解壓到一個資料夾裡，再開啟裡面的程式吧。',
    hint: '小提示：建議解壓到一個專門的資料夾，比如「D:\\MaaXXX」，别放桌面或者下載資料夾，那樣更方便管理。',
    exit: '退出程式',
  },
};
