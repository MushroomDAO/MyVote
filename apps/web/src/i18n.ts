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
    cached: '缓存'
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
    cached: 'cached'
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
