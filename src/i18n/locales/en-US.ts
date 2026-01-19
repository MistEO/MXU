export default {
  // Common
  common: {
    confirm: 'Confirm',
    cancel: 'Cancel',
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

  // Settings
  settings: {
    title: 'Settings',
    appearance: 'Appearance',
    language: 'Language',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    themeSystem: 'System',
    showOptionPreview: 'Show Option Preview',
    showOptionPreviewHint: 'Display quick preview of options in the task list',
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
      searching: 'Searching...',
      connecting: 'Connecting...',
      loadingResource: 'Loading resource...',
      deviceNotFound: 'Device not found: {{name}}',
      windowNotFound: 'Window not found: {{name}}',
      noSavedDevice: 'No saved device configuration',
      connectFailed: 'Auto connect failed',
      resourceFailed: 'Resource loading failed',
      needConfig: 'Please connect device and load resource first, or save device config in connection panel',
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
    renameTask: 'Rename Task',
    customName: 'Custom Name',
    originalName: 'Original Name',
    cannotEditRunningTask: 'Cannot edit options for running or completed tasks',
    // Task run status
    status: {
      idle: 'Not started',
      pending: 'Pending',
      running: 'Running',
      succeeded: 'Completed',
      failed: 'Failed',
    },
  },

  // Options
  option: {
    select: 'Please select',
    input: 'Please enter',
    yes: 'Yes',
    no: 'No',
    invalidInput: 'Invalid input format',
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
    noDevices: 'No devices found',
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
    interfaceVersion: 'Interface version',
    maafwVersion: 'maafw version',
    mxuVersion: 'mxu version',
  },

  // Welcome dialog
  welcome: {
    dismiss: 'Got it',
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
    title: 'Software Update',
    channel: 'Update Channel',
    channelStable: 'Stable',
    channelBeta: 'Beta',
    cdk: 'MirrorChyan CDK',
    cdkPlaceholder: 'Enter your CDK (optional)',
    cdkHint: 'CDK is used to get download links. You can check updates without CDK.',
    getCdk: 'Get CDK',
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
    viewDetails: 'View Details',
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
};
