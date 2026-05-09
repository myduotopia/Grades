import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import zhTW from './locales/zh-TW/common.json'
import en from './locales/en/common.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'zh-TW',
    supportedLngs: ['zh-TW', 'en'],
    debug: false,
    resources: {
      'zh-TW': { common: zhTW },
      en: { common: en },
    },
    defaultNS: 'common',
    interpolation: { escapeValue: false },
  })

export default i18n
