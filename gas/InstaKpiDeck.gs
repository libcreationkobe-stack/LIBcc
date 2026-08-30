/**
 * 月次レポートのスライドを作る。Googleスライドを組み立ててから
 * PPTXに書き出し、Drive内のフォルダに両方を置く。
 *
 * InstaKpiSheet.gs / InstaKpiReview.gs と同じプロジェクトに置くこと。
 *
 * 配色は判定の3段階（悪い＝赤／普通＝緑／良い＝黄）を使うが、
 * 色だけに頼らず必ずラベルも添える。
 */

var DECK_FOLDER_NAME = 'Instagram採用レポート';
var PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

var W = 720;          // スライド幅(pt) 16:9
var H = 405;          // スライド高さ(pt)
var PAD = 48;         // 左右の余白
var BODY_W = W - PAD * 2;

var FONT = 'Noto Sans JP';

// 面。濃紺は表紙と見出し帯、明るい面は本文。
var C_NAVY = '#1f3864';
var C_SURFACE = '#fcfcfb';
var C_CARD = '#ffffff';
var C_LINE = '#e3e2dd';
var C_INK = '#0b0b0b';
var C_INK_SUB = '#52514e';
var C_INK_ON_NAVY = '#ffffff';
var C_INK_MUTED_NAVY = '#9db4d8';

// 判定の3段階。必ずラベルと一緒に使う。
var TIER_STYLE = {
  '悪い': {bar: '#d03b3b', soft: '#f7dede', ink: '#8f2020'},
  '普通': {bar: '#0ca30c', soft: '#dcf0dc', ink: '#0b6b0b'},
  '良い': {bar: '#fab219', soft: '#fdeecd', ink: '#8a6100'}
};

var C_SERIES = '#2a78d6';       // 判定の無い指標に使う中立の色
var C_TRACK = '#e8ecf3';        // バーの下地
var C_UP = '#006300';           // 前月比プラス
var C_DOWN = '#d03b3b';         // 前月比マイナス

/** ファネルの各段。rate は前の段からの転換率の列。 */
var FUNNEL_STAGES = [
  {name: 'リーチ',         countCol: 'D', rateCol: null, bench: null},
  {name: 'プロフアクセス', countCol: 'E', rateCol: 'O',  bench: 'O'},
  {name: 'リンクタップ',   countCol: 'F', rateCol: 'P',  bench: 'P'},
  {name: 'LINE登録',       countCol: 'G', rateCol: 'Q',  bench: 'Q'},
  {name: '面接',           countCol: 'H', rateCol: 'R',  bench: null},
  {name: '採用',           countCol: 'I', rateCol: 'S',  bench: null}
];

/** 目安つきの4指標。スライド4のメーターに使う。 */
var METER_METRICS = [
  {name: 'プロフアクセス率', col: 'O', bench: 'O', note: '投稿→プロフィールの興味喚起'},
  {name: 'リンクタップ率',   col: 'P', bench: 'P', note: 'プロフ文とハイライトの出来'},
  {name: 'LINE登録率',       col: 'Q', bench: 'Q', note: 'LP・登録導線の出来'},
  {name: 'リーチ→採用率',    col: 'V', bench: 'V', note: '全体の最終CVR'}
];

/** 総評とスライドをまとめて作る。 */
function buildMonthlyReport() {
  writeReviewForSelectedMonth();
  buildMonthlyDeck();
}

/** 選択中の月のスライドを作り、PPTXに書き出す。 */
function buildMonthlyDeck() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var reviewSheet = ss.getSheetByName(REVIEW_SHEET_NAME);
  if (!reviewSheet) {
    throw new Error('「' + REVIEW_SHEET_NAME + '」シートがありません。先に「月次レビューシートを作る」を実行してください。');
  }

  var index = selectedMonthIndex_(ss, reviewSheet);
  var data = collectMonthData_(index);
  if (data.reach === '' || data.reach === null) {
    throw new Error(MONTHS[index] + ' はKPIシートに数値が入っていません。');
  }

  var review = reviewSheet.getRange(REVIEW_FIRST_ROW + index, 3, 1, 4).getValues()[0];
  if (String(review[0]).trim() === '') {
    throw new Error(MONTHS[index] + ' の総評がまだありません。\n'
      + '先に「この月の総評をAIに書かせる」を実行するか、'
      + '「この月のレポートを作る（総評＋スライド）」を使ってください。');
  }

  SpreadsheetApp.getActive().toast(MONTHS[index] + 'のスライドを作っています…');

  var deckInfo = renderDeck_(index, data, {
    summary: String(review[0]),
    good: String(review[1]),
    bottleneck: String(review[2]),
    actions: String(review[3])
  });

  var folder = getReportFolder_();
  DriveApp.getFileById(deckInfo.id).moveTo(folder);
  var pptx = exportAsPptx_(deckInfo.id, deckInfo.name, folder);

  showDeckLinks_(deckInfo, pptx);
}

