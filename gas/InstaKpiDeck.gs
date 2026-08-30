/**
 * 月次レポートのスライドを作る。Googleスライドを組み立ててPPTXに書き出し、
 * Drive内のフォルダに両方を置く。
 *
 * 体裁はSINISの月次レポートに合わせてある。A4横・ネイビー基調・
 * 上部にセクションナビ・下部にCOMMENT枠。
 *
 * InstaKpiSheet.gs / InstaKpiReview.gs と同じプロジェクトに置くこと。
 */

var DECK_FOLDER_NAME = 'Instagram採用レポート';
var PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

var PAGE_W = 842;     // A4横(pt)。SINISのレポートと重ねられるサイズ
var PAGE_H = 595;

// 実際のページサイズ。作成後に読み直して入れる（作成に失敗して既定サイズに
// なった場合でも崩れないよう、位置はここから計算する）。
var W = PAGE_W;
var H = PAGE_H;
var PAD = 34;
var BODY_W = PAGE_W - 68;

/**
 * 本文の書体。Googleスライド上でも確実に出るNoto Sans JPを既定にしている。
 * PowerPoint側で参考レポートと完全に揃えたい場合は '游ゴシック' に変える。
 */
var FONT = 'Noto Sans JP';

// 参考レポートのテーマ色
var C_NAVY = '#3e63a3';      // 主役のアクセント
var C_INK = '#303030';       // 本文
var C_INK_SUB = '#595959';   // 補足
var C_INK_FAINT = '#8c8c8c'; // ナビの非選択など
var C_BG = '#ffffff';
var C_BG_SOFT = '#f8f8f8';   // COMMENT枠・表紙の帯
var C_RULE = '#d9d9d9';
var C_WHITE = '#ffffff';
var C_UP = '#1f79f2';        // 増（参考レポートに合わせて青）
var C_DOWN = '#e33721';      // 減

/**
 * 判定の3段階。赤／緑は色覚特性によっては見分けにくいため、
 * 必ずラベルと凡例を併記して色だけに頼らないようにしている。
 */
var TIER_STYLE = {
  '悪い': {bar: '#d03b3b', soft: '#f7dede', ink: '#8f2020'},
  '普通': {bar: '#0ca30c', soft: '#dcf0dc', ink: '#0b6b0b'},
  '良い': {bar: '#fab219', soft: '#fdeecd', ink: '#8a6100'}
};

var C_TRACK = '#e8eaee';     // バーの下地

/** 上部のセクションナビ。現在地を濃く出す。 */
var NAV = ['サマリー', 'ファネル', '目安との比較', '総評', 'アクション'];

/** ファネルの各段。rateCol は前の段からの転換率。 */
var FUNNEL_STAGES = [
  {name: 'リーチ',         countCol: 'D', rateCol: null, bench: null},
  {name: 'プロフアクセス', countCol: 'E', rateCol: 'O',  bench: 'O'},
  {name: 'リンクタップ',   countCol: 'F', rateCol: 'P',  bench: 'P'},
  {name: 'LINE登録',       countCol: 'G', rateCol: 'Q',  bench: 'Q'},
  {name: '面接',           countCol: 'H', rateCol: 'R',  bench: null},
  {name: '採用',           countCol: 'I', rateCol: 'S',  bench: null}
];

/** 目安つきの4指標。 */
var METER_METRICS = [
  {name: 'プロフアクセス率', col: 'O', bench: 'O', note: '投稿からプロフィールへの興味喚起'},
  {name: 'リンクタップ率',   col: 'P', bench: 'P', note: 'プロフィール文とハイライトの出来'},
  {name: 'LINE登録率',       col: 'Q', bench: 'Q', note: 'LP・登録導線の出来'},
  {name: 'リーチ→採用率',    col: 'V', bench: 'V', note: '全体の最終CVR'}
];

/** 用語解説スライドに載せる内容。 */
var GLOSSARY = [
  ['プロフアクセス率', 'プロフアクセス数 ÷ リーチ数。投稿を見た人のうち、プロフィールまで来た割合。目安3〜5%。3%未満は投稿がプロフィールまで引っ張れていない。'],
  ['リンクタップ率', 'リンクタップ数 ÷ プロフアクセス数。プロフィール文とハイライトの出来。10%が分岐点。'],
  ['LINE登録率', 'LINE登録 ÷ リンクタップ数。LPと登録導線の出来。20〜40%が一般的で、特典が強いと50%超も出る。'],
  ['面接率', '面接 ÷ LINE登録。LINE内トークの出来。業種差が大きいため目安は置いていない。'],
  ['採用率', '採用数 ÷ 面接。面接での見極めと訴求力。同じく目安は置いていない。'],
  ['リーチ→採用率', '採用数合計 ÷ リーチ数。全体の最終CVR。公開ベンチマークが無いため、上の指標から逆算した暫定値を目安にしている。実績が溜まったら自社の値に置き換える。']
];

