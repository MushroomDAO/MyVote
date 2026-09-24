import { createI18n } from 'vue-i18n'

const LOCALE_STORAGE_KEY = 'locale'

export type AppLocale = 'zh-CN' | 'en'

const messages: Record<AppLocale, Record<string, string>> = {
  'zh-CN': {
    appTitle: 'MyVote',
    explore: '探索',
    language: '语言',
    login: '登录',
    logout: '退出',
    loginProvider: '登录方式',
    space: '组织',
    proposal: '提案',
    proposals: '提案列表',
    back: '返回',
    author: '作者',
    state: '状态',
    start: '开始时间',
    end: '结束时间',
    vote: '投票',
    submitVote: '提交投票',
    voteChoice: '选择选项',
    voteSubmitted: '投票已提交',
    voteError: '投票失败',
    noAccount: '未获取到账户地址，请先登录',
    kmsPending: 'AirAccount 远程签名服务（KMS）尚未上线（E-5），暂时无法投票',
    emailLogin: '邮箱',
    emailPlaceholder: 'you@example.com',
    emailRequired: '请输入邮箱地址',
    emailInvalid: '邮箱格式不正确',
    emailSigningUnsupported: '邮箱登录暂不支持签名投票，请使用钱包或等待 AirAccount 上线',
    sxUnknownNetwork: '未知的 Snapshot X 网络',
    noWallet: '未检测到浏览器钱包',
    sxOnchain: '链上（Snapshot X）',
    errVoteClockSkew: '签名时间戳超出允许范围（{detail}），通常是本机系统时间不准，请校准后重试',
    errVoteRejected: 'Snapshot hub 拒绝了投票（{status}）：{detail}',
    errSsoNotConfigured: 'AirAccount 登录服务尚未配置，请稍后再试',
    errSsoExchangeFailed: '登录失败（交换凭证时出错），请重试',
    errSsoCodeRejected: '登录凭证已失效，请重新登录',
    errSsoVerifyFailed: '登录校验失败，请重试',
    errSsoNoSession: '未检测到登录会话，请先登录',
    errSsoSessionExpired: '登录已过期，请重新登录',
    errAccountMismatch: '签名地址与当前登录账户不匹配',
    errWalletSwitchBlocked: 'AirAccount 登录模式下不可切换到钱包',
    ssoCompleting: '正在完成登录…',
    ssoFailed: '登录失败',
    ssoRetry: '重新登录',
    reasonOptional: '理由（可选）',
    loading: '加载中…',
    error: '出错了',
    spaces: '组织（Spaces）',
    empty: '暂无数据',
    loadMore: '加载更多',
    results: '投票结果',
    votes: '票',
    register: '注册社区',
    registerDesc: '为你的社区注册一个专属治理域名',
    communityName: '社区名称',
    communityNameHint: '3-30位，仅限小写字母、数字和短横线',
    snapshotSpaceId: 'Snapshot Space ID',
    snapshotSpaceHint: '例如：ens.eth（在 snapshot.org 创建后获得）',
    communityDesc: '社区描述（可选）',
    contactEmail: '联系邮箱',
    contactEmailHint: '用于接收注册与治理通知，不会公开显示',
    ownershipTitle: 'SPACE 所有权验证（可选）',
    ownershipHint: '用 SPACE 管理员钱包签名，可证明你拥有该 SPACE；不验证也可注册，只会记录为未验证。',
    ownershipVerify: '连接钱包并签名',
    ownershipSigning: '等待签名…',
    ownershipVerified: '所有权已验证',
    registerBtn: '注册并部署',
    checking: '检查中…',
    nameAvailable: '可用',
    nameTaken: '已被占用',
    nameInvalid: '格式不正确',
    registerSuccess: '注册成功！',
    registerSuccessDesc: '你的社区治理页面已就绪：',
    registerError: '注册失败',
    refresh: '刷新',
    retry: '重试',
    cached: '缓存',
    openSxPlaceholder: '打开链上空间：粘贴 Snapshot X 空间地址 (0x…)',
    openSxButton: '打开',
    openSxInvalid: '请输入有效的 Snapshot X 空间地址（0x 开头的 40 位十六进制）'
  },
  en: {
    appTitle: 'MyVote',
    explore: 'Explore',
    language: 'Language',
    login: 'Connect',
    logout: 'Disconnect',
    loginProvider: 'Login',
    space: 'Space',
    proposal: 'Proposal',
    proposals: 'Proposals',
    back: 'Back',
    author: 'Author',
    state: 'State',
    start: 'Start',
    end: 'End',
    vote: 'Vote',
    submitVote: 'Submit vote',
    voteChoice: 'Choose an option',
    voteSubmitted: 'Vote submitted',
    voteError: 'Vote failed',
    noAccount: 'No account address — please sign in first',
    kmsPending: 'AirAccount remote signing (KMS) is not available yet (E-5)',
    emailLogin: 'Email',
    emailPlaceholder: 'you@example.com',
    emailRequired: 'Enter an email address',
    emailInvalid: 'Invalid email address',
    emailSigningUnsupported:
      'Email sign-in cannot sign votes yet — use a wallet or wait for AirAccount',
    sxUnknownNetwork: 'Unknown Snapshot X network',
    noWallet: 'No browser wallet detected',
    sxOnchain: 'On-chain (Snapshot X)',
    errVoteClockSkew:
      'Signature timestamp is outside the allowed range ({detail}) — usually your system clock; sync it and retry',
    errVoteRejected: 'Snapshot hub rejected the vote ({status}): {detail}',
    errSsoNotConfigured: 'AirAccount sign-in is not configured yet — try again later',
    errSsoExchangeFailed: 'Sign-in failed while exchanging the code — please retry',
    errSsoCodeRejected: 'Sign-in code expired — please sign in again',
    errSsoVerifyFailed: 'Sign-in verification failed — please retry',
    errSsoNoSession: 'No sign-in session — please sign in first',
    errSsoSessionExpired: 'Session expired — please sign in again',
    errAccountMismatch: 'Signing address does not match the signed-in account',
    errWalletSwitchBlocked: 'Cannot switch to a wallet in AirAccount sign-in mode',
    ssoCompleting: 'Completing sign-in…',
    ssoFailed: 'Sign-in failed',
    ssoRetry: 'Log in again',
    reasonOptional: 'Reason (optional)',
    loading: 'Loading…',
    error: 'Something went wrong',
    spaces: 'Spaces',
    empty: 'No data',
    loadMore: 'Load more',
    results: 'Results',
    votes: 'votes',
    register: 'Register',
    registerDesc: 'Register a governance subdomain for your community',
    communityName: 'Community name',
    communityNameHint: '3–30 chars, lowercase letters, numbers and hyphens only',
    snapshotSpaceId: 'Snapshot Space ID',
    snapshotSpaceHint: 'e.g. ens.eth (create your space on snapshot.org first)',
    communityDesc: 'Description (optional)',
    contactEmail: 'Contact email',
    contactEmailHint: 'For registration and governance notices; not shown publicly',
    ownershipTitle: 'Space ownership (optional)',
    ownershipHint:
      'Sign with a space admin wallet to prove you control this space. You can also register without it — it is recorded as unverified.',
    ownershipVerify: 'Connect wallet & sign',
    ownershipSigning: 'Waiting for signature…',
    ownershipVerified: 'Ownership verified',
    registerBtn: 'Register & Deploy',
    checking: 'Checking…',
    nameAvailable: 'Available',
    nameTaken: 'Already taken',
    nameInvalid: 'Invalid format',
    registerSuccess: 'Registration successful!',
    registerSuccessDesc: 'Your community governance page is live at:',
    registerError: 'Registration failed',
    refresh: 'Refresh',
    retry: 'Retry',
    cached: 'cached',
    openSxPlaceholder: 'Open an on-chain space: paste a Snapshot X address (0x…)',
    openSxButton: 'Open',
    openSxInvalid: 'Enter a valid Snapshot X space address (0x + 40 hex characters)'
  }
}

function normalizeLocale(input: string | null | undefined): AppLocale | null {
  if (!input) return null
  if (input === 'zh-CN' || input === 'en') return input
  if (input.startsWith('zh')) return 'zh-CN'
  if (input.startsWith('en')) return 'en'
  return null
}

export function getInitialLocale(): AppLocale {
  const stored = normalizeLocale(localStorage.getItem(LOCALE_STORAGE_KEY))
  if (stored) return stored

  const browser = normalizeLocale(navigator.language)
  if (browser) return browser

  return 'zh-CN'
}

export const i18n = createI18n({
  legacy: false,
  locale: getInitialLocale(),
  fallbackLocale: 'en',
  messages
})

export function setLocale(locale: AppLocale) {
  i18n.global.locale.value = locale
  localStorage.setItem(LOCALE_STORAGE_KEY, locale)
}
