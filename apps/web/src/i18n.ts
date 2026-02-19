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
    empty: '暂无数据'
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
    empty: 'No data'
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