/* ---------------- 入口 ---------------- */

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
      + '「この月のレポートを作る（総評＋スライド）」を使うか、'
      + '先に「この月の総評をAIに書かせる」を実行してください。');
  }

  toast_(MONTHS[index] + 'のスライドを作っています…');

  var deckInfo = renderDeck_(index, data, {
    summary: String(review[0]),
    good: String(review[1]),
    bottleneck: String(review[2]),
    actions: String(review[3])
  });

  var folder = getReportFolder_();
  DriveApp.getFileById(deckInfo.id).moveTo(folder);
  var pptx = exportAsPptx_(deckInfo.id, deckInfo.name, folder);

  writeDeckLinks_(reviewSheet, index, deckInfo.url, pptx.getUrl());
  showDeckLinks_(deckInfo, pptx);
}

/* ---------------- 組み立て ---------------- */

function renderDeck_(index, data, review) {
  var deck = createDeck_('Instagram採用レポート ' + MONTHS[index]);
  var info = {id: deck.getId(), name: deck.getName(), url: deck.getUrl()};

  // 実際のページサイズに合わせて余白を決め直す。
  W = deck.getPageWidth();
  H = deck.getPageHeight();
  PAD = Math.round(W * 0.04);
  BODY_W = W - PAD * 2;

  var cover = deck.getSlides()[0];
  cover.getPageElements().forEach(function (el) { el.remove(); });

  renderCover_(cover, index);
  renderSummary_(newSlide_(deck), index, data, review.summary);
  renderFunnel_(newSlide_(deck), index, review.bottleneck);
  renderMeters_(newSlide_(deck), index);
  renderGoodBad_(newSlide_(deck), index, review);
  renderActions_(newSlide_(deck), index, review.actions);
  renderGlossary_(newSlide_(deck), index);

  deck.saveAndClose();
  return info;
}

/**
 * A4横のプレゼンを作る。SlidesApp にはページサイズを指定する手段が無いため
 * Slides API を直接叩く。失敗したら既定サイズで作る（位置はページサイズから
 * 計算しているので、その場合も崩れない）。
 */
function createDeck_(title) {
  try {
    var res = UrlFetchApp.fetch('https://slides.googleapis.com/v1/presentations', {
      method: 'post',
      contentType: 'application/json',
      headers: {Authorization: 'Bearer ' + ScriptApp.getOAuthToken()},
      payload: JSON.stringify({
        title: title,
        pageSize: {
          width: {magnitude: PAGE_W, unit: 'PT'},
          height: {magnitude: PAGE_H, unit: 'PT'}
        }
      }),
      muteHttpExceptions: true
    });

    if (res.getResponseCode() === 200) {
      return SlidesApp.openById(JSON.parse(res.getContentText()).presentationId);
    }
    Logger.log('A4サイズでの作成に失敗したため既定サイズで作ります: ' + res.getContentText());
  } catch (e) {
    Logger.log('A4サイズでの作成に失敗したため既定サイズで作ります: ' + e.message);
  }
  return SlidesApp.create(title);
}

function newSlide_(deck) {
  return deck.appendSlide(SlidesApp.PredefinedLayout.BLANK);
}

/* ---------------- 各スライド ---------------- */

