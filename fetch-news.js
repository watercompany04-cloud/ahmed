// محرك رصد الأخبار الحكومية — معين HR
// يقرأ RSS من المصادر الرسمية المؤكدة، ويحاول مصادر إضافية بحذر (بدون كسر التنفيذ لو فشلت)

const Parser = require('rss-parser');
const fs = require('fs');
const path = require('path');

const parser = new Parser({
  timeout: 15000,
  headers: {
    // هوية واضحة وصادقة للأداة — أدب في الوصول الآلي، مش تنكّر
    'User-Agent': 'Maeen-HR-NewsBot/1.0 (+https://example.com/about-this-bot; contact: your-email@example.com)'
  }
});

// المصادر المستهدفة. كل مصدر له علم "required" — لو required=true وفشل، يوقف السكربت بخطأ.
// لو required=false (تجريبي)، أي فشل بيتسجل كتحذير بس ومكملين عادي.
const SOURCES = [
  {
    id: 'hrsd',
    name: 'وزارة الموارد البشرية والتنمية الاجتماعية',
    url: 'https://www.hrsd.gov.sa/en/rss.xml',
    required: true, // مصدر مؤكد شغّال
  },
  {
    id: 'spa_economic',
    name: 'واس — الأخبار الاقتصادية',
    url: 'https://www.spa.gov.sa/rss5.xml',
    required: false, // تجريبي — هنشوف هل هيعدي من سيرفر حقيقي ولا لأ
  },
  {
    id: 'spa_general',
    name: 'واس — عام',
    url: 'https://www.spa.gov.sa/rss.xml',
    required: false, // تجريبي
  },
];

async function fetchSource(source) {
  try {
    const feed = await parser.parseURL(source.url);
    const items = (feed.items || []).slice(0, 20).map(item => ({
      title: item.title || '',
      link: item.link || '',
      pubDate: item.pubDate || item.isoDate || '',
      contentSnippet: (item.contentSnippet || item.content || '').slice(0, 400),
      source: source.name,
      sourceId: source.id,
    }));
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
