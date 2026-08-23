export const LANGUAGES = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'it', label: 'Italiano', flag: '🇮🇹' },
  { code: 'es', label: 'Español', flag: '🇪🇸' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'kz', label: 'Қазақша', flag: '🇰🇿' },
  { code: 'la', label: 'Latin', flag: '🏛️' },
];

export const getLanguageLabel = (code: string) => {
  const lang = LANGUAGES.find(l => l.code === code);
  return lang ? `${lang.flag} ${lang.label}` : code;
};

export const getLanguageFlag = (code: string) => {
  const lang = LANGUAGES.find(l => l.code === code);
  return lang ? lang.flag : '🌐';
};