function renderCover_(slide, index) {
  slide.getBackground().setSolidFill(C_BG);

  var bandY = H * 0.60;
  box_(slide, 0, bandY, W, H - bandY, C_BG_SOFT);

  var titleTop = bandY - 150;
  text_(slide, PAD, titleTop, BODY_W, 24, 'Instagram Recruiting Monthly Report',
    {size: 15, color: C_NAVY, bold: true});
  text_(slide, PAD, titleTop + 32, BODY_W, 50, 'Instagram採用 月次レポート',
    {size: 34, color: C_INK, bold: true});
  box_(slide, PAD, titleTop + 96, 56, 3, C_NAVY);

  var rows = [
    ['●対象月', MONTHS[index]],
    ['●作成日', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd')]
  ];
  rows.forEach(function (r, i) {
    var y = bandY + 42 + i * 40;
    text_(slide, PAD + 12, y, 150, 20, r[0], {size: 12, color: C_INK_SUB, bold: true});
    text_(slide, PAD + 180, y, 240, 20, r[1], {size: 12, color: C_INK});
    box_(slide, PAD + 180, y + 24, 200, 1, C_RULE);
  });

  text_(slide, W - PAD - 260, H - 46, 260, 18, 'LIB creation.',
    {size: 11, color: C_INK_SUB, align: 'right'});
}

function renderSummary_(slide, index, data, summary) {
  var body = slideBase_(slide, index, '全体サマリー', 0, 2);

  var cards = [
    {label: 'リーチ数', key: 'リーチ数', unit: 'アカウント'},
    {label: 'プロフアクセス数', key: null, col: 'E', unit: '件'},
    {label: 'LINE登録', key: 'LINE登録数', unit: '件'},
    {label: '面接', key: '面接数', unit: '件'},
    {label: '採用数', key: '採用数 合計', unit: '人', accent: true}
  ];

  var gap = 14;
  var cardW = (BODY_W - gap * (cards.length - 1)) / cards.length;
  var cardH = Math.min(132, body.height - COMMENT_H - 40);
  var kpi = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var row = FIRST_ROW + index;

  cards.forEach(function (c, i) {
    var x = PAD + i * (cardW + gap);
    var value = c.key ? metric_(data, c.key) : kpi.getRange(c.col + row).getValue();

    card_(slide, x, body.top, cardW, cardH, c.accent);
    if (c.accent) { box_(slide, x, body.top, cardW, 3, C_NAVY); }

    // カードの高さに合わせて中身を置く。低いカードでもはみ出さない。
    text_(slide, x + 16, body.top + 16, cardW - 32, 16, c.label,
      {size: 10, color: C_INK_SUB, bold: true});
    text_(slide, x + 16, body.top + 38, cardW - 32, cardH - 82, num_(value),
      {size: c.accent ? 30 : 26, color: c.accent ? C_NAVY : C_INK, bold: true});
    text_(slide, x + 16, body.top + cardH - 42, cardW - 32, 14, c.unit,
      {size: 9, color: C_INK_FAINT});
    if (c.key) {
      deltaText_(slide, x + 16, body.top + cardH - 24, cardW - 32, data, c.key);
    }
  });

  text_(slide, PAD, body.top + cardH + 8, BODY_W, 14,
    data.prev ? '（　）内は前月（' + data.prevMonth + '）比' : '前月のデータがないため前月比は出していません',
    {size: 9, color: C_INK_FAINT});

  commentBox_(slide, body, '総評', summary);
}

function renderFunnel_(slide, index, bottleneck) {
  var body = slideBase_(slide, index, 'ファネル：どこで人が減っているか', 1, 3);

  var kpi = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var row = FIRST_ROW + index;

  var nameW = 128;
  var trackX = PAD + nameW + 12;
  var trackW = BODY_W - nameW - 12 - 260;
  var rateX = trackX + trackW + 14;
  var chipX = rateX + 66;
  var countW = 110;
  var countX = PAD + BODY_W - countW;

  text_(slide, trackX, body.top - 18, trackW, 12, '前の段からの転換率',
    {size: 9, color: C_INK_FAINT});
  text_(slide, countX, body.top - 18, countW, 12, '人数',
    {size: 9, color: C_INK_FAINT, align: 'right'});

  var rowH = Math.min(38, (body.height - COMMENT_H - 30) / FUNNEL_STAGES.length);
  FUNNEL_STAGES.forEach(function (stage, i) {
    var y = body.top + i * rowH;
    var count = kpi.getRange(stage.countCol + row).getValue();
    var rate = stage.rateCol ? kpi.getRange(stage.rateCol + row).getValue() : null;

    text_(slide, PAD, y + 5, nameW, 18, stage.name, {size: 11, color: C_INK, bold: true});
    box_(slide, trackX, y + 8, trackW, 13, C_TRACK, 3);

    if (typeof rate === 'number' && rate > 0) {
      var tier = stage.bench ? judge_(stage.bench, rate) : '';
      box_(slide, trackX, y + 8, Math.max(6, Math.min(1, rate) * trackW), 13,
        tier ? TIER_STYLE[tier].bar : C_NAVY, 3);
      text_(slide, rateX, y + 5, 62, 18, pct_(rate, 1), {size: 11, color: C_INK, bold: true});
      if (tier) { chip_(slide, chipX, y + 6, tier); }
    } else if (i > 0) {
      text_(slide, rateX, y + 5, 62, 18, '—', {size: 11, color: C_INK_FAINT});
    }

    text_(slide, countX, y + 5, countW, 18, num_(count),
      {size: 11, color: C_INK_SUB, align: 'right'});
  });

  commentBox_(slide, body, 'ボトルネック', bottleneck
    || '面接・採用の段は業種差が大きいため目安を置いていません（ネイビーのバー）。');
}

function renderMeters_(slide, index) {
  var body = slideBase_(slide, index, '目安に対する評価', 2, 4);

  var kpi = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var row = FIRST_ROW + index;

  var labelW = 190;
  var trackX = PAD + labelW;
  var trackW = BODY_W - labelW - 190;
  var rowH = Math.min(64, (body.height - 26) / METER_METRICS.length);

  METER_METRICS.forEach(function (m, i) {
    var y = body.top + i * rowH;
    var value = kpi.getRange(m.col + row).getValue();
    var bench = benchmarkFor_(m.bench);
    var tier = judge_(m.bench, value);
    var max = bench.good * 2;   // 「良い」の線がちょうど真ん中に来る

    text_(slide, PAD, y, labelW - 10, 18, m.name, {size: 11, color: C_INK, bold: true});
    text_(slide, PAD, y + 19, labelW - 10, 14, m.note, {size: 8, color: C_INK_FAINT});

    box_(slide, trackX, y + 3, trackW, 16, C_TRACK, 3);
    if (typeof value === 'number' && value > 0) {
      box_(slide, trackX, y + 3, Math.max(6, Math.min(value / max, 1) * trackW), 16,
        TIER_STYLE[tier].bar, 3);
    }

    [bench.bad, bench.good].forEach(function (t) {
      box_(slide, trackX + (t / max) * trackW, y, 1, 22, '#9a9a94');
      text_(slide, trackX + (t / max) * trackW - 26, y + 24, 52, 12, fmtBench_(t),
        {size: 8, color: C_INK_FAINT, align: 'center'});
    });

    var vx = trackX + trackW + 16;
    text_(slide, vx, y + 1, 84, 20, typeof value === 'number' ? pct_(value, 1) : '—',
      {size: 14, color: C_INK, bold: true});
    if (tier) { chip_(slide, vx + 88, y + 4, tier); }
  });

  legend_(slide, PAD, body.top + METER_METRICS.length * rowH);
}

function renderGoodBad_(slide, index, review) {
  var body = slideBase_(slide, index, '良かった点とボトルネック', 3, 5);

  var colW = (BODY_W - 20) / 2;
  [
    {x: PAD, title: '良かった点', body: review.good, accent: TIER_STYLE['普通'].bar},
    {x: PAD + colW + 20, title: 'ボトルネック', body: review.bottleneck, accent: TIER_STYLE['悪い'].bar}
  ].forEach(function (c) {
    card_(slide, c.x, body.top, colW, body.height);
    box_(slide, c.x, body.top, colW, 3, c.accent);
    text_(slide, c.x + 22, body.top + 20, colW - 44, 20, c.title,
      {size: 13, color: c.accent, bold: true});
    text_(slide, c.x + 22, body.top + 50, colW - 44, body.height - 70,
      String(c.body || '').trim() || '（記載なし）',
      {size: 11, color: C_INK, lineSpacing: 140});
  });
}

function renderActions_(slide, index, actions) {
  var body = slideBase_(slide, index, '来月やること', 4, 6);

  var items = bullets_(actions).slice(0, 3);
  if (!items.length) { items = ['（記載なし）']; }

  var gap = 20;
  var cardW = (BODY_W - gap * (items.length - 1)) / items.length;
  items.forEach(function (bodyText, i) {
    var x = PAD + i * (cardW + gap);
    card_(slide, x, body.top, cardW, body.height);
    box_(slide, x + 22, body.top + 24, 30, 30, C_NAVY, 15);
    text_(slide, x + 22, body.top + 30, 30, 20, String(i + 1),
      {size: 13, color: C_WHITE, bold: true, align: 'center'});
    text_(slide, x + 22, body.top + 74, cardW - 44, body.height - 96, bodyText,
      {size: 11, color: C_INK, lineSpacing: 140});
  });
}

function renderGlossary_(slide, index) {
  var body = slideBase_(slide, index, '指標の見方', -1, 7);

  var rowH = Math.min(46, body.height / GLOSSARY.length);
  GLOSSARY.forEach(function (g, i) {
    var y = body.top + i * rowH;
    box_(slide, PAD, y + 6, 3, rowH - 14, C_NAVY);
    text_(slide, PAD + 14, y + 2, 150, 18, g[0], {size: 11, color: C_INK, bold: true});
    text_(slide, PAD + 176, y + 2, BODY_W - 176, rowH - 10, g[1],
      {size: 9, color: C_INK_SUB, lineSpacing: 130});
  });
}

/* ---------------- 共通部品 ---------------- */

/**
 * 本文スライドの枠組み。見出し・セクションナビ・区切り線・ページ番号を置き、
 * 本文に使える範囲を返す。navIndex が -1 のときはナビを出さない。
 */
function slideBase_(slide, index, heading, navIndex, pageNo) {
  slide.getBackground().setSolidFill(C_BG);

  text_(slide, PAD, H * 0.045, BODY_W - 200, 28, heading,
    {size: 18, color: C_INK, bold: true});
  text_(slide, PAD + BODY_W - 200, H * 0.052, 200, 18, MONTHS[index] + ' レポート',
    {size: 10, color: C_INK_FAINT, align: 'right'});

  var navY = H * 0.125;
  if (navIndex >= 0) {
    var stepW = BODY_W / NAV.length;
    NAV.forEach(function (label, i) {
      var on = i === navIndex;
      box_(slide, PAD + i * stepW, navY + 3, 9, 9, on ? C_NAVY : C_RULE);
      text_(slide, PAD + i * stepW + 15, navY, stepW - 20, 16, label,
        {size: 10, color: on ? C_NAVY : C_INK_FAINT, bold: on});
    });
  }

  var ruleY = navY + 24;
  box_(slide, PAD, ruleY, BODY_W, 1, C_RULE);
  box_(slide, PAD, H - 34, BODY_W, 1, C_RULE);
  text_(slide, PAD + BODY_W - 40, H - 28, 40, 14, String(pageNo),
    {size: 9, color: C_INK_FAINT, align: 'right'});

  var top = ruleY + 34;
  return {top: top, height: H - 58 - top, bottom: H - 58};
}

var COMMENT_H = 92;   // 下部のCOMMENT枠の高さ

/** 下部のCOMMENT枠。参考レポートと同じく本文の下に敷く。 */
function commentBox_(slide, body, label, content) {
  var h = COMMENT_H;
  var y = body.bottom - h;
  box_(slide, PAD, y, BODY_W, h, C_BG_SOFT);
  box_(slide, PAD, y, 3, h, C_NAVY);
  text_(slide, PAD + 18, y + 12, 200, 16, label, {size: 10, color: C_NAVY, bold: true});
  text_(slide, PAD + 18, y + 32, BODY_W - 36, h - 42,
    String(content || '').trim() || '（記載なし）',
    {size: 10, color: C_INK, lineSpacing: 135});
}

/** 白いカード。accent を渡すと枠をネイビーにする。 */
function card_(slide, x, y, w, h, accent) {
  var shape = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, x, y, w, h);
  shape.getFill().setSolidFill(C_BG);
  shape.getBorder().getLineFill().setSolidFill(accent ? C_NAVY : C_RULE);
  shape.getBorder().setWeight(1);
  return shape;
}