/** スライド本体を組み立てる。 */
function renderDeck_(index, data, review) {
  var title = 'Instagram採用レポート ' + MONTHS[index];
  var deck = SlidesApp.create(title);
  var info = {id: deck.getId(), name: deck.getName(), url: deck.getUrl()};

  // 既定レイアウトのプレースホルダを消してから描く
  var cover = deck.getSlides()[0];
  cover.getPageElements().forEach(function (el) { el.remove(); });

  renderCover_(cover, index);
  renderSummary_(deck.appendSlide(SlidesApp.PredefinedLayout.BLANK), index, data);
  renderFunnel_(deck.appendSlide(SlidesApp.PredefinedLayout.BLANK), index);
  renderMeters_(deck.appendSlide(SlidesApp.PredefinedLayout.BLANK), index);
  renderSummaryText_(deck.appendSlide(SlidesApp.PredefinedLayout.BLANK), index, review.summary);
  renderTwoColumn_(deck.appendSlide(SlidesApp.PredefinedLayout.BLANK), index, review);
  renderActions_(deck.appendSlide(SlidesApp.PredefinedLayout.BLANK), index, review.actions);

  deck.saveAndClose();
  return info;
}

/* ---------------- スライドごとの描画 ---------------- */

function renderCover_(slide, index) {
  slide.getBackground().setSolidFill(C_NAVY);

  text_(slide, PAD, 122, BODY_W, 20, 'LIB creation.',
    {size: 12, color: C_INK_MUTED_NAVY, bold: true});
  text_(slide, PAD, 146, BODY_W, 34, 'Instagram採用 月次レポート',
    {size: 26, color: C_INK_ON_NAVY, bold: true});
  text_(slide, PAD, 186, BODY_W, 86, MONTHS[index],
    {size: 66, color: C_INK_ON_NAVY, bold: true});

  box_(slide, PAD, 286, 72, 4, '#fab219');

  text_(slide, PAD, 306, BODY_W, 18,
    Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy年M月d日 作成'),
    {size: 11, color: C_INK_MUTED_NAVY});
}

function renderSummary_(slide, index, data) {
  slideBase_(slide, index, '今月のサマリー', 2);

  var hires = metric_(data, '採用数 合計');
  var y = 112;
  var heroW = 208;

  // ヒーロー数値はスライドに1つだけ。今月の成果＝採用数。
  card_(slide, PAD, y, heroW, 186);
  text_(slide, PAD + 22, y + 26, heroW - 44, 18, '採用数', {size: 12, color: C_INK_SUB, bold: true});
  text_(slide, PAD + 22, y + 50, heroW - 44, 76, num_(hires), {size: 62, color: C_INK, bold: true});
  text_(slide, PAD + 22, y + 128, heroW - 44, 20, '人', {size: 13, color: C_INK_SUB});
  deltaText_(slide, PAD + 22, y + 148, heroW - 44, data, '採用数 合計');

  var tiles = [
    {label: 'リーチ数', key: 'リーチ数', unit: 'アカウント'},
    {label: 'LINE登録', key: 'LINE登録数', unit: '件'},
    {label: '面接', key: '面接数', unit: '件'}
  ];
  var tileW = (BODY_W - heroW - 16 - 32) / 3;
  tiles.forEach(function (t, i) {
    var x = PAD + heroW + 16 + i * (tileW + 16);
    card_(slide, x, y, tileW, 186);
    text_(slide, x + 18, y + 26, tileW - 36, 18, t.label, {size: 12, color: C_INK_SUB, bold: true});
    text_(slide, x + 18, y + 54, tileW - 36, 44, num_(metric_(data, t.key)),
      {size: 30, color: C_INK, bold: true});
    text_(slide, x + 18, y + 102, tileW - 36, 18, t.unit, {size: 11, color: C_INK_SUB});
    deltaText_(slide, x + 18, y + 148, tileW - 36, data, t.key);
  });

  text_(slide, PAD, y + 200, BODY_W, 18,
    data.prev ? '数値の下は前月（' + data.prevMonth + '）比' : '前月のデータがないため前月比は表示していません',
    {size: 10, color: C_INK_SUB});
}

