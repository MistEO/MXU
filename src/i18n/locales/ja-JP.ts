export default {
  // 共通
  common: {
    confirm: '確定',
    cancel: 'キャンセル',
    undo: '元に戻す',
    save: '保存',
    delete: '削除',
    edit: '編集',
    add: '追加',
    open: '開く',
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
    closeTabConfirmTitle: '設定を閉じる',
    closeTabConfirmMessage: '「{{name}}」を閉じてもよろしいですか？',
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
    general: '一般',
    language: '言語',
    languageSystem: 'システム',
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
    customAccentDeleted: '{{name}} を削除しました',
    accentName: '名前',
    accentNamePlaceholder: '例：ダークバイオレット',
    autoAccentName: '{{hex}}',
    accentMainColor: 'メインカラー',
    accentHoverColor: 'ホバーカラー',
    accentLightColor: 'ライト背景',
    accentLightDarkColor: 'ダーク背景',
    accentColorConfig: 'カラー設定',
    accentPreview: 'プレビュー',
    accentPreviewMainButton: 'メインボタン',
    accentPreviewLightBg: 'ライト背景',
    accentPreviewDarkBg: 'ダーク背景',
    hotkeysStartTasks: 'タスク開始ショートカット',
    hotkeysStopTasks: 'タスク停止ショートカット',
    hotkeysHint:
      'メイン画面でのみ有効です。現在のインスタンスのタスク開始 / 停止に使用します。Ctrl+F10 や Ctrl+Shift+F11 などの修飾キー付きの組み合わせもサポートします。F5 / F12 単体は引き続きシステム / ブラウザ用に予約されています。',
    hotkeysConflict:
      '開始と停止のショートカットは同じキーにしないでください。別のキーを選択してください。',
    hotkeysGlobal: 'グローバルショートカット',
    hotkeysGlobalHint: 'ウィンドウ非アクティブ時もショートカットを有効にする',
    hotkeysGlobalOnlyStart: 'グローバルモードでは開始のみ有効',
    minimizeToTray: '閉じる時にトレイに最小化',
    minimizeToTrayHint: '閉じるボタンをクリックすると、終了せずにシステムトレイに隠れます',
    autoStart: 'スタートアップ時に起動',
    autoStartHint: 'システム起動時にこのアプリケーションを自動的に起動します',
    autoStartInstance: '起動後に自動実行',
    autoStartInstanceHint:
      '起動後に自動的にアクティブにしてタスクを実行する設定を選択します。他の設定のスケジュールタスクは通常通り実行されます',
    autoStartInstanceNone: '自動実行しない',
    autoStartInstanceRemoved:
      '以前選択した設定「{{name}}」が削除されました。自動実行は無効になりました',
    autoRunOnLaunch: '手動起動時も自動実行',
    autoRunOnLaunchHint:
      '手動でアプリを開く際も、上で選択した設定を自動実行します（無効な場合はシステム起動時のみ実行）',
    confirmBeforeDelete: '削除操作の前に確認する',
    confirmBeforeDeleteHint: '削除/一覧クリア/上書きインポート等の前に確認ダイアログを表示します',
    maxLogsPerInstance: 'インスタンスあたりのログ上限',
    maxLogsPerInstanceHint: '上限を超えると古いログから自動的に破棄します（推奨 500～2000）',
    resetWindowLayout: 'ウィンドウレイアウトをリセット',
    resetWindowLayoutHint: 'ウィンドウサイズをデフォルトに戻し、中央に配置します',
  },

  // 特殊タスク
  specialTask: {
    sleep: {
      label: '⏳ カウントダウン',
      optionLabel: 'カウントダウン設定',
      inputLabel: '待機時間（秒）',
      inputError: '正の整数を入力してください',
    },
    waitUntil: {
      label: '⏰ 時刻まで待機',
      optionLabel: '時刻設定',
      optionDescription:
        '指定した時刻まで待機してから続行します。24時間以内のみ対応。目標時刻が過ぎている場合は翌日のその時刻まで待機します',
      inputLabel: '目標時刻',
    },
    launch: {
      label: '▶️ カスタムプログラム',
      optionLabel: 'プログラム設定',
      programLabel: 'プログラムパス',
      programPlaceholder: 'プログラムパスを入力するか右側の参照をクリック...',
      argsLabel: '追加引数',
      argsPlaceholder: '追加引数を入力（任意）',
      waitLabel: '終了を待機',
      waitDescription:
        '無効時は起動後すぐに続行します。有効時はプロセス終了後に続行します。スクリプトなど同期完了が必要な操作に適しています',
      waitYes: 'プログラム終了後に続行',
      waitNo: '起動後すぐに続行',
      skipLabel: '実行中の場合スキップ',
      skipDescription:
        '有効にすると、プログラムが既に実行中の場合は起動をスキップし、重複実行を防ぎます',
      skipYes: '実行中の場合は起動をスキップ',
      skipNo: '常に新しいインスタンスを起動',
    },
    notify: {
      label: '💬 システム通知',
      optionLabel: '通知設定',
      titleLabel: '通知タイトル',
      titlePlaceholder: '通知タイトルを入力',
      bodyLabel: '通知内容',
      bodyPlaceholder: '通知内容を入力',
    },
    webhook: {
      label: '🔔 Webhook',
      optionLabel: 'リクエスト設定',
      urlLabel: 'リクエストURL',
      urlPlaceholder: '完全なURLを入力（例：https://example.com/webhook?key=xxx）',
    },
    killProc: {
      label: '⛔ プロセス終了',
      selfLabel: '自身のプロセスを終了',
      selfDescription:
        '有効にするとこのアプリ自体を終了します。無効にすると別のプロセス名を入力して終了できます',
      selfYes: '自身を終了',
      selfNo: '指定プロセスを終了',
      nameOptionLabel: 'プロセス設定',
      nameLabel: 'プロセス名',
      namePlaceholder: '終了するプロセス名を入力（例：notepad.exe）',
    },
    power: {
      label: '⚡ PC操作',
      optionLabel: '操作タイプ',
      shutdown: 'シャットダウン',
      restart: '再起動',
      screenoff: '画面オフ',
      sleep: 'スリープ',
    },
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
    importConfirmTitle: 'タスクリストをインポート',
    importConfirmMessageOverwrite:
      'インポートすると現在のインスタンスのタスクリストが上書きされます。続行しますか？',
    importConfirmMessageMerge:
      'インポート内容を現在のインスタンスのタスクリストにマージします。続行しますか？',
    importConfirmAction: 'インポート',
    importPreviewCount: 'インポート内容：{{count}} 件のタスク',
    importModeLabel: 'インポート方法',
    importModeOverwrite: 'インポートして上書き',
    importModeOverwriteHint: 'インポート内容で現在のタスクリストを上書きします',
    importModeMerge: '上書きせずにインポート（マージ）',
    importModeMergeHint: '現在のタスクを保持し、重複しないタスクのみ追加します',
    exportConfirmTitle: 'タスクリストをエクスポート',
    exportConfirmHint: '現在のインスタンスの {{count}} 件のタスクをエクスポートします',
    exportConfirmAction: 'エクスポートを確認',
    selectNone: 'すべて解除',
    selectionCount: '選択済み：{{selected}} / {{total}}',
    mustSelectAtLeastOne: '少なくとも 1 件のタスクを選択してください',
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
      noDeviceFound: 'デバイスが見つかりませんでした',
      noWindowFound: 'ウィンドウが見つかりませんでした',
      connectFailed: '自動接続に失敗しました',
      autoSelectedDevice:
        'デバイスが未設定のため、「{{name}}」を自動的に選択しました。変更する場合は接続設定で手動選択してください。次回以降は選択内容が保存されます。',
      autoSelectedWindow:
        'ウィンドウが未設定のため、「{{name}}」を自動的に選択しました。変更する場合は接続設定で手動選択してください。次回以降は選択内容が保存されます。',
      resourceFailed: 'リソースの読み込みに失敗しました',
      startFailed: 'タスクの開始に失敗しました',
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
    removeConfirmTitle: 'タスクを削除',
    removeConfirmMessage: 'このタスクを削除してもよろしいですか？',
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
    supportedControllers: '対応コントローラー: {{controllers}}',
  },

  // オプション
  option: {
    select: '選択してください',
    input: '入力してください',
    yes: 'はい',
    no: 'いいえ',
    invalidInput: '入力形式が正しくありません',
  },

  action: {
    preAction: '前処理プログラム',
    program: 'プログラムパス',
    programPlaceholder: 'プログラムパスを入力または参照...',
    args: '追加引数',
    argsPlaceholder: '追加引数を入力（オプション）',
    browse: '参照',
    waitForExit: '終了を待機',
    waitForExitHintPre:
      '無効にするとプロセス起動後すぐに続行し、デバイス接続状態をポーリングします。ゲーム起動など非同期シナリオに適しています。有効にするとプロセスが終了するまで待機してから続行します。スクリプト実行など同期操作に適しています',
    skipIfRunning: '実行中ならスキップ',
    skipIfRunningHint:
      '有効にすると、プログラムがすでに実行中の場合は実行をスキップします。ゲームなどの再起動を避けるのに便利です',
    preActionSkipped: '前処理プログラム {{name}} は実行中のためスキップしました',
    waitingForDevice: 'デバイスの準備を待機中...',
    waitingForWindow: 'ウィンドウの準備を待機中...',
    waitingForDeviceNamed: 'デバイス「{{name}}」の準備を待機中...',
    waitingForWindowNamed: 'ウィンドウ「{{name}}」の準備を待機中...',
    waitingForAnyDevice:
      '任意の一致デバイスが現れるのを待機中。対象が目的のデバイスでない場合は、接続設定で手動選択してから起動してください。',
    waitingForAnyWindow:
      '任意の一致ウィンドウが現れるのを待機中。対象が目的のウィンドウでない場合は、接続設定で手動選択してから起動してください。',
    deviceReady: 'デバイスが準備完了',
    windowReady: 'ウィンドウが準備完了',
    deviceWaitTimeout: 'デバイス待機タイムアウト',
    windowWaitTimeout: 'ウィンドウ待機タイムアウト',
    preActionStarting: '前処理プログラムを実行中...',
    preActionCompleted: '前処理プログラム完了',
    preActionFailed: '前処理プログラム失敗: {{error}}',
    preActionExitCode: '前処理プログラム終了コード: {{code}}',
    preActionConnectDelay: '{{seconds}} 秒後に接続します...',
  },

  // オプションエディタ
  optionEditor: {
    loadingDescription: '説明を読み込み中...',
    loadedFromFile: 'ローカルファイルから読み込み',
    loadedFromUrl: 'ネットワークから読み込み',
    loadDescriptionFailed: '読み込みに失敗しました',
    searchPlaceholder: 'オプションを検索...',
    noMatchingOptions: '一致するオプションがありません',
    incompatibleController: '現在のコントローラーに対応していません',
    incompatibleResource: '現在のリソースパックに対応していません',
  },

  // プリセット
  preset: {
    title: 'プリセットを選択',
    hint: 'ワンクリックでタスク構成を適用し、すぐに開始できます',
    taskCount: 'タスク',
    skipToManual: 'スキップして手動でタスクを追加',
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
    refreshWindows: 'ウィンドウを更新',
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
    savedWindowNotFound:
      '前回のウィンドウが見つかりません。接続を確認するか、別のウィンドウを選択してください',
    connectedLog: 'コントローラーに接続しました [{{name}}]',
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
      // ショートカットキー
      hotkeyDetected: 'ショートカットキーを検出: {{combo}}（{{action}}）',
      hotkeyActionStart: 'タスク開始',
      hotkeyActionStop: 'タスク停止',
      hotkeyStartSuccess: 'ショートカットキーでタスク開始：成功',
      hotkeyStartFailed: 'ショートカットキーでタスク開始：失敗',
      hotkeyStopSuccess: 'ショートカットキーでタスク停止：成功',
      hotkeyStopFailed: 'ショートカットキーでタスク停止：失敗',
    },
  },

  // タスク追加パネル
  addTaskPanel: {
    title: 'タスクを追加',
    searchPlaceholder: 'タスクを検索...',
    noResults: '一致するタスクが見つかりません',
    alreadyAdded: '追加済み',
    specialTasks: '特殊タスク',
    allSpecialTasksAdded: 'すべて追加済み',
    collapse: 'パネルを閉じる',
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
    systemInfo: 'システム情報',
    operatingSystem: 'オペレーティングシステム',
    architecture: 'アーキテクチャ',
    tauriVersion: 'Tauri バージョン',
    pathInfo: 'パス情報',
    cwd: '現在の作業ディレクトリ',
    exeDir: '実行ファイルのディレクトリ',
    webview2Dir: 'WebView2 ディレクトリ',
    webview2System: 'システム',
    resetWindowSize: 'ウィンドウサイズをリセット',
    openConfigDir: '設定フォルダを開く',
    openLogDir: 'ログフォルダを開く',
    exportLogs: 'ログをエクスポート',
    exportLogsHint: 'すべてのログファイルを zip アーカイブにパック',
    exportingLogs: 'ログをエクスポート中...',
    logsExported: 'ログをエクスポートしました',
    exportLogsFailed: 'ログのエクスポートに失敗しました',
    devMode: '開発者モード',
    devModeHint: '有効にすると F5 キーで UI をリフレッシュできます',
    saveDraw: 'デバッグ画像を保存',
    saveDrawHint:
      '認識と操作のデバッグ画像をログフォルダに保存します（再起動後は自動的にオフになります）',
    tcpCompatMode: '通信互換モード',
    tcpCompatModeHint:
      'タスク開始後にアプリがすぐにクラッシュする場合は有効にしてください。この場合のみ使用し、それ以外は性能に影響します',
  },

  // ウェルカムダイアログ
  welcome: {
    dismiss: '了解しました',
  },

  // 新規ユーザーガイド
  onboarding: {
    title: 'デバイスを接続',
    message:
      '右側の「接続設定」パネルでデバイスを選択し、リソースを読み込めば、タスクを実行する準備が整います。',
    addTaskTitle: 'タスクを追加',
    addTaskMessage:
      'ここをクリックして利用可能なタスクを確認し、必要なタスクをリストに追加しましょう。',
    tabBarTitle: '複数の設定を管理',
    tabBarMessage:
      '上部のタブから設定を新規作成・切り替えできます。例えば、日常の自動化用とリアルタイムツール用など、それぞれ独立したタスクとデバイス設定を持てます。',
    next: '次へ',
    prev: '前へ',
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
    alignLeft: '左寄せ',
    alignCenter: '中央寄せ',
    alignRight: '右寄せ',
    zoomIn: '拡大',
    zoomOut: '縮小',
  },

  // 最近閉じたタブ
  recentlyClosed: {
    title: '最近閉じたタブ',
    empty: '最近閉じたタブはありません',
    reopen: '再度開く',
    remove: 'リストから削除',
    clearAll: 'すべてクリア',
    clearAllConfirmTitle: '最近閉じたタブをクリア',
    clearAllConfirmMessage: '最近閉じたタブ一覧をクリアしますか？',
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
    installerOpened: 'インストーラーが開きました',
    installerOpenedHint:
      'インストーラーの操作を完了してください。インストール完了後、このアプリを再起動してください',
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
    enableAll: 'すべてのスケジュールを有効化',
    disableAll: 'すべてのスケジュールを無効化',
    hint: 'スケジュールされたタスクは設定された時刻に自動的に実行されます',
    executingPolicy: '「{{name}}」のスケジュールを実行中',
    startedAt: '開始時刻: {{time}}',
    deletePolicyTitle: 'スケジュールを削除',
    deletePolicyConfirm: 'スケジュール「{{name}}」を削除してもよろしいですか？',
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
    exportTasks: 'タスクリストをエクスポート',
    importTasks: 'タスクリストをインポート',
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

  // ローディング画面
  loadingScreen: {
    loadingInterface: 'interface.json を読み込み中...',
    loadFailed: '読み込みに失敗しました',
    retry: '再試行',
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