function box_(slide, x, y, w, h, color, radius) {
  var type = radius ? SlidesApp.ShapeType.ROUND_RECTANGLE : SlidesApp.ShapeType.RECTANGLE;
  var shape = slide.insertShape(type, x, y, Math.max(w, 1), Math.max(h, 1));
  shape.getFill().setSolidFill(color);
  shape.getBorder().setTransparent();
  return shape;
}

/**
 * 文字。中身が空だと getTextStyle が「has no text」で落ちるため、
 * その場合は何も置かない。
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
  range.getTextStyle()
    .setFontFamily(FONT)
    .setFontSize(o.size || 11)
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
  box_(slide, x, y, 38, 17, style.soft, 4);
  text_(slide, x, y + 2, 38, 13, tier, {size: 8, color: style.ink, bold: true, align: 'center'});
}

function legend_(slide, x, y) {
  ['悪い', '普通', '良い'].forEach(function (tier, i) {
    var cx = x + i * 88;
    box_(slide, cx, y + 4, 10, 10, TIER_STYLE[tier].bar, 2);
    text_(slide, cx + 15, y, 70, 15, tier, {size: 9, color: C_INK_SUB});
  });
  text_(slide, x + 280, y, 400, 15,
    '目盛りは「良い」の2倍を上限にとり、悪い／普通の境目に線を立てている',
    {size: 9, color: C_INK_FAINT});
}

/** 前月比。増えて良い指標だけなので、増＝青・減＝赤でよい。 */
function deltaText_(slide, x, y, w, data, label) {
  if (!data.prev) { return; }
  var cur = metric_(data, label);
  var prev = prevMetric_(data, label);
  if (typeof cur !== 'number' || typeof prev !== 'number') { return; }

  var diff = cur - prev;
  var up = diff >= 0;
  var pctPart = prev === 0 ? '' : '　' + (up ? '+' : '') + Math.round((diff / prev) * 100) + '%';
  text_(slide, x, y, w, 16,
    '(' + (up ? '+ ' : '- ') + Math.abs(Math.round(diff)).toLocaleString() + ')' + pctPart,
    {size: 9, color: up ? C_UP : C_DOWN, bold: true});
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
  return typeof v === 'number' ? Math.round(v).toLocaleString() : '—';
}