function renderFunnel_(slide, index) {
  slideBase_(slide, index, 'ファネル：どこで人が減っているか', 3);

  var kpi = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var row = FIRST_ROW + index;

  var top = 104;
  var rowH = 40;
  var nameW = 116;
  var trackX = PAD + nameW + 12;   // 176
  var trackW = 300;                // 〜476
  var rateX = trackX + trackW + 12;   // 488
  var chipX = rateX + 64;             // 552
  var countX = W - PAD - 72;          // 600

  text_(slide, trackX, top - 22, trackW, 14, '前の段からの転換率',
    {size: 10, color: C_INK_SUB});
  text_(slide, trackX + trackW + 12, top - 22, 150, 14, '人数',
    {size: 10, color: C_INK_SUB});

  FUNNEL_STAGES.forEach(function (stage, i) {
    var y = top + i * rowH;
    var count = kpi.getRange(stage.countCol + row).getValue();
    var rate = stage.rateCol ? kpi.getRange(stage.rateCol + row).getValue() : null;

    text_(slide, PAD, y + 6, nameW, 20, stage.name, {size: 12, color: C_INK, bold: true});
    box_(slide, trackX, y + 10, trackW, 14, C_TRACK, 3);

    if (typeof rate === 'number' && rate > 0) {
      var tier = stage.bench ? judge_(stage.bench, rate) : '';
      var color = tier ? TIER_STYLE[tier].bar : C_SERIES;
      var fill = Math.max(6, Math.min(1, rate) * trackW);
      box_(slide, trackX, y + 10, fill, 14, color, 3);
      text_(slide, rateX, y + 6, 60, 20, pct_(rate, 1), {size: 12, color: C_INK, bold: true});
      if (tier) { chip_(slide, chipX, y + 7, tier); }
    } else if (i > 0) {
      text_(slide, rateX, y + 6, 60, 20, '—', {size: 12, color: C_INK_SUB});
    }

    text_(slide, countX, y + 6, 72, 20, num_(count),
      {size: 12, color: C_INK_SUB, align: 'right'});
  });

  text_(slide, PAD, top + FUNNEL_STAGES.length * rowH + 10, BODY_W, 16,
    '色は目安に対する評価。面接・採用の段は業種差が大きいため目安を置いていない（青）。',
    {size: 10, color: C_INK_SUB});
}

function renderMeters_(slide, index) {
  slideBase_(slide, index, '目安に対する評価', 4);

  var kpi = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var row = FIRST_ROW + index;

  var top = 100;
  var rowH = 62;
  var trackX = PAD + 150;
  var trackW = 330;

  METER_METRICS.forEach(function (m, i) {
    var y = top + i * rowH;
    var value = kpi.getRange(m.col + row).getValue();
    var bench = benchmarkFor_(m.bench);
    var tier = judge_(m.bench, value);

    text_(slide, PAD, y, 150, 18, m.name, {size: 12, color: C_INK, bold: true});
    text_(slide, PAD, y + 19, 150, 16, m.note, {size: 9, color: C_INK_SUB});

    // 目盛りは「良い」の2倍を上限にとる。良いの線がちょうど真ん中に来る。
    var max = bench.good * 2;
    box_(slide, trackX, y + 4, trackW, 16, C_TRACK, 3);

    if (typeof value === 'number' && value > 0) {
      var fill = Math.max(6, Math.min(value / max, 1) * trackW);
      box_(slide, trackX, y + 4, fill, 16, TIER_STYLE[tier].bar, 3);
    }

    // 悪い／普通の境目に目盛り線を立てる。
    [bench.bad, bench.good].forEach(function (t) {
      box_(slide, trackX + (t / max) * trackW, y + 1, 1, 22, '#9a9a94');
    });
    text_(slide, trackX + (bench.bad / max) * trackW - 24, y + 24, 48, 12,
      fmtBench_(bench.bad), {size: 8, color: C_INK_SUB, align: 'center'});
    text_(slide, trackX + (bench.good / max) * trackW - 24, y + 24, 48, 12,
      fmtBench_(bench.good), {size: 8, color: C_INK_SUB, align: 'center'});

    var vx = trackX + trackW + 14;
    text_(slide, vx, y + 2, 74, 22, typeof value === 'number' ? pct_(value, 1) : '—',
      {size: 14, color: C_INK, bold: true});
    if (tier) { chip_(slide, vx + 78, y + 5, tier); }
  });

  legend_(slide, PAD, top + METER_METRICS.length * rowH + 4);
}

function renderSummaryText_(slide, index, summary) {
  slideBase_(slide, index, '総評', 5);
  box_(slide, PAD, 104, 4, 150, C_NAVY);
  text_(slide, PAD + 20, 100, BODY_W - 20, 190, summary,
    {size: 16, color: C_INK, lineSpacing: 130});
}

