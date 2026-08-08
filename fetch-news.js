// محرك رصد الأخبار الحكومية — معين HR
// يقرأ RSS من المصادر الرسمية المؤكدة، ويحاول مصادر إضافية بحذر (بدون كسر التنفيذ لو فشلت)

const Parser = require('rss-parser');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const parser = new Parser({
  timeout: 15000,
  headers: {
    'User-Agent': 'Maeen-HR-NewsBot/1.0 (+https://example.com/about-this-bot; contact: your-email@example.com)'
  }
});

const HR_KEYWORDS = [
  'موارد بشرية', 'عمالة', 'توطين', 'أجور', 'نطاقات', 'وظائف', 'التأمينات الاجتماعية',
  'استقدام', 'رخص العمل', 'منصة قوى', 'منصة مدد', 'الضمان الاجتماعي', 'سوق العمل',
  'القطاع الخاص', 'الغرفة التجارية', 'رجال الأعمال', 'المنشآت الصغيرة والمتوسطة',
  'التقاعد', 'مكافأة نهاية الخدمة', 'إجازة سنوية', 'عقد العمل', 'صاحب العمل',
];

function containsHrKeyword(text) {
  return HR_KEYWORDS.some(k => text.includes(k));
}

function isRelevantByScore(title, snippet) {
  const titleHits = HR_KEYWORDS.filter(k => title.includes(k)).length;
  const snippetHits = HR_KEYWORDS.filter(k => snippet.includes(k)).length;
  return titleHits >= 1 || snippetHits >= 2;
}

async function fetchNewspaperSection(source) {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': 'Maeen-HR-NewsBot/1.0 (+https://example.com/about-this-bot)' }
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const html = await res.text();
  const $ = cheerio.load(html);

  const items = [];
  $('a').each((_, el) => {
    const title = $(el).text().trim();
    const href = $(el).attr('href');
    if (!title || !href || title.length < 15) return;
    if (!containsHrKeyword(title)) return;
    const fullLink = href.startsWith('http') ? href : new URL(href, source.url).toString();
    if (items.some(i => i.link === fullLink)) return;
    items.push({
      title,
      link: fullLink,
      pubDate: '',
      contentSnippet: '(خبر من صحيفة عامة، مفلتر بكلمات مفتاحية HR — راجع الرابط للتفاصيل الكاملة)',
      source: source.name,
      sourceId: source.id,
    });
  });
  return items.slice(0, 15);
}

async function fetchJsRenderedTopicPage(source) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Maeen-HR-NewsBot/1.0 (+https://example.com/about-this-bot)');
    await page.goto(source.url, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 3000));

    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('a'))
        .map(a => ({ title: a.innerText.trim(), href: a.href }))
        .filter(x => x.title && x.title.length > 15);
    });

    const seen = new Set();
    const items = [];
    for (const l of links) {
      if (seen.has(l.href)) continue;
      if (l.href.match(/\/(login|register|about|contact|topic)\/?$/)) continue;
      seen.add(l.href);
      items.push({
        title: l.title,
        link: l.href,
        pubDate: '',
        contentSnippet: '(من صفحة موضوع مخصصة للموارد البشرية على صحيفة سبق)',
        source: source.name,
        sourceId: source.id,
      });
    }
    return items.slice(0, 15);
  } finally {
    await browser.close();
  }
}

const SOURCES = [
  {
    id: 'hrsd',
    name: 'وزارة الموارد البشرية والتنمية الاجتماعية',
    url: 'https://www.hrsd.gov.sa/en/rss.xml',
    type: 'rss',
    required: true,
  },
  {
    id: 'okaz_rss',
    name: 'صحيفة عكاظ',
    url: 'https://www.okaz.com.sa/rssFeed/190',
    type: 'rss',
    filterByKeywords: true,
    required: false,
  },
  {
    id: 'almadina_rss',
    name: 'صحيفة المدينة',
    url: 'https://al-madina.com/rssFeed/193',
    type: 'rss',
    filterByKeywords: true,
    required: false,
  },
  {
    id: 'alyaum_rss',
    name: 'صحيفة اليوم',
    url: 'https://www.alyaum.com/rssFeed/1',
    type: 'rss',
    filterByKeywords: true,
    required: false,
  },
  {
    id: 'spa_economic',
    name: 'واس — الأخبار الاقتصادية',
    url: 'https://www.spa.gov.sa/rss5.xml',
    type: 'rss',
    required: false,
  },
  {
    id: 'spa_general',
    name: 'واس — عام',
    url: 'https://www.spa.gov.sa/rss.xml',
    type: 'rss',
    required: false,
  },
];

