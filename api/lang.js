export default function handler(req, res) {
  const country = req.headers['x-vercel-ip-country'] || '';
  const acceptLang = (req.headers['accept-language'] || '').toLowerCase();

  const englishCountries = [
    'US','GB','CA','AU','NZ','IE','SG','ZA','JM','TT','BB','GH','NG','KE','ZW','PH','IN'
  ];

  const isEnglishCountry = englishCountries.includes(country);
  const isEnglishBrowser = acceptLang.startsWith('en');

  const lang = (isEnglishCountry || isEnglishBrowser) ? 'en' : 'es';

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.json({ lang, country });
}
