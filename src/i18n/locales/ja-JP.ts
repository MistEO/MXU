export default {
  // 共通
  common: {
    confirm: '確定',
    cancel: 'キャンセル',
    save: '保存',
    delete: '削除',
    edit: '編集',
    add: '追加',
    close: '閉じる',
    loading: '読み込み中...',
    error: 'エラー',
    success: '成功',
    warning: '警告',
    info: 'お知らせ',
  },

  // タイトルバー
  titleBar: {
    newTab: '新しいタブ',
    closeTab: 'タブを閉じる',
    settings: '設定',
    about: 'このアプリについて',
    renameInstance: 'インスタンス名を変更',
    instanceName: 'インスタンス名',
    dragToReorder: 'ドラッグして並べ替え',
  },

  // 設定
  settings: {
    title: '設定',
    appearance: '外観',
    language: '言語',
    theme: 'テーマ',
    themeLight: 'ライト',
    themeDark: 'ダーク',
    themeSystem: 'システムに従う',
    showOptionPreview: 'オプションプレビューを表示',
    showOptionPreviewHint: 'タスクリストにオプションのクイックプレビューを表示します',
  },

  // タスクリスト
  taskList: {
    title: 'タスクリスト',
    selectAll: 'すべて選択',
    deselectAll: 'すべて解除',
    collapseAll: 'すべて折りたたむ',
    expandAll: 'すべて展開',
    addTask: 'タスクを追加',
    noTasks: 'タスクがありません',
    dragToReorder: 'ドラッグして並べ替え',
    startTasks: '実行開始',
    stopTasks: '実行停止',
    startingTasks: '開始中...',
    stoppingTasks: '停止中...',
    // 自動接続関連
    autoConnect: {
      searching: 'デバイスを検索中...',
      connecting: 'デバイスに接続中...',
      loadingResource: 'リソースを読み込み中...',
      deviceNotFound: 'デバイスが見つかりません: {{name}}',
      windowNotFound: 'ウィンドウが見つかりません: {{name}}',
      noSavedDevice: '保存されたデバイス設定がありません',
      connectFailed: '自動接続に失敗しました',
      resourceFailed: 'リソースの読み込みに失敗しました',
      needConfig: 'まずデバイスを接続してリソースを読み込むか、接続パネルでデバイス設定を保存してください',
    },
  },

  // タスク項目
  taskItem: {
    options: 'オプション設定',
    noOptions: '設定可能なオプションはありません',
    enabled: '有効',
    disabled: '無効',
    expand: 'オプションを展開',
    collapse: 'オプションを折りたたむ',
    remove: 'タスクを削除',
    rename: '名前を変更',
    renameTask: 'タスク名を変更',
    customName: 'カスタム名',
    originalName: '元の名前',
    cannotEditRunningTask: '実行中または完了したタスクのオプションは編集できません',
    // 説明コンテンツの読み込み
    loadingDescription: '説明を読み込み中...',
    loadedFromFile: 'ローカルファイルから読み込み',
    loadedFromUrl: 'ネットワークから読み込み',
    loadDescriptionFailed: '読み込みに失敗しました',
    // タスク実行ステータス
    status: {
      idle: '未実行',
      pending: '待機中',
      running: '実行中',
      succeeded: '完了',
      failed: '失敗',
    },
  },

  // オプション
  option: {
    select: '選択してください',
    input: '入力してください',
    yes: 'はい',
    no: 'いいえ',
    invalidInput: '入力形式が正しくありません',
  },
  
  // オプションエディタ
  optionEditor: {
    loadingDescription: '説明を読み込み中...',
    loadedFromFile: 'ローカルファイルから読み込み',
    loadedFromUrl: 'ネットワークから読み込み',
    loadDescriptionFailed: '読み込みに失敗しました',
  },

  // コントローラー
  controller: {
    title: 'コントローラー',
    selectController: 'コントローラーを選択',
    adb: 'Android デバイス',
    win32: 'Windows ウィンドウ',
    playcover: 'PlayCover (macOS)',
    gamepad: 'ゲームパッド',
    connecting: '接続中...',
    connected: '接続済み',
    disconnected: '未接続',
    connectionFailed: '接続に失敗しました',
    refreshDevices: 'デバイスを更新',
    refresh: 'デバイスを更新',
    connect: '接続',
    disconnect: '切断',
    selectDevice: 'デバイスを選択してください',
    noDevices: 'デバイスが見つかりません',
    playcoverHint: 'PlayCover アプリのリッスンアドレスを入力',
    lastSelected: '前回の選択 · クリックして検索',
    savedDeviceNotFound: '前回のデバイスが見つかりません。接続を確認するか、別のデバイスを選択してください',
  },

  // リソース
  resource: {
    title: 'リソースパック',
    selectResource: 'リソースパックを選択',
    loading: 'リソースを読み込み中...',
    loaded: 'リソースを読み込みました',
    loadFailed: 'リソースの読み込みに失敗しました',
    loadResource: 'リソースを読み込む',
    switchFailed: 'リソースの切り替えに失敗しました',
    cannotSwitchWhileRunning: 'タスク実行中はリソースを切り替えられません',
  },

  // MaaFramework
  maa: {
    notInitialized: 'MaaFramework が初期化されていません',
    initFailed: '初期化に失敗しました',
    version: 'バージョン',
    needConnection: '先にデバイスを接続してください',
    needResource: '先にリソースを読み込んでください',
  },

  // スクリーンショットプレビュー
  screenshot: {
    title: 'リアルタイムスクリーンショット',
    autoRefresh: '自動更新',
    noScreenshot: 'スクリーンショットがありません',
    startStream: 'ライブストリームを開始',
    stopStream: 'ライブストリームを停止',
    connectFirst: '先にデバイスを接続してください',
    fullscreen: '全画面表示',
    exitFullscreen: '全画面を終了',
    // フレームレート設定
    frameRate: {
      title: 'スクリーンショットのフレームレート',
      hint: 'プレビューの滑らかさとシステムリソース使用量にのみ影響し、タスクの認識や実行には影響しません',
      unlimited: '制限なし',
      fps5: '5 FPS',
      fps1: '1 FPS',
      every5s: '5秒ごと',
      every30s: '30秒ごと',
    },
  },

  // ログ
  logs: {
    title: '実行ログ',
    clear: 'クリア',
    autoscroll: '自動スクロール',
    noLogs: 'ログがありません',
    copyAll: 'すべてコピー',
    expand: '上部パネルを展開',
    collapse: '上部パネルを折りたたむ',
    // ログメッセージ
    messages: {
      // 接続メッセージ
      connecting: 'デバイス {{device}} に接続中...',
      connected: 'デバイスに接続しました: {{device}}',
      connectFailed: 'デバイス接続に失敗しました: {{device}}',
      // リソース読み込みメッセージ
      loadingResource: 'リソースを読み込み中: {{name}}',
      resourceLoaded: 'リソースを読み込みました: {{name}}',
      resourceFailed: 'リソースの読み込みに失敗しました: {{name}}',
      // タスクメッセージ
      taskStarting: 'タスクを開始: {{name}}',
      taskSucceeded: 'タスクが完了しました: {{name}}',
      taskFailed: 'タスクが失敗しました: {{name}}',
      stopTask: 'タスクを停止',
      // スケジュールメッセージ
      scheduleStarting: 'スケジュール実行を開始 [{{policy}}] {{time}}',
      // Agent メッセージ
      agentStarting: 'Agent を起動中...',
      agentStarted: 'Agent が起動しました',
      agentConnected: 'Agent が接続しました',
      agentDisconnected: 'Agent が切断しました',
      agentFailed: 'Agent の起動に失敗しました',
    },
  },

  // タスク追加パネル
  addTaskPanel: {
    title: 'タスクを追加',
    searchPlaceholder: 'タスクを検索...',
    noResults: '一致するタスクが見つかりません',
    alreadyAdded: '追加済み',
  },

  // このアプリについて
  about: {
    title: 'このアプリについて',
    version: 'バージョン',
    description: '説明',
    license: 'ライセンス',
    contact: 'お問い合わせ',
    github: 'GitHub リポジトリ',
  },

  // デバッグ
  debug: {
    title: 'デバッグ',
    versions: 'バージョン情報',
    interfaceVersion: '{{name}} バージョン',
    maafwVersion: 'maafw バージョン',
    mxuVersion: 'mxu バージョン',
    environment: '実行環境',
    envTauri: 'Tauri デスクトップ',
    envBrowser: 'ブラウザ',
    resetWindowSize: 'ウィンドウサイズをリセット',
    openConfigDir: '設定フォルダを開く',
    openLogDir: 'ログフォルダを開く',
    clearCache: 'キャッシュをクリア',
    cacheCleared: 'キャッシュをクリアしました',
    cacheStats: 'キャッシュ項目: {{count}} 件',
    devMode: '開発者モード',
    devModeHint: '有効にすると F5 キーで UI をリフレッシュできます',
  },

  // ウェルカムダイアログ
  welcome: {
    dismiss: '了解しました',
  },

  // インスタンス
  instance: {
    defaultName: '設定',
  },

  // 接続パネル
  connection: {
    title: '接続設定',
  },

  // ダッシュボード
  dashboard: {
    title: 'ダッシュボード',
    toggle: 'ダッシュボード表示',
    exit: 'ダッシュボードを終了',
    instances: '件のインスタンス',
    noInstances: 'インスタンスがありません',
    running: '実行中',
    succeeded: '完了',
    failed: '失敗',
    noEnabledTasks: '有効なタスクがありません',
  },

  // 最近閉じたタブ
  recentlyClosed: {
    title: '最近閉じたタブ',
    empty: '最近閉じたタブはありません',
    reopen: '再度開く',
    remove: 'リストから削除',
    clearAll: 'すべてクリア',
    justNow: 'たった今',
    minutesAgo: '{{count}} 分前',
    hoursAgo: '{{count}} 時間前',
    daysAgo: '{{count}} 日前',
    noTasks: 'タスクなし',
    tasksCount: '{{first}} など {{count}} 件のタスク',
  },

  // MirrorChyan アップデート
  mirrorChyan: {
    title: 'アップデート',
    channel: '更新チャンネル',
    channelStable: '安定版',
    channelBeta: 'ベータ版',
    cdk: 'Mirror醤 CDK',
    cdkPlaceholder: 'CDK を入力（任意）',
    serviceName: 'Mirror醤',
    cdkHintAfterLink: ' は独立したサードパーティの高速ダウンロードサービスで、有料サブスクリプションが必要です。これは「{{projectName}}」の料金ではありません。運営費はサブスクリプション収入で賄われ、一部は開発者に還元されます。CDK を購読して高速ダウンロードをお楽しみください。CDK を入力しない場合、GitHub からダウンロードします。失敗した場合は、ネットワークプロキシを設定してください。',
    getCdk: 'CDKをお持ちでない方はこちら',
    cdkHint: 'CDK が正しいか、または有効期限が切れていないか確認してください',
    checkUpdate: '更新を確認',
    checking: '確認中...',
    upToDate: '最新バージョンです ({{version}})',
    newVersion: '新しいバージョンが利用可能',
    currentVersion: '現在のバージョン',
    latestVersion: '最新バージョン',
    releaseNotes: 'リリースノート',
    downloadNow: '今すぐダウンロード',
    later: '後で通知',
    dismiss: 'このバージョンをスキップ',
    noReleaseNotes: 'リリースノートはありません',
    checkFailed: '更新の確認に失敗しました',
    downloading: 'ダウンロード中',
    downloadComplete: 'ダウンロード完了',
    downloadFailed: 'ダウンロードに失敗しました',
    viewDetails: '詳細を表示',
    noDownloadUrl: 'ダウンロード URL がありません。CDK を入力するか、GitHub URL を設定してください',
    openFolder: 'フォルダを開く',
    retry: '再試行',
    preparingDownload: 'ダウンロードを準備中...',
    downloadFromGitHub: 'GitHub からダウンロード',
    downloadFromMirrorChyan: 'Mirror醤 CDN からダウンロード',
    // アップデートインストール
    installing: 'アップデートをインストール中...',
    installComplete: 'インストール完了',
    installFailed: 'インストールに失敗しました',
    installNow: '今すぐインストール',
    installUpdate: 'アップデートをインストール',
    installStages: {
      extracting: '解凍中...',
      checking: 'アップデートタイプを確認中...',
      applying: 'アップデートを適用中...',
      cleanup: '一時ファイルを削除中...',
      done: 'アップデート完了',
      incremental: '差分アップデート',
      full: 'フルアップデート',
    },
    restartRequired: 'アップデートがインストールされました。変更を適用するには再起動してください',
    restartNow: '今すぐ再起動',
    restarting: '再起動中...',
    // アップデート完了後
    updateCompleteTitle: 'アップデート完了',
    updateCompleteMessage: '最新バージョンへのアップデートに成功しました',
    previousVersion: '更新前のバージョン',
    gotIt: '了解',
    // MirrorChyan API エラーコード
    errors: {
      1001: 'パラメータが正しくありません。設定を確認してください',
      7001: 'CDK の有効期限が切れています。更新するか、別の CDK をご利用ください',
      7002: 'CDK が無効です。入力を確認してください',
      7003: 'CDK の今日のダウンロード回数が上限に達しました',
      7004: 'CDK タイプがリソースと一致しません',
      7005: 'CDK がブロックされています。サポートにお問い合わせください',
      8001: '現在の OS/アーキテクチャでは利用できるリソースがありません',
      8002: 'OS パラメータが無効です',
      8003: 'アーキテクチャパラメータが無効です',
      8004: '更新チャンネルパラメータが無効です',
      1: 'サービスエラーが発生しました。後でもう一度お試しください',
      unknown: '不明なエラー ({{code}}): {{message}}',
      negative: 'サーバーエラーが発生しました。テクニカルサポートにお問い合わせください',
    },
  },

  // スケジュール
  schedule: {
    title: 'スケジュール実行',
    button: 'スケジュール',
    addPolicy: 'スケジュールを追加',
    defaultPolicyName: 'スケジュール',
    policyName: 'スケジュール名',
    noPolicies: 'スケジュールがありません',
    noPoliciesHint: 'スケジュールを追加してタスクを自動実行します',
    repeatDays: '繰り返し日',
    startTime: '開始時刻',
    selectDays: '日を選択...',
    selectHours: '時刻を選択...',
    noWeekdays: '日が選択されていません',
    noHours: '時刻が選択されていません',
    everyday: '毎日',
    everyHour: '毎時',
    all: 'すべて',
    hoursSelected: '件の時刻',
    timeZoneHint: 'ローカルタイムゾーンを使用 (UTC+9)',
    multiSelect: '複数選択可',
    enable: 'スケジュールを有効化',
    disable: 'スケジュールを無効化',
    hint: 'スケジュールされたタスクは設定された時刻に自動的に実行されます',
    executingPolicy: '「{{name}}」のスケジュールを実行中',
    startedAt: '開始時刻: {{time}}',
    // Date.getDay() に対応: 0=日, 1=月, ..., 6=土
    weekdays: ['日', '月', '火', '水', '木', '金', '土'],
  },

  // エラーメッセージ
  errors: {
    loadInterfaceFailed: 'interface.json の読み込みに失敗しました',
    invalidInterface: 'interface.json の形式が無効です',
    invalidConfig: '設定ファイルの形式が無効です',
    taskNotFound: 'タスクが見つかりません',
    controllerNotFound: 'コントローラーが見つかりません',
    resourceNotFound: 'リソースパックが見つかりません',
  },

  // コンテキストメニュー
  contextMenu: {
    // タブのコンテキストメニュー
    newTab: '新しいタブ',
    duplicateTab: 'タブを複製',
    renameTab: '名前を変更',
    moveLeft: '左に移動',
    moveRight: '右に移動',
    moveToFirst: '最初に移動',
    moveToLast: '最後に移動',
    closeTab: 'タブを閉じる',
    closeOtherTabs: '他のタブを閉じる',
    closeAllTabs: 'すべてのタブを閉じる',
    closeTabsToRight: '右側のタブを閉じる',
    
    // タスクのコンテキストメニュー
    addTask: 'タスクを追加',
    duplicateTask: 'タスクを複製',
    deleteTask: 'タスクを削除',
    renameTask: 'タスク名を変更',
    enableTask: 'タスクを有効化',
    disableTask: 'タスクを無効化',
    moveUp: '上に移動',
    moveDown: '下に移動',
    moveToTop: '最上部に移動',
    moveToBottom: '最下部に移動',
    expandOptions: 'オプションを展開',
    collapseOptions: 'オプションを折りたたむ',
    selectAll: 'すべて選択',
    deselectAll: 'すべて解除',
    expandAllTasks: 'すべて展開',
    collapseAllTasks: 'すべて折りたたむ',
    
    // スクリーンショットパネルのコンテキストメニュー
    reconnect: '再接続',
    forceRefresh: '強制更新',
    startStream: 'ライブストリームを開始',
    stopStream: 'ライブストリームを停止',
    fullscreen: '全画面表示',
    saveScreenshot: 'スクリーンショットを保存',
    copyScreenshot: 'スクリーンショットをコピー',
    
    // 接続パネルのコンテキストメニュー
    refreshDevices: 'デバイス一覧を更新',
    disconnect: '切断',
    
    // 共通
    openFolder: 'フォルダを開く',
  },
};