function pct_(v, digits) {
  if (typeof v !== 'number') { return '—'; }
  return (v * 100).toFixed(v < 0.001 ? 3 : digits) + '%';
}

function fmtBench_(v) {
  return v < 0.001 ? (v * 100).toFixed(3) + '%' : (v * 100).toFixed(0) + '%';
}

/** 「・」始まりの行を配列にする。 */
function bullets_(text) {
  return String(text || '').split('\n')
    .map(function (l) { return l.replace(/^[・･\-•]\s*/, '').trim(); })
    .filter(function (l) { return l !== ''; });
}

/* ---------------- Drive まわり ---------------- */

function getReportFolder_() {
  var it = DriveApp.getFoldersByName(DECK_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(DECK_FOLDER_NAME);
}

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

/** レビューシートのH・I列に、その月のレポートへのリンクを書く。 */
function writeDeckLinks_(sheet, index, deckUrl, pptxUrl) {
  var row = REVIEW_FIRST_ROW + index;
  sheet.getRange(row, 8).setFormula('=HYPERLINK("' + deckUrl + '","スライドを開く")');
  sheet.getRange(row, 9).setFormula('=HYPERLINK("' + pptxUrl + '","PPTXを開く")');
}

/**
 * できたファイルを知らせる。エディタから実行した場合はUIが無くて
 * ダイアログを出せないので、URLは必ず実行ログに残す。
 */
function showDeckLinks_(deckInfo, pptx) {
  var pptxUrl = pptx.getUrl();
  Logger.log([
    deckInfo.name + ' を作りました。',
    '保存先: マイドライブ > ' + DECK_FOLDER_NAME,
    'スライド（編集用）: ' + deckInfo.url,
    'PPTX（配布用）: ' + pptxUrl
  ].join('\n'));

  var html = '<div style="font-family:sans-serif;font-size:13px;line-height:1.9">'
    + '<p><b>' + deckInfo.name + '</b> を作りました。</p>'
    + '<p>保存先: マイドライブ &gt; ' + DECK_FOLDER_NAME + '</p>'
    + '<p><a href="' + deckInfo.url + '" target="_blank">Googleスライドで開く（編集用）</a></p>'
    + '<p><a href="' + pptxUrl + '" target="_blank">PPTXファイルを開く（配布用）</a></p>'
    + '</div>';

  try {
    SpreadsheetApp.getUi().showModalDialog(
      HtmlService.createHtmlOutput(html).setWidth(420).setHeight(220), 'レポートができました');
  } catch (e) {
    Logger.log('ダイアログは表示できませんでした（' + e.message + '）。上のURLを使ってください。');
  }
}

/** スプレッドシートの右下に出す通知。UIが無い実行ではログに落とす。 */
function toast_(message) {
  try {
    SpreadsheetApp.getActive().toast(message);
  } catch (e) {
    Logger.log(message);
  }
}
