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
    resizeOrCollapse: 'ドラッグして幅を調整、右端までドラッグで折りたたみ',
    copySuffix: '（コピー）',
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

  // ウィンドウコントロール
  windowControls: {
    minimize: '最小化',
    maximize: '最大化',
    restore: '元に戻す',
    close: '閉じる',
  },

  // 設定
  settings: {
    title: '設定',
    appearance: '外観',
    hotkeys: 'ショートカットキー',
    language: '言語',
    theme: 'テーマ',
    themeLight: 'ライト',
    themeDark: 'ダーク',
    accentColor: 'アクセントカラー',
    themeSystem: 'システムに従う',
    showOptionPreview: 'オプションプレビューを表示',
    showOptionPreviewHint: 'タスクリストにオプションのクイックプレビューを表示します',
    openLogDir: 'ログフォルダを開く',
    // カスタムアクセント
    customAccents: 'カスタムアクセント',
    addCustomAccent: '追加',
    editCustomAccent: 'カスタムアクセントを編集',
    deleteCustomAccent: '削除',
    noCustomAccents: 'カスタムアクセントはまだありません',
    customAccentNameRequired: '名前を入力してください',
    deleteCustomAccentConfirm: 'このカスタムアクセントを削除してもよろしいですか？',
    accentName: '名前',
    accentNamePlaceholder: '例：ダークバイオレット',
    accentMainColor: 'メインカラー',
    accentHoverColor: 'ホバーカラー',
    accentLightColor: 'ライト背景',
    accentLightDarkColor: 'ダーク背景',
    hotkeysStartTasks: 'タスク開始ショートカット',
    hotkeysStopTasks: 'タスク停止ショートカット',
    hotkeysHint:
      'メイン画面でのみ有効です。現在のインスタンスのタスク開始 / 停止に使用します。Ctrl+F10 や Ctrl+Shift+F11 などの修飾キー付きの組み合わせもサポートします。F5 / F12 単体は引き続きシステム / ブラウザ用に予約されています。',
    hotkeysConflict:
      '開始と停止のショートカットは同じキーにしないでください。別のキーを選択してください。',
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
      searchingWindow: 'ウィンドウを検索中...',
      connecting: 'デバイスに接続中...',
      connectingWindow: 'ウィンドウに接続中...',
      loadingResource: 'リソースを読み込み中...',
      deviceNotFound: 'デバイスが見つかりません: {{name}}',
      windowNotFound: 'ウィンドウが見つかりません: {{name}}',
      noSavedDevice: '保存されたデバイス設定がありません',
      connectFailed: '自動接続に失敗しました',
      resourceFailed: 'リソースの読み込みに失敗しました',
      needConfig:
        'まずデバイスを接続してリソースを読み込むか、接続パネルでデバイス設定を保存してください',
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
    clickToToggle: 'クリックで切替',
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
    // タスクの互換性
    incompatibleController: '現在のコントローラーに対応していません',
    incompatibleResource: '現在のリソースに対応していません',
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
    selectWindow: 'ウィンドウを選択してください',
    noDevices: 'デバイスが見つかりません',
    noWindows: 'ウィンドウが見つかりません',
    playcoverHint: 'PlayCover アプリのリッスンアドレスを入力',
    lastSelected: '前回の選択 · クリックして検索',
    savedDeviceNotFound:
      '前回のデバイスが見つかりません。接続を確認するか、別のデバイスを選択してください',
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
    incompatibleController: '現在のコントローラーに対応していません',
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
      connecting: '{{target}}に接続中...',
      connected: '{{target}}に接続しました:',
      connectFailed: '{{target}}接続に失敗しました:',
      targetDevice: 'デバイス',
      targetWindow: 'ウィンドウ',
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
    pathInfo: 'パス情報',
    cwd: '現在の作業ディレクトリ',
    exeDir: '実行ファイルのディレクトリ',
    resetWindowSize: 'ウィンドウサイズをリセット',
    openConfigDir: '設定フォルダを開く',
    openLogDir: 'ログフォルダを開く',
    clearCache: 'キャッシュをクリア',
    cacheCleared: 'キャッシュをクリアしました',
    cacheStats: 'キャッシュ項目: {{count}} 件',
    devMode: '開発者モード',
    devModeHint: '有効にすると F5 キーで UI をリフレッシュできます',
    saveDraw: 'デバッグ画像を保存',
    saveDrawHint:
      '認識と操作のデバッグ画像をログフォルダに保存します（再起動後は自動的にオフになります）',
  },

  // ウェルカムダイアログ
  welcome: {
    dismiss: '了解しました',
  },

  // 新規ユーザーガイド
  onboarding: {
    title: 'ここから始めましょう',
    message: 'まず「接続設定」でデバイスを選択してリソースを読み込み、その後タスクを実行できます。',
    gotIt: '了解しました',
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
    debugModeNotice: 'デバッグバージョンのため、自動更新機能が無効になっています',
    channel: '更新チャンネル',
    channelStable: '安定版',
    channelBeta: 'ベータ版',
    cdk: 'Mirror醤 CDK',
    cdkPlaceholder: 'CDK を入力（任意）',
    serviceName: 'Mirror醤',
    cdkHintAfterLink:
      ' は独立したサードパーティの高速ダウンロードサービスで、有料サブスクリプションが必要です。これは「{{projectName}}」の料金ではありません。運営費はサブスクリプション収入で賄われ、一部は開発者に還元されます。CDK を購読して高速ダウンロードをお楽しみください。CDK を入力しない場合、GitHub からダウンロードします。失敗した場合は、ネットワークプロキシを設定してください。',
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
    noDownloadUrl:
      'ダウンロード URL がありません。CDK を入力するか、ネットワーク環境を確認してください',
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
      fallback: 'フォールバック更新を実行中...',
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

  // バージョン警告
  versionWarning: {
    title: 'MaaFramework バージョンが古すぎます',
    message:
      '現在の MaaFramework バージョン ({{current}}) は、サポートされている最低バージョン ({{minimum}}) より低いです。一部の機能が正常に動作しない可能性があります。',
    suggestion:
      'MaaFramework のバージョンを更新するよう、プロジェクト開発者にお問い合わせください。',
    understand: '了解しました',
  },

  // 権限プロンプト
  permission: {
    title: '管理者権限が必要です',
    message:
      '現在のコントローラーは、対象ウィンドウを操作するために管理者権限が必要です。管理者として再起動してください。',
    hint: '再起動後、現在の設定は自動的に復元されます。',
    restart: '管理者として再起動',
    restarting: '再起動中...',
  },

  // VC++ ランタイム
  vcredist: {
    title: 'ランタイムが見つかりません',
    description: 'MaaFramework を正しく動作させるには、Microsoft Visual C++ ランタイムが必要です。',
    downloading: 'ランタイムをダウンロード中...',
    downloadFailed: 'ダウンロード失敗',
    waitingInstall:
      'インストールの完了を待っています。インストーラーでインストールを完了してください...',
    retrying: '再読み込み中...',
    success: 'ランタイムのインストールに成功しました！',
    stillFailed:
      'インストールは完了しましたが、読み込みに失敗しました。コンピュータを再起動してから再試行してください。',
    restartHint: '問題が解決しない場合は、コンピュータを再起動してから再試行してください。',
    retry: '再試行',
  },

  // パス警告
  badPath: {
    title: 'プログラムの場所が正しくありません',
    rootTitle: 'ディスクのルートに置かないでください！',
    rootDescription:
      'ドライブのルート（C:\\ や D:\\ など）から実行すると問題が発生する可能性があります。「D:\\MyApps\\」のようなフォルダに移動してください。',
    tempTitle: 'アーカイブから直接実行したようです',
    tempDescription:
      'プログラムは一時フォルダから実行されています。閉じると消える可能性があります。まずアーカイブをフォルダに解凍してから、そこからプログラムを実行してください。',
    hint: 'ヒント：「D:\\MaaXXX」のような専用フォルダに解凍することをお勧めします。管理しやすくするため、デスクトップやダウンロードフォルダは避けてください。',
    exit: '終了',
  },
  // プロキシ設定
  proxy: {
    title: 'ネットワークプロキシ',
    url: 'プロキシ URL',
    urlPlaceholder: '例：http://127.0.0.1:7890',
    urlHint: 'HTTP/SOCKS5 をサポート、空欄でプロキシを無効化',
    urlHintDisabled: 'Mirror醤 CDK が入力されているため、プロキシは無効です',
    invalid: 'プロキシ URL の形式が正しくありません',
    examples: '形式の例',
  },
};
