export default {
  // Common
  common: {
    confirm: 'Confirm',
    cancel: 'Cancel',
    undo: 'Undo',
    save: 'Save',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    close: 'Close',
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    warning: 'Warning',
    info: 'Info',
    resizeOrCollapse: 'Drag to resize, drag to the right edge to collapse',
    copySuffix: ' (Copy)',
  },

  // Title bar
  titleBar: {
    newTab: 'New Tab',
    closeTab: 'Close Tab',
    settings: 'Settings',
    about: 'About',
    renameInstance: 'Rename Instance',
    instanceName: 'Instance Name',
    dragToReorder: 'Drag to reorder',
  },

  // Window controls
  windowControls: {
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
  },

  // Settings
  settings: {
    title: 'Settings',
    appearance: 'Appearance',
    hotkeys: 'Hotkeys',
    language: 'Language',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    accentColor: 'Accent Color',
    themeSystem: 'System',
    showOptionPreview: 'Show Option Preview',
    showOptionPreviewHint: 'Display quick preview of options in the task list',
    openLogDir: 'Open Log Directory',
    // Custom accents
    customAccents: 'Custom Accents',
    addCustomAccent: 'Add',
    editCustomAccent: 'Edit Custom Accent',
    deleteCustomAccent: 'Delete',
    noCustomAccents: 'No custom accents yet',
    customAccentNameRequired: 'Please enter a name',
    deleteCustomAccentConfirm: 'Are you sure you want to delete this custom accent?',
    customAccentDeleted: 'Deleted {{name}}',
    accentName: 'Name',
    accentNamePlaceholder: 'e.g. Dark Violet',
    autoAccentName: '{{hex}}',
    accentMainColor: 'Main Color',
    accentHoverColor: 'Hover Color',
    accentLightColor: 'Light Background',
    accentLightDarkColor: 'Dark Background',
    hotkeysStartTasks: 'Start Tasks Hotkey',
    hotkeysStopTasks: 'Stop Tasks Hotkey',
    hotkeysHint:
      'Effective only on the main screen, used to start/stop tasks of the current instance. Modifier combinations are supported (e.g. Ctrl+F10, Ctrl+Shift+F11); plain F5/F12 remain reserved by the system/browser.',
    hotkeysConflict: 'Start and stop hotkeys should not be the same. Please choose different keys.',
  },

  // Task list
  taskList: {
    title: 'Task List',
    selectAll: 'Select All',
    deselectAll: 'Deselect All',
    collapseAll: 'Collapse All',
    expandAll: 'Expand All',
    addTask: 'Add Task',
    noTasks: 'No tasks',
    dragToReorder: 'Drag to reorder',
    startTasks: 'Start Tasks',
    stopTasks: 'Stop Tasks',
    startingTasks: 'Starting...',
    stoppingTasks: 'Stopping...',
    // Auto connect
    autoConnect: {
      searching: 'Searching devices...',
      searchingWindow: 'Searching windows...',
      connecting: 'Connecting device...',
      connectingWindow: 'Connecting window...',
      loadingResource: 'Loading resource...',
      deviceNotFound: 'Device not found: {{name}}',
      windowNotFound: 'Window not found: {{name}}',
      noSavedDevice: 'No saved device configuration',
      connectFailed: 'Auto connect failed',
      resourceFailed: 'Resource loading failed',
      needConfig:
        'Please connect device and load resource first, or save device config in connection panel',
    },
  },

  // Task item
  taskItem: {
    options: 'Options',
    noOptions: 'No configurable options',
    enabled: 'Enabled',
    disabled: 'Disabled',
    expand: 'Expand options',
    collapse: 'Collapse options',
    remove: 'Remove task',
    rename: 'Rename',
    clickToToggle: 'Click to toggle',
    renameTask: 'Rename Task',
    customName: 'Custom Name',
    originalName: 'Original Name',
    cannotEditRunningTask: 'Cannot edit options for running or completed tasks',
    // Description content loading
    loadingDescription: 'Loading description...',
    loadedFromFile: 'Content loaded from local file',
    loadedFromUrl: 'Content loaded from URL',
    loadDescriptionFailed: 'Failed to load',
    // Task run status
    status: {
      idle: 'Not started',
      pending: 'Pending',
      running: 'Running',
      succeeded: 'Completed',
      failed: 'Failed',
    },
    // Task compatibility
    incompatibleController: 'Not supported by current controller',
    incompatibleResource: 'Not supported by current resource',
  },

  // Options
  option: {
    select: 'Please select',
    input: 'Please enter',
    yes: 'Yes',
    no: 'No',
    invalidInput: 'Invalid input format',
  },

  // Option Editor
  optionEditor: {
    loadingDescription: 'Loading description...',
    loadedFromFile: 'Content loaded from local file',
    loadedFromUrl: 'Content loaded from URL',
    loadDescriptionFailed: 'Failed to load',
  },

  // Controller
  controller: {
    title: 'Controller',
    selectController: 'Select Controller',
    adb: 'Android Device',
    win32: 'Windows Window',
    playcover: 'PlayCover (macOS)',
    gamepad: 'Gamepad',
    connecting: 'Connecting...',
    connected: 'Connected',
    disconnected: 'Disconnected',
    connectionFailed: 'Connection failed',
    refreshDevices: 'Refresh Devices',
    refresh: 'Refresh Devices',
    connect: 'Connect',
    disconnect: 'Disconnect',
    selectDevice: 'Select a device',
    selectWindow: 'Select a window',
    noDevices: 'No devices found',
    noWindows: 'No windows found',
    playcoverHint: 'Enter PlayCover app listen address',
    lastSelected: 'Last selected · Click to search',
    savedDeviceNotFound: 'Previous device not found, please check connection or select another',
  },

  // Resource
  resource: {
    title: 'Resource',
    selectResource: 'Select Resource',
    loading: 'Loading resource...',
    loaded: 'Resource loaded',
    loadFailed: 'Failed to load resource',
    loadResource: 'Load Resource',
    switchFailed: 'Failed to switch resource',
    cannotSwitchWhileRunning: 'Cannot switch resource while tasks are running',
    incompatibleController: 'Not supported by current controller',
  },

  // MaaFramework
  maa: {
    notInitialized: 'MaaFramework not initialized',
    initFailed: 'Initialization failed',
    version: 'Version',
    needConnection: 'Please connect a device first',
    needResource: 'Please load resources first',
  },

  // Screenshot preview
  screenshot: {
    title: 'Live Screenshot',
    autoRefresh: 'Auto Refresh',
    noScreenshot: 'No screenshot',
    startStream: 'Start Live Stream',
    stopStream: 'Stop Live Stream',
    connectFirst: 'Please connect a device first',
    fullscreen: 'Fullscreen',
    exitFullscreen: 'Exit Fullscreen',
    // Frame rate settings
    frameRate: {
      title: 'Screenshot Frame Rate',
      hint: 'Only affects preview smoothness and system resource usage, does not impact task recognition or execution',
      unlimited: 'Unlimited',
      fps5: '5 FPS',
      fps1: '1 FPS',
      every5s: 'Every 5s',
      every30s: 'Every 30s',
    },
  },

  // Logs
  logs: {
    title: 'Logs',
    clear: 'Clear',
    autoscroll: 'Auto Scroll',
    noLogs: 'No logs',
    copyAll: 'Copy All',
    expand: 'Expand panels above',
    collapse: 'Collapse panels above',
    // Log messages
    messages: {
      // Connection messages
      connecting: 'Connecting to {{target}}...',
      connected: '{{target}} connected:',
      connectFailed: '{{target}} connection failed:',
      targetDevice: 'device',
      targetWindow: 'window',
      // Resource loading messages
      loadingResource: 'Loading resource: {{name}}',
      resourceLoaded: 'Resource loaded: {{name}}',
      resourceFailed: 'Resource load failed: {{name}}',
      // Task messages
      taskStarting: 'Task started: {{name}}',
      taskSucceeded: 'Task completed: {{name}}',
      taskFailed: 'Task failed: {{name}}',
      stopTask: 'Stop Task',
      // Schedule messages
      scheduleStarting: 'Scheduled execution started [{{policy}}] {{time}}',
      // Agent messages
      agentStarting: 'Agent starting...',
      agentStarted: 'Agent started',
      agentConnected: 'Agent connected',
      agentDisconnected: 'Agent disconnected',
      agentFailed: 'Agent start failed',
    },
  },

  // Add task panel
  addTaskPanel: {
    title: 'Add Task',
    searchPlaceholder: 'Search tasks...',
    noResults: 'No matching tasks found',
    alreadyAdded: 'Already added',
  },

  // About
  about: {
    title: 'About',
    version: 'Version',
    description: 'Description',
    license: 'License',
    contact: 'Contact',
    github: 'GitHub Repository',
  },

  // Debug
  debug: {
    title: 'Debug',
    versions: 'Versions',
    interfaceVersion: '{{name}} version',
    maafwVersion: 'maafw version',
    mxuVersion: 'mxu version',
    environment: 'Environment',
    envTauri: 'Tauri Desktop',
    envBrowser: 'Browser',
    systemInfo: 'System Information',
    operatingSystem: 'Operating System',
    architecture: 'Architecture',
    tauriVersion: 'Tauri Version',
    pathInfo: 'Path Information',
    cwd: 'Current Working Directory',
    exeDir: 'Executable Directory',
    resetWindowSize: 'Reset Window Size',
    openConfigDir: 'Open Config Dir',
    openLogDir: 'Open Log Dir',
    clearCache: 'Clear Cache',
    cacheCleared: 'Cache cleared',
    cacheStats: 'Cache entries: {{count}}',
    devMode: 'Developer Mode',
    devModeHint: 'Allow pressing F5 to refresh UI when enabled',
    saveDraw: 'Save Debug Images',
    saveDrawHint:
      'Save recognition and action debug images to log directory (auto-disabled on restart)',
    tcpCompatMode: 'Communication Compat Mode',
    tcpCompatModeHint: 'Try enabling this if the app crashes immediately after starting tasks. Only use in this case, as it may reduce performance',
  },

  // Welcome dialog
  welcome: {
    dismiss: 'Got it',
  },

  // Onboarding
  onboarding: {
    title: 'Start Here',
    message:
      'First, select a device and load resources in "Connection Settings", then you can start running tasks.',
    gotIt: 'Got it',
  },

  // Instance
  instance: {
    defaultName: 'Config 1',
  },

  // Connection panel
  connection: {
    title: 'Connection Settings',
  },

  // Dashboard
  dashboard: {
    title: 'Dashboard',
    toggle: 'Dashboard View',
    exit: 'Exit Dashboard',
    instances: 'instances',
    noInstances: 'No instances',
    running: 'Running',
    succeeded: 'Succeeded',
    failed: 'Failed',
    noEnabledTasks: 'No enabled tasks',
  },

  // Recently Closed
  recentlyClosed: {
    title: 'Recently Closed',
    empty: 'No recently closed tabs',
    reopen: 'Reopen',
    remove: 'Remove from list',
    clearAll: 'Clear all',
    justNow: 'Just now',
    minutesAgo: '{{count}} minutes ago',
    hoursAgo: '{{count}} hours ago',
    daysAgo: '{{count}} days ago',
    noTasks: 'No tasks',
    tasksCount: '{{first}} and {{count}} tasks',
  },

  // MirrorChyan Update
  mirrorChyan: {
    title: 'Update',
    debugModeNotice: 'Debug version detected, auto-update is disabled',
    channel: 'Update Channel',
    channelStable: 'Stable',
    channelBeta: 'Beta',
    cdk: 'MirrorChyan CDK',
    cdkPlaceholder: 'Enter your CDK (optional)',
    serviceName: 'MirrorChyan',
    cdkHintAfterLink:
      ' is an independent third-party accelerated download service that requires a paid subscription, not a fee charged by "{{projectName}}". Its operating costs are covered by subscription revenue, with a portion supporting project developers. Subscribe for high-speed downloads while supporting ongoing development. Without a CDK, downloads will fall back to GitHub. If that fails, please configure a network proxy.',
    getCdk: 'No CDKey? Subscribe Now',
    cdkHint: 'Please check if your CDK is correct or has expired',
    checkUpdate: 'Check for Updates',
    checking: 'Checking...',
    upToDate: 'You are up to date ({{version}})',
    newVersion: 'New Version Available',
    currentVersion: 'Current Version',
    latestVersion: 'Latest Version',
    releaseNotes: 'Release Notes',
    downloadNow: 'Download Now',
    later: 'Remind Later',
    dismiss: 'Skip This Version',
    noReleaseNotes: 'No release notes available',
    checkFailed: 'Failed to check for updates',
    downloading: 'Downloading',
    downloadComplete: 'Download Complete',
    downloadFailed: 'Download Failed',
    viewDetails: 'View Details',
    noDownloadUrl: 'No download URL available. Please fill in CDK or check network environment',
    openFolder: 'Open Folder',
    retry: 'Retry',
    preparingDownload: 'Preparing download...',
    downloadFromGitHub: 'Download from GitHub',
    downloadFromMirrorChyan: 'Download via MirrorChyan CDN',
    // Update installation
    installing: 'Installing update...',
    installComplete: 'Installation Complete',
    installFailed: 'Installation Failed',
    installNow: 'Install Now',
    installUpdate: 'Install Update',
    installStages: {
      extracting: 'Extracting...',
      checking: 'Checking update type...',
      applying: 'Applying update...',
      cleanup: 'Cleaning up...',
      done: 'Update complete',
      incremental: 'Incremental update',
      full: 'Full update',
      fallback: 'Performing fallback update...',
    },
    restartRequired: 'Update installed. Please restart to apply changes.',
    restartNow: 'Restart Now',
    restarting: 'Restarting...',
    // After update complete
    updateCompleteTitle: 'Update Complete',
    updateCompleteMessage: 'Successfully updated to the latest version',
    previousVersion: 'Previous Version',
    gotIt: 'Got it',
    // MirrorChyan API error codes
    errors: {
      1001: 'Invalid parameters, please check configuration',
      7001: 'CDK expired, please renew or replace your CDK',
      7002: 'Invalid CDK, please check your input',
      7003: 'CDK daily download quota exhausted',
      7004: 'CDK type does not match the resource',
      7005: 'CDK has been blocked, please contact support',
      8001: 'No resource available for current OS/architecture',
      8002: 'Invalid OS parameter',
      8003: 'Invalid architecture parameter',
      8004: 'Invalid update channel parameter',
      1: 'Service error, please try again later',
      unknown: 'Unknown error ({{code}}): {{message}}',
      negative: 'Server error, please contact technical support',
    },
  },

  // Schedule
  schedule: {
    title: 'Scheduled Tasks',
    button: 'Schedule',
    addPolicy: 'Add Schedule',
    defaultPolicyName: 'Schedule',
    policyName: 'Name',
    noPolicies: 'No schedules',
    noPoliciesHint: 'Add a schedule to run tasks automatically',
    repeatDays: 'Repeat Days',
    startTime: 'Start Time',
    selectDays: 'Select days...',
    selectHours: 'Select hours...',
    noWeekdays: 'No days selected',
    noHours: 'No hours selected',
    everyday: 'Every day',
    everyHour: 'Every hour',
    all: 'All',
    hoursSelected: 'hours selected',
    timeZoneHint: 'Using local timezone',
    multiSelect: 'multi-select',
    enable: 'Enable schedule',
    disable: 'Disable schedule',
    hint: 'Scheduled tasks will run automatically at set times',
    executingPolicy: 'Running scheduled "{{name}}"',
    startedAt: 'Started at: {{time}}',
    // Index corresponds to Date.getDay(): 0=Sun, 1=Mon, ..., 6=Sat
    weekdays: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  },

  // Error messages
  errors: {
    loadInterfaceFailed: 'Failed to load interface.json',
    invalidInterface: 'Invalid interface.json format',
    invalidConfig: 'Invalid configuration file format',
    taskNotFound: 'Task not found',
    controllerNotFound: 'Controller not found',
    resourceNotFound: 'Resource not found',
  },

  // Context Menu
  contextMenu: {
    // Tab context menu
    newTab: 'New Tab',
    duplicateTab: 'Duplicate Tab',
    renameTab: 'Rename',
    moveLeft: 'Move Left',
    moveRight: 'Move Right',
    moveToFirst: 'Move to First',
    moveToLast: 'Move to Last',
    closeTab: 'Close Tab',
    closeOtherTabs: 'Close Other Tabs',
    closeAllTabs: 'Close All Tabs',
    closeTabsToRight: 'Close Tabs to the Right',

    // Task context menu
    addTask: 'Add Task',
    duplicateTask: 'Duplicate Task',
    deleteTask: 'Delete Task',
    renameTask: 'Rename Task',
    enableTask: 'Enable Task',
    disableTask: 'Disable Task',
    moveUp: 'Move Up',
    moveDown: 'Move Down',
    moveToTop: 'Move to Top',
    moveToBottom: 'Move to Bottom',
    expandOptions: 'Expand Options',
    collapseOptions: 'Collapse Options',
    selectAll: 'Select All Tasks',
    deselectAll: 'Deselect All',
    expandAllTasks: 'Expand All',
    collapseAllTasks: 'Collapse All',

    // Screenshot panel context menu
    reconnect: 'Reconnect',
    forceRefresh: 'Force Refresh',
    startStream: 'Start Live Stream',
    stopStream: 'Stop Live Stream',
    fullscreen: 'Fullscreen',
    saveScreenshot: 'Save Screenshot',
    copyScreenshot: 'Copy Screenshot',

    // Connection panel context menu
    refreshDevices: 'Refresh Device List',
    disconnect: 'Disconnect',

    // Common
    openFolder: 'Open Containing Folder',
  },

  // Version warning
  versionWarning: {
    title: 'MaaFramework Version Too Low',
    message:
      'Current MaaFramework version ({{current}}) is lower than the minimum supported version ({{minimum}}). Some features may not work properly.',
    suggestion: 'Please contact the project developer to update MaaFramework.',
    understand: 'I Understand',
  },

  // Permission prompt
  permission: {
    title: 'Administrator Privileges Required',
    message:
      'The current controller requires administrator privileges to interact with the target window. Please restart the application as administrator.',
    hint: 'Your current configuration will be restored after restart.',
    restart: 'Restart as Administrator',
    restarting: 'Restarting...',
  },

  // VC++ Runtime
  vcredist: {
    title: 'Missing Runtime',
    description: 'MaaFramework requires Microsoft Visual C++ Runtime to work properly.',
    downloading: 'Downloading runtime...',
    downloadFailed: 'Download Failed',
    waitingInstall:
      'Waiting for installation. Please complete the installation in the installer window...',
    retrying: 'Reloading...',
    success: 'Runtime installed successfully!',
    stillFailed:
      'Installation complete, but loading still failed. Please restart your computer and try again.',
    restartHint: 'If the problem persists, please restart your computer and try again.',
    retry: 'Retry',
  },

  // Bad path warning
  badPath: {
    title: 'Wrong Location',
    rootTitle: "Don't put the program in the disk root!",
    rootDescription:
      'Running from the root of a drive (like C:\\ or D:\\) can cause issues. Please move it to a folder, like "D:\\MyApps\\".',
    tempTitle: 'Looks like you ran it directly from the archive',
    tempDescription:
      'The program is running from a temporary folder. It may disappear when closed. Please extract the archive to a folder first, then run the program from there.',
    hint: 'Tip: We recommend extracting to a dedicated folder like "D:\\MaaXXX". Avoid Desktop or Downloads for easier management.',
    exit: 'Exit',
  },
  // Proxy Settings
  proxy: {
    title: 'Network Proxy',
    url: 'Proxy URL',
    urlPlaceholder: 'e.g., http://127.0.0.1:7890',
    urlHint: 'Supports HTTP/SOCKS5, leave empty to disable proxy',
    urlHintDisabled: 'MirrorChyan CDK filled, proxy is disabled',
    invalid: 'Invalid proxy URL format',
    examples: 'Example Formats',
  },
};
