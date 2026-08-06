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
    // هوية واضحة وصادقة للأداة — أدب في الوصول الآلي، مش تنكّر
    'User-Agent': 'Maeen-HR-NewsBot/1.0 (+https://example.com/about-this-bot; contact: your-email@example.com)'
  }
});

// كلمات مفتاحية لفلترة أخبار الموارد البشرية من صفحات الصحف العامة (اللي مش نشرة HR متخصصة)
const HR_KEYWORDS = ['موارد بشرية', 'عمالة', 'توطين', 'أجور', 'نطاقات', 'وظائف', 'التأمينات', 'استقدام', 'إقامة', 'رخص العمل', 'قوى', 'مدد', 'الضمان الاجتماعي', 'تجارة', 'شركات', 'القطاع الخاص', 'اقتصاد', 'سوق العمل'];

function containsHrKeyword(text) {
  return HR_KEYWORDS.some(k => text.includes(k));
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
    if (!title || !href || title.length < 15) return; // تجاهل روابط قصيرة (قوائم تنقل مش أخبار)
    if (!containsHrKeyword(title)) return; // بس الأخبار المتعلقة بالموارد البشرية
    const fullLink = href.startsWith('http') ? href : new URL(href, source.url).toString();
    if (items.some(i => i.link === fullLink)) return; // تجنب التكرار
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

// لمواقع الجافاسكريبت (SPA) اللي مش بتديك محتوى فعلي غير بعد ما المتصفح يشتغل ويحمّل الصفحة كاملة
async function fetchJsRenderedTopicPage(source) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setUserAgent('Maeen-HR-NewsBot/1.0 (+https://example.com/about-this-bot)');
    await page.goto(source.url, { waitUntil: 'networkidle2', timeout: 30000 });
    // ننتظر شوية إضافية لضمان تحميل قائمة المقالات فعليًا (بعض المواقع بتحمّل على دفعات)
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

// المصادر المستهدفة. كل مصدر له علم "required" — لو required=true وفشل، يوقف السكربت بخطأ.
// لو required=false (تجريبي)، أي فشل بيتسجل كتحذير بس ومكملين عادي.
const SOURCES = [
  {
    id: 'hrsd',
    name: 'وزارة الموارد البشرية والتنمية الاجتماعية',
    url: 'https://www.hrsd.gov.sa/en/rss.xml',
    type: 'rss',
    required: true, // مصدر مؤكد شغّال
  },
  // معطّل مؤقتًا: الروابط اللي بتطلع منه بترجع 404 — محتاج إصلاح طريقة استخراج الرابط الحقيقي
  // {
  //   id: 'sabq_hrsd_topic',
  //   name: 'صحيفة سبق — موضوع الموارد البشرية',
  //   url: 'https://sabq.org/topic/%D9%88%D8%B2%D8%A7%D8%B1%D8%A9-%D8%A7%D9%84%D9%85%D9%88%D8%A7%D8%B1%D8%AF-%D8%A7%D9%84%D8%A8%D8%B4%D8%B1%D9%8A%D8%A9-%D9%88%D8%A7%D9%84%D8%AA%D9%86%D9%85%D9%8A%D8%A9-%D8%A7%D9%84%D8%A7%D8%AC%D8%AA%D9%85%D8%A7%D8%B9%D9%8A%D8%A9',
  //   type: 'js_topic_page',
  //   required: false,
  // },
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
        // بعض تغذيات RSS (زي HRSD) بتحط رابط وعنوان نظيف جوه بنية متداخلة title.a[0]
        // بدل الحقول العادية (لأن الـ<link> بتاعهم بيرجع دومين داخلي مش عام)
        let cleanTitle = item.title;
        let cleanLink = item.link;

        if (item.title && typeof item.title === 'object' && item.title.a && item.title.a[0]) {
          const nested = item.title.a[0];
          cleanTitle = nested._ || cleanTitle;
          if (nested.$ && nested.$.href) cleanLink = nested.$.href;
        }

        // حماية إضافية: لو الرابط النهائي مازال داخلي (cluster.local)، منعرضوش للمستخدم
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
    }

    console.log(`✅ ${source.name}: ${items.length} خبر`);
    return { ok: true, sourceId: source.id, items };
  } catch (err) {
    const level = source.required ? 'ERROR (مصدر أساسي)' : 'تحذير (مصدر تجريبي)';
    console.log(`❌ ${level} — ${source.name}: ${err.message}`);
    if (source.required) throw err; // لو مصدر أساسي فشل، نوقف بخطأ واضح
    return { ok: false, sourceId: source.id, items: [], error: err.message };
  }
}

async function main() {
  console.log('--- بدء دورة الرصد ---', new Date().toISOString());

  const results = [];
  for (const source of SOURCES) {
    results.push(await fetchSource(source));
  }

  // دمج كل الأخبار الناجحة في قائمة واحدة، مرتبة بالأحدث
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