function renderTwoColumn_(slide, index, review) {
  slideBase_(slide, index, '良かった点とボトルネック', 6);

  var colW = (BODY_W - 20) / 2;
  var cols = [
    {x: PAD, title: '良かった点', body: review.good, accent: TIER_STYLE['普通'].bar},
    {x: PAD + colW + 20, title: 'ボトルネック', body: review.bottleneck, accent: TIER_STYLE['悪い'].bar}
  ];

  cols.forEach(function (c) {
    card_(slide, c.x, 100, colW, 214);
    box_(slide, c.x, 100, colW, 4, c.accent);
    text_(slide, c.x + 20, 116, colW - 40, 22, c.title, {size: 14, color: c.accent, bold: true});
    text_(slide, c.x + 20, 146, colW - 40, 152, String(c.body || '').trim() || '（記載なし）',
      {size: 12, color: C_INK, lineSpacing: 130});
  });
}

function renderActions_(slide, index, actions) {
  slideBase_(slide, index, '来月やること', 7);

  var items = bullets_(actions).slice(0, 3);
  if (!items.length) { items = ['（記載なし）']; }

  var cardW = (BODY_W - 20 * (items.length - 1)) / items.length;
  items.forEach(function (body, i) {
    var x = PAD + i * (cardW + 20);
    card_(slide, x, 100, cardW, 214);
    box_(slide, x + 20, 122, 30, 30, C_NAVY, 15);
    text_(slide, x + 20, 128, 30, 20, String(i + 1),
      {size: 14, color: C_INK_ON_NAVY, bold: true, align: 'center'});
    text_(slide, x + 20, 166, cardW - 40, 130, body,
      {size: 12, color: C_INK, lineSpacing: 130});
  });
}

/* ---------------- 部品 ---------------- */

/** 本文スライドの共通部分。背景・見出し・フッター。 */
function slideBase_(slide, index, heading, pageNo) {
  slide.getBackground().setSolidFill(C_SURFACE);
  box_(slide, 0, 0, W, 56, C_NAVY);
  text_(slide, PAD, 18, BODY_W - 120, 22, heading,
    {size: 15, color: C_INK_ON_NAVY, bold: true});
  text_(slide, W - PAD - 120, 20, 120, 18, MONTHS[index],
    {size: 11, color: C_INK_MUTED_NAVY, align: 'right'});
  box_(slide, 0, H - 26, W, 1, C_LINE);
  text_(slide, W - PAD - 40, H - 22, 40, 14, String(pageNo),
    {size: 9, color: C_INK_SUB, align: 'right'});
}

/** 白いカード。 */
function card_(slide, x, y, w, h) {
  var shape = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, w, h);
  shape.getFill().setSolidFill(C_CARD);
  shape.getBorder().getLineFill().setSolidFill(C_LINE);
  shape.getBorder().setWeight(1);
  return shape;
}

/** 塗りつぶしの矩形。radius を渡すと角丸になる。 */
function box_(slide, x, y, w, h, color, radius) {
  var type = radius ? SlidesApp.ShapeType.ROUND_RECTANGLE : SlidesApp.ShapeType.RECTANGLE;
  var shape = slide.insertShape(type, x, y, Math.max(w, 1), Math.max(h, 1));
  shape.getFill().setSolidFill(color);
  shape.getBorder().setTransparent();
  return shape;
}

/**
 * 文字。透明な箱に入れて置く。
 * 中身が空だと getTextStyle が「has no text」で落ちるため、その場合は何も置かない。
 */
function text_(slide, x, y, w, h, content, opt) {
  var body = String(content === null || content === undefined ? '' : content);
  if (body.trim() === '') { return null; }

  var o = opt || {};
  var shape = slide.insertShape(SlidesApp.ShapeType.TEXT_BOX, x, y, w, h);
  shape.getFill().setTransparent();
  shape.getBorder().setTransparent();

  var range = shape.getText();
  range.setText(body);

  var style = range.getTextStyle();
  style.setFontFamily(FONT)
    .setFontSize(o.size || 12)
    .setForegroundColor(o.color || C_INK)
    .setBold(!!o.bold);

  var para = range.getParagraphStyle();
  para.setParagraphAlignment(alignment_(o.align));
  para.setSpaceAbove(0).setSpaceBelow(0);
  if (o.lineSpacing) { para.setLineSpacing(o.lineSpacing); }

  return shape;
}

function alignment_(name) {
  if (name === 'right') { return SlidesApp.ParagraphAlignment.END; }
  if (name === 'center') { return SlidesApp.ParagraphAlignment.CENTER; }
  return SlidesApp.ParagraphAlignment.START;
}

