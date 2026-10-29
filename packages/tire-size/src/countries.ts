export const COUNTRIES: { code: string; name: string }[] = [
  { code: 'AF', name: 'Afghanistan' },
  { code: 'AL', name: 'Albania' },
  { code: 'DZ', name: 'Algeria' },
  { code: 'AR', name: 'Argentina' },
  { code: 'AM', name: 'Armenia' },
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' },
  { code: 'AZ', name: 'Azerbaijan' },
  { code: 'BH', name: 'Bahrain' },
  { code: 'BD', name: 'Bangladesh' },
  { code: 'BY', name: 'Belarus' },
  { code: 'BE', name: 'Belgium' },
  { code: 'BA', name: 'Bosnia and Herzegovina' },
  { code: 'BR', name: 'Brazil' },
  { code: 'BG', name: 'Bulgaria' },
  { code: 'KH', name: 'Cambodia' },
  { code: 'CA', name: 'Canada' },
  { code: 'CL', name: 'Chile' },
  { code: 'CN', name: 'China' },
  { code: 'CO', name: 'Colombia' },
  { code: 'HR', name: 'Croatia' },
  { code: 'CY', name: 'Cyprus' },
  { code: 'CZ', name: 'Czech Republic' },
  { code: 'DK', name: 'Denmark' },
  { code: 'EG', name: 'Egypt' },
  { code: 'EE', name: 'Estonia' },
  { code: 'ET', name: 'Ethiopia' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'GE', name: 'Georgia' },
  { code: 'DE', name: 'Germany' },
  { code: 'GH', name: 'Ghana' },
  { code: 'GR', name: 'Greece' },
  { code: 'HU', name: 'Hungary' },
  { code: 'IN', name: 'India' },
  { code: 'ID', name: 'Indonesia' },
  { code: 'IR', name: 'Iran' },
  { code: 'IQ', name: 'Iraq' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IL', name: 'Israel' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'JO', name: 'Jordan' },
  { code: 'KZ', name: 'Kazakhstan' },
  { code: 'KE', name: 'Kenya' },
  { code: 'KW', name: 'Kuwait' },
  { code: 'KG', name: 'Kyrgyzstan' },
  { code: 'LV', name: 'Latvia' },
  { code: 'LB', name: 'Lebanon' },
  { code: 'LT', name: 'Lithuania' },
  { code: 'LU', name: 'Luxembourg' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'MX', name: 'Mexico' },
  { code: 'MD', name: 'Moldova' },
  { code: 'MN', name: 'Mongolia' },
  { code: 'MA', name: 'Morocco' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NG', name: 'Nigeria' },
  { code: 'MK', name: 'North Macedonia' },
  { code: 'NO', name: 'Norway' },
  { code: 'OM', name: 'Oman' },
  { code: 'PK', name: 'Pakistan' },
  { code: 'PE', name: 'Peru' },
  { code: 'PH', name: 'Philippines' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'QA', name: 'Qatar' },
  { code: 'RO', name: 'Romania' },
  { code: 'RU', name: 'Russia' },
  { code: 'SA', name: 'Saudi Arabia' },
  { code: 'RS', name: 'Serbia' },
  { code: 'SG', name: 'Singapore' },
  { code: 'SK', name: 'Slovakia' },
  { code: 'SI', name: 'Slovenia' },
  { code: 'ZA', name: 'South Africa' },
  { code: 'KR', name: 'South Korea' },
  { code: 'ES', name: 'Spain' },
  { code: 'LK', name: 'Sri Lanka' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'SY', name: 'Syria' },
  { code: 'TW', name: 'Taiwan' },
  { code: 'TJ', name: 'Tajikistan' },
  { code: 'TH', name: 'Thailand' },
  { code: 'TN', name: 'Tunisia' },
  { code: 'TR', name: 'Turkey' },
  { code: 'TM', name: 'Turkmenistan' },
  { code: 'UA', name: 'Ukraine' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
  { code: 'UZ', name: 'Uzbekistan' },
  { code: 'VN', name: 'Vietnam' },
  { code: 'YE', name: 'Yemen' },
];

export const countryByCode = Object.fromEntries(COUNTRIES.map(c => [c.code, c.name]));
export const codeByName  = Object.fromEntries(COUNTRIES.map(c => [c.name.toLowerCase(), c.code]));

// Country names in other languages and common short forms, lower-case →
// ISO code (English names are matched through codeByName).
const COUNTRY_ALIASES: Record<string, string> = {
  // RU
  'китай': 'CN', 'кнр': 'CN', 'индия': 'IN', 'таиланд': 'TH', 'тайланд': 'TH', 'вьетнам': 'VN', 'япония': 'JP',
  'корея': 'KR', 'южная корея': 'KR', 'германия': 'DE', 'франция': 'FR', 'польша': 'PL', 'россия': 'RU', 'рф': 'RU',
  'турция': 'TR', 'италия': 'IT', 'испания': 'ES', 'сербия': 'RS', 'чехия': 'CZ', 'словакия': 'SK', 'румыния': 'RO',
  'венгрия': 'HU', 'индонезия': 'ID', 'малайзия': 'MY', 'тайвань': 'TW', 'сша': 'US', 'бразилия': 'BR',
  'беларусь': 'BY', 'белоруссия': 'BY', 'рб': 'BY', 'украина': 'UA', 'казахстан': 'KZ', 'литва': 'LT', 'латвия': 'LV',
  'эстония': 'EE', 'нидерланды': 'NL', 'голландия': 'NL', 'бельгия': 'BE', 'австрия': 'AT', 'шри-ланка': 'LK',
  'великобритания': 'GB', 'португалия': 'PT', 'словения': 'SI', 'финляндия': 'FI', 'швеция': 'SE',
  // DE
  'deutschland': 'DE', 'frankreich': 'FR', 'polen': 'PL', 'tschechien': 'CZ', 'italien': 'IT', 'spanien': 'ES',
  'niederlande': 'NL', 'österreich': 'AT', 'oesterreich': 'AT', 'ungarn': 'HU', 'rumänien': 'RO', 'türkei': 'TR',
  'japan': 'JP', 'indien': 'IN', 'serbien': 'RS', 'slowakei': 'SK', 'belgien': 'BE', 'litauen': 'LT', 'schweden': 'SE',
  // PL
  'niemcy': 'DE', 'francja': 'FR', 'polska': 'PL', 'czechy': 'CZ', 'włochy': 'IT', 'hiszpania': 'ES', 'chiny': 'CN',
  'indie': 'IN', 'tajlandia': 'TH', 'japonia': 'JP', 'turcja': 'TR', 'węgry': 'HU', 'rumunia': 'RO', 'słowacja': 'SK',
  'holandia': 'NL', 'litwa': 'LT', 'ukraina': 'UA', 'białoruś': 'BY',
  // FR / IT
  'allemagne': 'DE', 'pologne': 'PL', 'chine': 'CN', 'inde': 'IN', 'italie': 'IT', 'espagne': 'ES', 'japon': 'JP',
  'germania': 'DE', 'francia': 'FR', 'polonia': 'PL', 'cina': 'CN', 'italia': 'IT', 'spagna': 'ES', 'giappone': 'JP',
  // EN short forms
  'usa': 'US', 'uk': 'GB', 'england': 'GB', 'korea': 'KR', 'south korea': 'KR', 'czechia': 'CZ', 'holland': 'NL', 'uae': 'AE',
};

const ISO_CODES = new Set(COUNTRIES.map((c) => c.code));

/** ISO code for a country code or name in EN/RU/DE/PL/FR/IT, or null */
export function countryCode(text: string | null | undefined): string | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t) && ISO_CODES.has(t.toUpperCase())) return t.toUpperCase();
  const lower = t.toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  return codeByName[lower] ?? COUNTRY_ALIASES[lower] ?? null;
}

/** Every alias and English name (lower-case) with its code, longest first — for scanning text */
export const COUNTRY_NAMES: [string, string][] = [
  ...COUNTRIES.map((c): [string, string] => [c.name.toLowerCase(), c.code]),
  ...Object.entries(COUNTRY_ALIASES),
].sort((a, b) => b[0].length - a[0].length);
