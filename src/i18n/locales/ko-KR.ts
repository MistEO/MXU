export default {
  // 공통
  common: {
    confirm: '확인',
    cancel: '취소',
    undo: '실행 취소',
    save: '저장',
    delete: '삭제',
    edit: '편집',
    add: '추가',
    close: '닫기',
    loading: '로딩 중...',
    error: '오류',
    success: '성공',
    warning: '경고',
    info: '알림',
    resizeOrCollapse: '드래그하여 너비 조정, 오른쪽 끝까지 드래그하면 접기',
    copySuffix: ' (복사)',
  },

  // 타이틀바
  titleBar: {
    newTab: '새 탭',
    closeTab: '탭 닫기',
    settings: '설정',
    about: '정보',
    renameInstance: '인스턴스 이름 변경',
    instanceName: '인스턴스 이름',
    dragToReorder: '드래그하여 순서 변경',
  },

  // 창 컨트롤
  windowControls: {
    minimize: '최소화',
    maximize: '최대화',
    restore: '복원',
    close: '닫기',
  },

  // 설정
  settings: {
    title: '설정',
    appearance: '외관',
    hotkeys: '단축키',
    language: '언어',
    theme: '테마',
    themeLight: '라이트',
    themeDark: '다크',
    accentColor: '강조 색상',
    themeSystem: '시스템 설정',
    showOptionPreview: '옵션 미리보기 표시',
    showOptionPreviewHint: '작업 목록에 옵션의 빠른 미리보기를 표시합니다',
    openLogDir: '로그 폴더 열기',
    // 사용자 지정 강조 색상
    customAccents: '사용자 지정 강조 색상',
    addCustomAccent: '추가',
    editCustomAccent: '사용자 지정 강조 색상 편집',
    deleteCustomAccent: '삭제',
    noCustomAccents: '사용자 지정 강조 색상이 없습니다',
    customAccentNameRequired: '이름을 입력하세요',
    deleteCustomAccentConfirm: '이 사용자 지정 강조 색상을 삭제하시겠습니까?',
    customAccentDeleted: '{{name}} 삭제됨',
    accentName: '이름',
    accentNamePlaceholder: '예: 다크 바이올렛',
    autoAccentName: '{{hex}}',
    accentMainColor: '메인 색상',
    accentHoverColor: '호버 색상',
    accentLightColor: '라이트 배경',
    accentLightDarkColor: '다크 배경',
    hotkeysStartTasks: '작업 시작 단축키',
    hotkeysStopTasks: '작업 중지 단축키',
    hotkeysHint:
      '메인 화면에서만 동작하며, 현재 인스턴스의 작업 시작 / 중지에 사용됩니다. Ctrl+F10, Ctrl+Shift+F11 과 같은 조합키도 지원합니다. F5 / F12 단독 키는 계속해서 시스템 / 브라우저용으로 예약됩니다.',
    hotkeysConflict: '시작과 중지 단축키는 서로 다른 키여야 합니다. 다른 키를 선택해 주세요.',
  },

  // 작업 목록
  taskList: {
    title: '작업 목록',
    selectAll: '모두 선택',
    deselectAll: '모두 선택 해제',
    collapseAll: '모두 접기',
    expandAll: '모두 펼치기',
    addTask: '작업 추가',
    noTasks: '작업이 없습니다',
    dragToReorder: '드래그하여 순서 변경',
    startTasks: '실행 시작',
    stopTasks: '실행 중지',
    startingTasks: '시작 중...',
    stoppingTasks: '중지 중...',
    // 자동 연결 관련
    autoConnect: {
      searching: '기기 검색 중...',
      searchingWindow: '창 검색 중...',
      connecting: '기기 연결 중...',
      connectingWindow: '창 연결 중...',
      loadingResource: '리소스 로딩 중...',
      deviceNotFound: '기기를 찾을 수 없습니다: {{name}}',
      windowNotFound: '창을 찾을 수 없습니다: {{name}}',
      noSavedDevice: '저장된 기기 설정이 없습니다',
      connectFailed: '자동 연결에 실패했습니다',
      resourceFailed: '리소스 로딩에 실패했습니다',
      needConfig: '먼저 기기를 연결하고 리소스를 로드하거나 연결 패널에서 기기 설정을 저장하세요',
    },
  },

  // 작업 항목
  taskItem: {
    options: '옵션 설정',
    noOptions: '설정 가능한 옵션이 없습니다',
    enabled: '활성화됨',
    disabled: '비활성화됨',
    expand: '옵션 펼치기',
    collapse: '옵션 접기',
    remove: '작업 삭제',
    rename: '이름 변경',
    clickToToggle: '클릭하여 전환',
    renameTask: '작업 이름 변경',
    customName: '사용자 지정 이름',
    originalName: '원래 이름',
    cannotEditRunningTask: '실행 중이거나 완료된 작업의 옵션은 편집할 수 없습니다',
    // 설명 콘텐츠 로딩
    loadingDescription: '설명 로딩 중...',
    loadedFromFile: '로컬 파일에서 로드됨',
    loadedFromUrl: '네트워크에서 로드됨',
    loadDescriptionFailed: '로딩 실패',
    // 작업 실행 상태
    status: {
      idle: '미실행',
      pending: '대기 중',
      running: '실행 중',
      succeeded: '완료',
      failed: '실패',
    },
    // 작업 호환성
    incompatibleController: '현재 컨트롤러에서 지원되지 않음',
    incompatibleResource: '현재 리소스에서 지원되지 않음',
  },

  // 옵션
  option: {
    select: '선택하세요',
    input: '입력하세요',
    yes: '예',
    no: '아니오',
    invalidInput: '입력 형식이 올바르지 않습니다',
  },

  // 옵션 에디터
  optionEditor: {
    loadingDescription: '설명 로딩 중...',
    loadedFromFile: '로컬 파일에서 로드됨',
    loadedFromUrl: '네트워크에서 로드됨',
    loadDescriptionFailed: '로딩 실패',
  },

  // 컨트롤러
  controller: {
    title: '컨트롤러',
    selectController: '컨트롤러 선택',
    adb: 'Android 기기',
    win32: 'Windows 창',
    playcover: 'PlayCover (macOS)',
    gamepad: '게임패드',
    connecting: '연결 중...',
    connected: '연결됨',
    disconnected: '연결 안 됨',
    connectionFailed: '연결에 실패했습니다',
    refreshDevices: '기기 새로고침',
    refresh: '기기 새로고침',
    connect: '연결',
    disconnect: '연결 해제',
    selectDevice: '기기를 선택하세요',
    noDevices: '기기를 찾을 수 없습니다',
    playcoverHint: 'PlayCover 앱 리슨 주소를 입력하세요',
    lastSelected: '이전 선택 · 클릭하여 검색',
    savedDeviceNotFound: '이전 기기를 찾을 수 없습니다. 연결을 확인하거나 다른 기기를 선택하세요',
  },

  // 리소스
  resource: {
    title: '리소스 팩',
    selectResource: '리소스 팩 선택',
    loading: '리소스 로딩 중...',
    loaded: '리소스 로드됨',
    loadFailed: '리소스 로딩에 실패했습니다',
    loadResource: '리소스 로드',
    switchFailed: '리소스 전환에 실패했습니다',
    cannotSwitchWhileRunning: '작업 실행 중에는 리소스를 전환할 수 없습니다',
    incompatibleController: '현재 컨트롤러에서 지원되지 않음',
  },

  // MaaFramework
  maa: {
    notInitialized: 'MaaFramework가 초기화되지 않았습니다',
    initFailed: '초기화에 실패했습니다',
    version: '버전',
    needConnection: '먼저 기기를 연결하세요',
    needResource: '먼저 리소스를 로드하세요',
  },

  // 스크린샷 미리보기
  screenshot: {
    title: '실시간 스크린샷',
    autoRefresh: '자동 새로고침',
    noScreenshot: '스크린샷이 없습니다',
    startStream: '라이브 스트림 시작',
    stopStream: '라이브 스트림 중지',
    connectFirst: '먼저 기기를 연결하세요',
    fullscreen: '전체 화면',
    exitFullscreen: '전체 화면 종료',
    // 프레임률 설정
    frameRate: {
      title: '스크린샷 프레임률',
      hint: '미리보기 부드러움과 시스템 리소스 사용량에만 영향을 미치며, 작업 인식이나 실행에는 영향을 주지 않습니다',
      unlimited: '제한 없음',
      fps5: '5 FPS',
      fps1: '1 FPS',
      every5s: '5초마다',
      every30s: '30초마다',
    },
  },

  // 로그
  logs: {
    title: '실행 로그',
    clear: '지우기',
    autoscroll: '자동 스크롤',
    noLogs: '로그가 없습니다',
    copyAll: '모두 복사',
    expand: '상단 패널 펼치기',
    collapse: '상단 패널 접기',
    // 로그 메시지
    messages: {
      // 연결 메시지
      connecting: '기기 {{device}}에 연결 중...',
      connected: '기기에 연결됨: {{device}}',
      connectFailed: '기기 연결 실패: {{device}}',
      // 리소스 로딩 메시지
      loadingResource: '리소스 로딩 중: {{name}}',
      resourceLoaded: '리소스 로드됨: {{name}}',
      resourceFailed: '리소스 로딩 실패: {{name}}',
      // 작업 메시지
      taskStarting: '작업 시작: {{name}}',
      taskSucceeded: '작업 완료: {{name}}',
      taskFailed: '작업 실패: {{name}}',
      stopTask: '작업 중지',
      // 예약 메시지
      scheduleStarting: '예약 실행 시작 [{{policy}}] {{time}}',
      // Agent 메시지
      agentStarting: 'Agent 시작 중...',
      agentStarted: 'Agent가 시작되었습니다',
      agentConnected: 'Agent가 연결되었습니다',
      agentDisconnected: 'Agent 연결이 끊어졌습니다',
      agentFailed: 'Agent 시작에 실패했습니다',
    },
  },

  // 작업 추가 패널
  addTaskPanel: {
    title: '작업 추가',
    searchPlaceholder: '작업 검색...',
    noResults: '일치하는 작업을 찾을 수 없습니다',
    alreadyAdded: '추가됨',
  },

  // 정보
  about: {
    title: '정보',
    version: '버전',
    description: '설명',
    license: '라이선스',
    contact: '연락처',
    github: 'GitHub 저장소',
  },

  // 디버그
  debug: {
    title: '디버그',
    versions: '버전 정보',
    interfaceVersion: '{{name}} 버전',
    maafwVersion: 'maafw 버전',
    mxuVersion: 'mxu 버전',
    environment: '실행 환경',
    envTauri: 'Tauri 데스크톱',
    envBrowser: '브라우저',
    systemInfo: '시스템 정보',
    operatingSystem: '운영 체제',
    architecture: '시스템 아키텍처',
    tauriVersion: 'Tauri 버전',
    pathInfo: '경로 정보',
    cwd: '현재 작업 디렉토리',
    exeDir: '실행 파일 디렉토리',
    resetWindowSize: '창 크기 초기화',
    openConfigDir: '설정 폴더 열기',
    openLogDir: '로그 폴더 열기',
    clearCache: '캐시 지우기',
    cacheCleared: '캐시가 지워졌습니다',
    cacheStats: '캐시 항목: {{count}}개',
    devMode: '개발자 모드',
    devModeHint: '활성화하면 F5 키로 UI를 새로고침할 수 있습니다',
    saveDraw: '디버그 이미지 저장',
    saveDrawHint:
      '인식 및 작업의 디버그 이미지를 로그 폴더에 저장합니다 (재시작 후 자동으로 비활성화됨)',
    tcpCompatMode: '통신 호환 모드',
    tcpCompatModeHint: '작업 시작 후 앱이 즉시 충돌하면 활성화해 보세요. 이 경우에만 사용하세요, 성능에 영향을 줄 수 있습니다',
  },

  // 환영 대화상자
  welcome: {
    dismiss: '확인했습니다',
  },

  // 신규 사용자 가이드
  onboarding: {
    title: '여기서 시작하세요',
    message: '먼저 "연결 설정"에서 기기를 선택하고 리소스를 로드하면 작업을 실행할 수 있습니다.',
    gotIt: '알겠습니다',
  },

  // 인스턴스
  instance: {
    defaultName: '설정',
  },

  // 연결 패널
  connection: {
    title: '연결 설정',
  },

  // 대시보드
  dashboard: {
    title: '대시보드',
    toggle: '대시보드 보기',
    exit: '대시보드 나가기',
    instances: '개의 인스턴스',
    noInstances: '인스턴스가 없습니다',
    running: '실행 중',
    succeeded: '완료',
    failed: '실패',
    noEnabledTasks: '활성화된 작업이 없습니다',
  },

  // 최근 닫은 탭
  recentlyClosed: {
    title: '최근에 닫은 탭',
    empty: '최근에 닫은 탭이 없습니다',
    reopen: '다시 열기',
    remove: '목록에서 삭제',
    clearAll: '모두 지우기',
    justNow: '방금',
    minutesAgo: '{{count}}분 전',
    hoursAgo: '{{count}}시간 전',
    daysAgo: '{{count}}일 전',
    noTasks: '작업 없음',
    tasksCount: '{{first}} 외 {{count}}개 작업',
  },

  // MirrorChyan 업데이트
  mirrorChyan: {
    title: '업데이트',
    debugModeNotice: '디버그 버전이므로 자동 업데이트 기능이 비활성화되었습니다',
    channel: '업데이트 채널',
    channelStable: '안정 버전',
    channelBeta: '베타 버전',
    cdk: 'Mirror짱 CDK',
    cdkPlaceholder: 'CDK 입력 (선택사항)',
    serviceName: 'Mirror짱',
    cdkHintAfterLink:
      '는 독립적인 서드파티 고속 다운로드 서비스이며 유료 구독이 필요합니다. 이것은 "{{projectName}}"의 요금이 아닙니다. 운영비는 구독 수익으로 충당되며 일부는 개발자에게 환원됩니다. CDK를 구독하여 고속 다운로드를 즐기세요. CDK가 없으면 GitHub에서 다운로드됩니다. 실패하면 네트워크 프록시를 설정하세요.',
    getCdk: 'CDK가 없으신가요? 지금 구독하세요',
    cdkHint: 'CDK가 올바른지 또는 만료되지 않았는지 확인하세요',
    checkUpdate: '업데이트 확인',
    checking: '확인 중...',
    upToDate: '최신 버전입니다 ({{version}})',
    newVersion: '새 버전 사용 가능',
    currentVersion: '현재 버전',
    latestVersion: '최신 버전',
    releaseNotes: '릴리스 노트',
    downloadNow: '지금 다운로드',
    later: '나중에 알림',
    dismiss: '이 버전 건너뛰기',
    noReleaseNotes: '릴리스 노트가 없습니다',
    checkFailed: '업데이트 확인에 실패했습니다',
    downloading: '다운로드 중',
    downloadComplete: '다운로드 완료',
    downloadFailed: '다운로드 실패',
    viewDetails: '상세 보기',
    noDownloadUrl: '다운로드 URL이 없습니다. CDK를 입력하거나 네트워크 환경을 확인하세요',
    openFolder: '폴더 열기',
    retry: '재시도',
    preparingDownload: '다운로드 준비 중...',
    downloadFromGitHub: 'GitHub에서 다운로드',
    downloadFromMirrorChyan: 'Mirror짱 CDN에서 다운로드',
    // 업데이트 설치
    installing: '업데이트 설치 중...',
    installComplete: '설치 완료',
    installFailed: '설치 실패',
    installNow: '지금 설치',
    installUpdate: '업데이트 설치',
    installStages: {
      extracting: '압축 해제 중...',
      checking: '업데이트 유형 확인 중...',
      applying: '업데이트 적용 중...',
      cleanup: '임시 파일 정리 중...',
      done: '업데이트 완료',
      incremental: '증분 업데이트',
      full: '전체 업데이트',
      fallback: '대체 업데이트 수행 중...',
    },
    restartRequired: '업데이트가 설치되었습니다. 변경 사항을 적용하려면 재시작하세요',
    restartNow: '지금 재시작',
    restarting: '재시작 중...',
    // 업데이트 완료 후
    updateCompleteTitle: '업데이트 완료',
    updateCompleteMessage: '최신 버전으로 성공적으로 업데이트되었습니다',
    previousVersion: '이전 버전',
    gotIt: '확인',
    // MirrorChyan API 오류 코드
    errors: {
      1001: '매개변수가 올바르지 않습니다. 설정을 확인하세요',
      7001: 'CDK가 만료되었습니다. 갱신하거나 다른 CDK를 사용하세요',
      7002: 'CDK가 유효하지 않습니다. 입력을 확인하세요',
      7003: 'CDK의 오늘 다운로드 횟수가 한도에 도달했습니다',
      7004: 'CDK 유형이 리소스와 일치하지 않습니다',
      7005: 'CDK가 차단되었습니다. 고객 지원에 문의하세요',
      8001: '현재 OS/아키텍처에서 사용 가능한 리소스가 없습니다',
      8002: 'OS 매개변수가 유효하지 않습니다',
      8003: '아키텍처 매개변수가 유효하지 않습니다',
      8004: '업데이트 채널 매개변수가 유효하지 않습니다',
      1: '서비스 오류가 발생했습니다. 나중에 다시 시도하세요',
      unknown: '알 수 없는 오류 ({{code}}): {{message}}',
      negative: '서버 오류가 발생했습니다. 기술 지원에 문의하세요',
    },
  },

  // 예약
  schedule: {
    title: '예약 실행',
    button: '예약',
    addPolicy: '예약 추가',
    defaultPolicyName: '예약',
    policyName: '예약 이름',
    noPolicies: '예약이 없습니다',
    noPoliciesHint: '예약을 추가하여 작업을 자동으로 실행하세요',
    repeatDays: '반복 요일',
    startTime: '시작 시간',
    selectDays: '요일 선택...',
    selectHours: '시간 선택...',
    noWeekdays: '요일이 선택되지 않았습니다',
    noHours: '시간이 선택되지 않았습니다',
    everyday: '매일',
    everyHour: '매시',
    all: '전체',
    hoursSelected: '개의 시간',
    timeZoneHint: '로컬 시간대 사용 (UTC+9)',
    multiSelect: '다중 선택',
    enable: '예약 활성화',
    disable: '예약 비활성화',
    hint: '예약된 작업은 설정된 시간에 자동으로 실행됩니다',
    executingPolicy: '「{{name}}」 예약 실행 중',
    startedAt: '시작 시간: {{time}}',
    // Date.getDay()에 대응: 0=일, 1=월, ..., 6=토
    weekdays: ['일', '월', '화', '수', '목', '금', '토'],
  },

  // 오류 메시지
  errors: {
    loadInterfaceFailed: 'interface.json 로딩에 실패했습니다',
    invalidInterface: 'interface.json 형식이 유효하지 않습니다',
    invalidConfig: '설정 파일 형식이 유효하지 않습니다',
    taskNotFound: '작업을 찾을 수 없습니다',
    controllerNotFound: '컨트롤러를 찾을 수 없습니다',
    resourceNotFound: '리소스 팩을 찾을 수 없습니다',
  },

  // 컨텍스트 메뉴
  contextMenu: {
    // 탭 컨텍스트 메뉴
    newTab: '새 탭',
    duplicateTab: '탭 복제',
    renameTab: '이름 변경',
    moveLeft: '왼쪽으로 이동',
    moveRight: '오른쪽으로 이동',
    moveToFirst: '맨 앞으로 이동',
    moveToLast: '맨 뒤로 이동',
    closeTab: '탭 닫기',
    closeOtherTabs: '다른 탭 닫기',
    closeAllTabs: '모든 탭 닫기',
    closeTabsToRight: '오른쪽 탭 닫기',

    // 작업 컨텍스트 메뉴
    addTask: '작업 추가',
    duplicateTask: '작업 복제',
    deleteTask: '작업 삭제',
    renameTask: '작업 이름 변경',
    enableTask: '작업 활성화',
    disableTask: '작업 비활성화',
    moveUp: '위로 이동',
    moveDown: '아래로 이동',
    moveToTop: '맨 위로 이동',
    moveToBottom: '맨 아래로 이동',
    expandOptions: '옵션 펼치기',
    collapseOptions: '옵션 접기',
    selectAll: '모두 선택',
    deselectAll: '모두 선택 해제',
    expandAllTasks: '모두 펼치기',
    collapseAllTasks: '모두 접기',

    // 스크린샷 패널 컨텍스트 메뉴
    reconnect: '다시 연결',
    forceRefresh: '강제 새로고침',
    startStream: '라이브 스트림 시작',
    stopStream: '라이브 스트림 중지',
    fullscreen: '전체 화면',
    saveScreenshot: '스크린샷 저장',
    copyScreenshot: '스크린샷 복사',

    // 연결 패널 컨텍스트 메뉴
    refreshDevices: '기기 목록 새로고침',
    disconnect: '연결 해제',

    // 공통
    openFolder: '폴더 열기',
  },

  // 버전 경고
  versionWarning: {
    title: 'MaaFramework 버전이 너무 낮습니다',
    message:
      '현재 MaaFramework 버전 ({{current}})이 지원되는 최소 버전 ({{minimum}})보다 낮습니다. 일부 기능이 제대로 작동하지 않을 수 있습니다.',
    suggestion: 'MaaFramework 버전을 업데이트하려면 프로젝트 개발자에게 문의하세요.',
    understand: '확인했습니다',
  },

  // 권한 프롬프트
  permission: {
    title: '관리자 권한이 필요합니다',
    message:
      '현재 컨트롤러가 대상 창을 조작하려면 관리자 권한이 필요합니다. 관리자 권한으로 재시작하세요.',
    hint: '재시작 후 현재 설정이 자동으로 복원됩니다.',
    restart: '관리자 권한으로 재시작',
    restarting: '재시작 중...',
  },

  // VC++ 런타임
  vcredist: {
    title: '런타임 누락',
    description: 'MaaFramework가 제대로 작동하려면 Microsoft Visual C++ 런타임이 필요합니다.',
    downloading: '런타임 다운로드 중...',
    downloadFailed: '다운로드 실패',
    waitingInstall: '설치 완료를 기다리고 있습니다. 설치 프로그램에서 설치를 완료하세요...',
    retrying: '다시 로드 중...',
    success: '런타임 설치 완료!',
    stillFailed:
      '설치가 완료되었지만 로드에 실패했습니다. 컴퓨터를 다시 시작한 후 다시 시도하세요.',
    restartHint: '문제가 지속되면 컴퓨터를 다시 시작한 후 다시 시도하세요.',
    retry: '다시 시도',
  },

  // 경로 경고
  badPath: {
    title: '프로그램 위치가 잘못되었습니다',
    rootTitle: '디스크 루트에 프로그램을 두지 마세요!',
    rootDescription:
      '드라이브 루트(C:\\ 또는 D:\\ 등)에서 실행하면 문제가 발생할 수 있습니다. "D:\\MyApps\\"와 같은 폴더로 이동하세요.',
    tempTitle: '압축 파일에서 직접 실행한 것 같습니다',
    tempDescription:
      '프로그램이 임시 폴더에서 실행 중입니다. 닫으면 사라질 수 있습니다. 먼저 압축 파일을 폴더에 풀고 거기서 프로그램을 실행하세요.',
    hint: '팁: "D:\\MaaXXX"와 같은 전용 폴더에 압축을 푸는 것이 좋습니다. 관리하기 쉽도록 바탕화면이나 다운로드 폴더는 피하세요.',
    exit: '종료',
  },
  // 프록시 설정
  proxy: {
    title: '네트워크 프록시',
    url: '프록시 주소',
    urlPlaceholder: '예: http://127.0.0.1:7890',
    urlHint: 'HTTP/SOCKS5 지원, 비워두면 프록시를 사용하지 않음',
    urlHintDisabled: 'Mirror짱 CDK가 입력되어 프록시 기능이 비활성화되었습니다',
    invalid: '프록시 주소 형식이 올바르지 않습니다',
    examples: '예시 형식',
  },
};