/** 判定バッジ。色だけに頼らず必ず文字も出す。 */
function chip_(slide, x, y, tier) {
  var style = TIER_STYLE[tier];
  box_(slide, x, y, 40, 18, style.soft, 4);
  text_(slide, x, y + 2, 40, 14, tier, {size: 9, color: style.ink, bold: true, align: 'center'});
}

/** 3段階の凡例。 */
function legend_(slide, x, y) {
  ['悪い', '普通', '良い'].forEach(function (tier, i) {
    var cx = x + i * 96;
    box_(slide, cx, y + 4, 10, 10, TIER_STYLE[tier].bar, 2);
    text_(slide, cx + 16, y, 80, 16, tier, {size: 10, color: C_INK_SUB});
  });
  text_(slide, x + 300, y, 300, 16, '目盛りは「良い」の2倍を上限にとっている',
    {size: 9, color: C_INK_SUB});
}

/** 前月比。上がって良い指標だけを扱うので、増＝緑・減＝赤でよい。 */
function deltaText_(slide, x, y, w, data, label) {
  if (!data.prev) { return; }
  var cur = metric_(data, label);
  var prev = prevMetric_(data, label);
  if (typeof cur !== 'number' || typeof prev !== 'number' || prev === 0) { return; }

  var diff = (cur - prev) / prev;
  var up = diff >= 0;
  text_(slide, x, y, w, 18,
    (up ? '▲ +' : '▼ ') + Math.round(diff * 100) + '%　前月比',
    {size: 10, color: up ? C_UP : C_DOWN, bold: true});
}

/* ---------------- 値の取り出しと整形 ---------------- */

function metric_(data, label) {
  for (var i = 0; i < data.metrics.length; i++) {
    if (data.metrics[i].label === label) { return data.metrics[i].value; }
  }
  return null;
}

function prevMetric_(data, label) {
  if (!data.prev) { return null; }
  for (var i = 0; i < data.prev.length; i++) {
    if (data.prev[i].label === label) { return data.prev[i].value; }
  }
  return null;
}

function benchmarkFor_(col) {
  for (var i = 0; i < BENCHMARKS.length; i++) {
    if (BENCHMARKS[i].col === col) { return BENCHMARKS[i]; }
  }
  return null;
}

function num_(v) {
  if (typeof v !== 'number') { return '—'; }
  return Math.round(v).toLocaleString();
}

function pct_(v, digits) {
  if (typeof v !== 'number') { return '—'; }
  var d = v < 0.001 ? 3 : digits;
  return (v * 100).toFixed(d) + '%';
}

function fmtBench_(v) {
  return v < 0.001 ? (v * 100).toFixed(3) + '%' : (v * 100).toFixed(0) + '%';
}

/** 「・」始まりの行を配列にする。無ければ改行で割る。 */
function bullets_(text) {
  var lines = String(text || '').split('\n')
    .map(function (l) { return l.replace(/^[・･\-•]\s*/, '').trim(); })
    .filter(function (l) { return l !== ''; });
  return lines;
}

/* ---------------- Drive まわり ---------------- */

function getReportFolder_() {
  var it = DriveApp.getFoldersByName(DECK_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DECK_FOLDER_NAME);
}

/** GoogleスライドをPPTXに書き出してフォルダに保存する。 */
function exportAsPptx_(fileId, name, folder) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + fileId
    + '/export?mimeType=' + encodeURIComponent(PPTX_MIME);

  var res = UrlFetchApp.fetch(url, {
    headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
    muteHttpExceptions: true
  });

  if (res.getResponseCode() !== 200) {
    throw new Error('PPTXへの書き出しに失敗しました (HTTP ' + res.getResponseCode() + ')\n'
      + res.getContentText());
  }

  return folder.createFile(res.getBlob().setName(name + '.pptx'));
}

/** できたファイルのリンクをダイアログで出す。 */
function showDeckLinks_(deckInfo, pptx) {
  var html = '<div style="font-family:sans-serif;font-size:13px;line-height:1.9">'
    + '<p><b>' + deckInfo.name + '</b> を作りました。</p>'
    + '<p>保存先: マイドライブ &gt; ' + DECK_FOLDER_NAME + '</p>'
    + '<p><a href="' + deckInfo.url + '" target="_blank">Googleスライドで開く（編集用）</a></p>'
    + '<p><a href="' + pptx.getUrl() + '" target="_blank">PPTXファイルを開く（配布用）</a></p>'
    + '</div>';

  SpreadsheetApp.getUi().showModalDialog(
    HtmlService.createHtmlOutput(html).setWidth(420).setHeight(220), 'レポートができました');
}
