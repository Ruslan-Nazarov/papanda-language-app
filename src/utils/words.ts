import { Word } from '../models/types';

/**
 * Returns the translation of a word for a given language code.
 * Prioritizes user edits / custom translations stored in `word.translations[langCode]`
 * over static direct language properties (`word.it`, `word.de`, etc.).
 */
export const getWordTranslation = (word: Word | undefined | null, langCode: string): string => {
  if (!word) return '';

  if (langCode === 'ru') {
    const customRu = word.translations?.ru;
    if (typeof customRu === 'string' && customRu.trim()) return customRu.trim();
    return (word.ru || '').trim();
  }

  if (langCode === 'en') {
    const customEn = word.translations?.en;
    if (typeof customEn === 'string' && customEn.trim()) return customEn.trim();
    return (word.eng || word.word || '').trim();
  }

  const customTrans = word.translations?.[langCode];
  if (typeof customTrans === 'string' && customTrans.trim()) {
    return customTrans.trim();
  }

  const direct = word[langCode as keyof Word];
  if (typeof direct === 'string' && direct.trim()) {
    return direct.trim();
  }

  return '';
};