async function fetchSource(source) {
  try {
    let items;

    if (source.type === 'newspaper') {
      items = await fetchNewspaperSection(source);
    } else if (source.type === 'js_topic_page') {
      items = await fetchJsRenderedTopicPage(source);
    } else {
      const feed = await parser.parseURL(source.url);
      let rawItems = (feed.items || []).map(item => {
        let cleanTitle = item.title;
        let cleanLink = item.link;

        if (item.title && typeof item.title === 'object' && item.title.a && item.title.a[0]) {
          const nested = item.title.a[0];
          cleanTitle = nested._ || cleanTitle;
          if (nested.$ && nested.$.href) cleanLink = nested.$.href;
        }

        const isInternalLink = typeof cleanLink === 'string' && cleanLink.includes('cluster.local');

        return {
          title: typeof cleanTitle === 'string' ? cleanTitle.trim() : (item.title || '').toString(),
          link: isInternalLink ? '' : cleanLink,
          pubDate: item.pubDate || item.isoDate || '',
          contentSnippet: (item.contentSnippet || item.content || '').slice(0, 400),
          source: source.name,
          sourceId: source.id,
        };
      });

      if (source.filterByKeywords) {
        items = rawItems.filter(i => isRelevantByScore(i.title, i.contentSnippet));
      } else {
        items = rawItems;
      }
    }

    console.log(`✅ ${source.name}: ${items.length} خبر`);
    return { ok: true, sourceId: source.id, items };
  } catch (err) {
    const level = source.required ? 'ERROR (مصدر أساسي)' : 'تحذير (مصدر تجريبي)';
    console.log(`❌ ${level} — ${source.name}: ${err.message}`);
    if (source.required) throw err;
    return { ok: false, sourceId: source.id, items: [], error: err.message };
  }
}

const CANDIDATE_DOMAINS = [
  'https://www.alriyadh.com',
  'https://www.albiladdaily.com',
  'https://www.aleqt.com',
  'https://www.arabnews.com',
  'https://saudigazette.com.sa',
];
const CANDIDATE_PATHS = ['/rssFeed/1', '/rssFeed/2', '/rssFeed/3', '/feed', '/rss.xml', '/rss'];

async function discoverCandidateSources() {
  const discovered = [];
  for (const domain of CANDIDATE_DOMAINS) {
    let foundForThisDomain = false;
    for (const p of CANDIDATE_PATHS) {
      if (foundForThisDomain) break;
      const url = domain + p;
      try {
        const feed = await parser.parseURL(url);
        if (feed.items && feed.items.length > 0) {
          discovered.push({
            domain,
            workingUrl: url,
            itemCount: feed.items.length,
            sampleTitle: (feed.items[0].title || '').toString().slice(0, 100),
          });
          console.log(`🔍 اكتشاف جديد: ${domain} → ${url} (${feed.items.length} عنصر)`);
          foundForThisDomain = true;
        }
      } catch (e) {}
    }
    if (!foundForThisDomain) {
      console.log(`🔍 لا يوجد رابط RSS شغّال لـ ${domain} من الأنماط المجرَّبة`);
    }
  }
  return discovered;
}

async function main() {
  console.log('--- بدء دورة الرصد ---', new Date().toISOString());

  const results = [];
  for (const source of SOURCES) {
    results.push(await fetchSource(source));
  }

  console.log('--- بدء الاكتشاف التلقائي لمصادر جديدة ---');
  const discoveredCandidates = await discoverCandidateSources();
  console.log(`--- انتهى الاكتشاف. ${discoveredCandidates.length} مصدر مرشّح جديد ---`);

  const allItems = results
    .filter(r => r.ok)
    .flatMap(r => r.items)
    .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const output = {
    lastUpdated: new Date().toISOString(),
    sourcesStatus: results.map(r => ({
      sourceId: r.sourceId,
      ok: r.ok,
      itemCount: r.items.length,
      error: r.error || null,
    })),
    discoveredCandidates,
    items: allItems,
  };

  const outPath = path.join(__dirname, 'news-data.json');
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
  console.log(`--- انتهت الدورة. إجمالي الأخبار: ${allItems.length}. حُفظت في ${outPath} ---`);
}

main().catch(err => {
  console.error('فشل المصدر الأساسي (HRSD) — إيقاف بخطأ:', err.message);
  process.exit(1);
});
