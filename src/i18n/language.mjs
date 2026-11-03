export const LANGUAGE_KEY = 'artdico-language';
export const SUPPORTED_LANGUAGES = ['zh-CN', 'en'];
export function supportedLanguage(value) {
  if (typeof value !== 'string') return null;
  if (/^zh(?:-|$)/iu.test(value)) return 'zh-CN';
  if (/^en(?:-|$)/iu.test(value)) return 'en';
  return null;
}
/** Respect the first supported browser preference; other languages fall back to English. */
export function resolveLanguage(saved, languages = []) {
  if (SUPPORTED_LANGUAGES.includes(saved)) return saved;
  for (const language of languages) {
    const supported = supportedLanguage(language);
    if (supported) return supported;
  }
  return 'en';
}
