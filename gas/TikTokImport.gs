/**
 * TikTokの実績を、月次KPIの「TikTok」行へ入れる。
 *
 * 入り口は2つある。使えるほうを使う。
 *
 *  A. CSVを貼る（いますぐ使える）
 *     TikTokのアナリティクス（パソコンのブラウザ）→ 概要 → データをダウンロード
 *     で落ちてくるCSVを、「TikTok貼り付け」タブにそのまま貼る。
 *     メニュー「TikTokの数字を貼り付けから取り込む」で月ごとに集計して転記する。
 *
 *  B. APIで取る（審査が要る）
 *     TikTok for Developers でアプリを作り、Business Account API の
 *     審査を通してアクセストークンを発行する。1〜2週間かかる。
 *     通ったら「APIキー・トークンを設定する」でトークンとビジネスIDを登録する。
 *
 * Aで運用を始めて、Bが通ったら切り替える、という順番を想定している。
 * TikTokは審査の結果が読めないので、Bを待つ設計にはしない。
 */

var TIKTOK_TOKEN_PROP = 'TIKTOK_ACCESS_TOKEN';
var TIKTOK_BUSINESS_PROP = 'TIKTOK_BUSINESS_ID';
var TIKTOK_PASTE_SHEET = 'TikTok貼り付け';
var TIKTOK_API = 'https://business-api.tiktok.com/open_api/v1.3/business/get/';
var TIKTOK_PASTE_HEAD_ROW_ = 6;   // 貼り付けの見出し行

/**
 * CSVの見出しと、KPIシートの列の対応。
 *
 * TikTokは表示言語で見出しの文字を変えるうえ、たまに言い回しも変える。
 * 完全一致では拾えないので、含まれていればよい語で照合する。
 */
var TIKTOK_CSV_COLUMNS = [
  {key: '表示回数',       stock: false, words: ['動画の視聴回数', '再生数', 'video views', 'views']},
  {key: 'リーチ数',       stock: false, words: ['リーチ', 'reach', 'unique viewers']},
  {key: 'プロフィール表示', stock: false, words: ['プロフィールの表示', 'プロフィール表示', 'profile views']},
  {key: '保存・シェア',   stock: false, words: ['シェア', 'shares']},
  {key: 'フォロワー数',   stock: true,  words: ['フォロワー', 'followers']}
];

/** APIで聞く項目。審査が通ってから、返ってくる名前に合わせて直す前提。 */
var TIKTOK_API_FIELDS = [
  {api: 'video_views',   key: '表示回数'},
  {api: 'reach',         key: 'リーチ数'},
  {api: 'profile_views', key: 'プロフィール表示'},
  {api: 'shares',        key: '保存・シェア'}
];

/* ---------------- A. CSVを貼る ---------------- */

/** 貼り付け用のタブを作る（無ければ）。使い方も書いておく。 */
function createTikTokPasteSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(TIKTOK_PASTE_SHEET);
  if (!sheet) { sheet = ss.insertSheet(TIKTOK_PASTE_SHEET); }

  sheet.clear();
  sheet.getRange(1, 1, 1, 6).merge()
    .setValue('TikTokのCSVをここに貼る')
    .setBackground(COLOR_NAVY).setFontColor('#ffffff')
    .setFontSize(13).setFontWeight('bold');
  sheet.setRowHeight(1, 30);

  [
    'パソコンのブラウザで TikTok → アナリティクス → 概要 → データをダウンロード',
    '落ちてきたCSVを開いて、全部コピーして、下の4行目から貼り付けてください',
    '（1行目が見出しの行になるように貼ります。日付の列があれば、順番は問いません）',
    '貼ったら メニュー「TikTokの数字を貼り付けから取り込む」'
  ].forEach(function (text, i) {
    sheet.getRange(2 + i, 1, 1, 6).merge().setValue((i + 1) + '. ' + text)
      .setFontColor('#444444');
  });

  sheet.getRange(TIKTOK_PASTE_HEAD_ROW_, 1, 1, 6)
    .setBackground(COLOR_SETTING_BG)
    .setNote('ここから下に貼ってください');
  sheet.setColumnWidth(1, 120);
  ss.setActiveSheet(sheet);
}

/** 貼られたCSVを月ごとにまとめて、KPIシートのTikTok行へ入れる。 */
function importTikTokFromPaste() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var paste = ss.getSheetByName(TIKTOK_PASTE_SHEET);
  if (!paste) {
    throw new Error('「' + TIKTOK_PASTE_SHEET + '」タブがありません。'
      + 'メニューの「TikTokの貼り付け用タブを作る」を先に実行してください。');
  }
  var kpi = ss.getSheetByName(SHEET_NAME);
  if (!kpi) { throw new Error('「' + SHEET_NAME + '」タブがありません。'); }

  var table = tkReadPaste_(paste);
  if (!table.rows.length) {
    throw new Error('貼り付けられた数字が見つかりません。'
      + TIKTOK_PASTE_HEAD_ROW_ + '行目に見出し、その下に日付ごとの行が並ぶように貼ってください。');
  }
  if (table.dateIndex < 0) {
    throw new Error('日付の列が見つかりません。見出しに「日付」か「Date」がある表を貼ってください。');
  }
  if (!table.found.length) {
    throw new Error('読める列がありませんでした。見出しの行ごと貼れているか確認してください。\n'
      + '見えている見出し：' + table.headers.join(' / '));
  }

  var monthly = tkAggregate_(table);
  var start = igStartMonth_(ss);
  var channelIndex = CHANNELS.indexOf('TikTok');
  if (channelIndex < 0) { throw new Error('CHANNELS に TikTok がありません。'); }

  var wrote = [];
  var outside = [];
  Object.keys(monthly).forEach(function (key) {
    var index = tkMonthIndex_(start, key);
    if (index < 0 || index >= MONTHS.length) { outside.push(key); return; }

    var row = channelFirstRow_(index) + channelIndex;
    var values = monthly[key];
    Object.keys(values).forEach(function (col) {
      kpi.getRange(col_(col) + row).setValue(values[col]);
    });
    wrote.push(MONTHS[index]);
  });

  var lines = ['読めた列：' + table.found.join('・')];
  if (wrote.length) { lines.push('取り込んだ月：' + wrote.join('・')); }
  if (outside.length) {
    lines.push('シートの期間の外だった月：' + outside.join('・')
      + '（広告タブの「集計の開始年月」より前か、先すぎる月です）');
  }
  if (table.ignored.length) {
    lines.push('', '使わなかった列：' + table.ignored.join('・'));
  }
  lines.push('', 'LINE友だち追加から下は、CSVに無いので手入力のままです。');

  var message = lines.join('\n');
  Logger.log(message);
  metaNotify_('TikTokの取り込み', message);
}

/** 貼られた表を読む。見出しの行から下を、日付のある行だけ拾う。 */
function tkReadPaste_(sheet) {
  var last = sheet.getLastRow();
  var width = Math.max(sheet.getLastColumn(), 1);
  if (last < TIKTOK_PASTE_HEAD_ROW_ + 1) {
    return {headers: [], rows: [], dateIndex: -1, found: [], ignored: [], map: {}};
  }

  var values = sheet.getRange(TIKTOK_PASTE_HEAD_ROW_, 1,
                              last - TIKTOK_PASTE_HEAD_ROW_ + 1, width).getValues();
  var headers = values[0].map(function (v) { return String(v || '').trim(); });

  var dateIndex = -1;
  headers.forEach(function (h, i) {
    if (dateIndex < 0 && /日付|date/i.test(h)) { dateIndex = i; }
  });

  var map = {};
  var found = [];
  var ignored = [];
  headers.forEach(function (header, i) {
    if (i === dateIndex || !header) { return; }
    var spec = tkMatchColumn_(header);
    if (spec) {
      // 同じ列に当たる見出しが2つあるときは、先に出たほうを使う。
      if (!map[spec.key]) { map[spec.key] = {index: i, stock: spec.stock}; found.push(header); }
      else { ignored.push(header); }
    } else {
      ignored.push(header);
    }
  });

  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var date = tkDate_(values[r][dateIndex]);
    if (!date) { continue; }
    rows.push({date: date, cells: values[r]});
  }

  return {headers: headers, rows: rows, dateIndex: dateIndex,
          found: found, ignored: ignored, map: map};
}

/** 見出しの文字から、どの列に入れるかを決める。 */
function tkMatchColumn_(header) {
  var text = header.toLowerCase();
  for (var i = 0; i < TIKTOK_CSV_COLUMNS.length; i++) {
    var spec = TIKTOK_CSV_COLUMNS[i];
    for (var w = 0; w < spec.words.length; w++) {
      if (text.indexOf(spec.words[w].toLowerCase()) >= 0) { return spec; }
    }
  }
  return null;
}

/**
 * 日ごとの行を月ごとにまとめる。
 * フォロワー数だけは足さずに、その月の最後の日の数を使う（残高なので）。
 */
function tkAggregate_(table) {
  var out = {};
  table.rows.forEach(function (row) {
    var key = row.date.getFullYear() + '-' + (row.date.getMonth() + 1);
    if (!out[key]) { out[key] = {}; }

    Object.keys(table.map).forEach(function (col) {
      var spec = table.map[col];
      var n = tkNumber_(row.cells[spec.index]);
      if (n === null) { return; }
      if (spec.stock) {
        // 月末に近いほうを残す
        if (!out[key]._last || out[key]._last[col] === undefined
            || row.date >= out[key]._last[col]) {
          out[key][col] = n;
          out[key]._last = out[key]._last || {};
          out[key]._last[col] = row.date;
        }
      } else {
        out[key][col] = (out[key][col] || 0) + n;
      }
    });
  });

  Object.keys(out).forEach(function (key) { delete out[key]._last; });
  return out;
}

/** 「2026-05」形式の月が、開始年月から何ヶ月後か。 */
function tkMonthIndex_(start, key) {
  var parts = key.split('-');
  var year = Number(parts[0]);
  var month = Number(parts[1]) - 1;
  return (year - start.getFullYear()) * 12 + (month - start.getMonth());
}

/** セルの日付。Dateでも「2026-05-01」でも「2026/5/1」でも読む。 */
function tkDate_(value) {
  if (value instanceof Date) { return value; }
  var m = String(value || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) { return null; }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** 「1,234」「12.3%」のような文字も数字にする。読めなければ null。 */
function tkNumber_(value) {
  if (typeof value === 'number') { return value; }
  var text = String(value || '').replace(/[,\s円%]/g, '');
  if (!text) { return null; }
  var n = Number(text);
  return isNaN(n) ? null : n;
}

/* ---------------- B. APIで取る ---------------- */

/** 審査が通ってトークンを登録したあと、こちらを使う。 */
function importTikTokApi() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty(TIKTOK_TOKEN_PROP);
  var business = props.getProperty(TIKTOK_BUSINESS_PROP);
  if (!token || !business) {
    throw new Error('TikTokのトークンとビジネスIDが未登録です。\n'
      + 'メニュー「TikTokのトークンを設定する」から入れてください。\n'
      + '審査が終わっていない場合は、CSVを貼るほうを使ってください。');
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kpi = ss.getSheetByName(SHEET_NAME);
  if (!kpi) { throw new Error('「' + SHEET_NAME + '」タブがありません。'); }

  var start = igStartMonth_(ss);
  var channelIndex = CHANNELS.indexOf('TikTok');
  var today = new Date();
  var wrote = [], empty = [], failed = [];
  var latestRow = 0;

  for (var i = 0; i < MONTHS.length; i++) {
    var span = metaMonthSpan_(start, i);
    if (span.first > today) { break; }

    var got;
    try {
      got = tkFetch_(token, business, span);
    } catch (e) {
      failed.push(MONTHS[i] + '：' + e.message);
      continue;
    }
    if (!got) { empty.push(MONTHS[i]); continue; }

    var row = channelFirstRow_(i) + channelIndex;
    Object.keys(got).forEach(function (key) {
      kpi.getRange(col_(key) + row).setValue(got[key]);
    });
    latestRow = row;
    wrote.push(MONTHS[i]);
  }

  var followers = tkFollowers_(token, business);
  if (followers !== null && latestRow) {
    kpi.getRange(col_('フォロワー数') + latestRow).setValue(followers);
  }

  var lines = [];
  if (wrote.length) { lines.push('取り込んだ月：' + wrote.join('・')); }
  if (empty.length) { lines.push('記録が無かった月：' + empty.join('・')); }
  if (failed.length) { lines.push('取れなかった月：\n' + failed.join('\n')); }
  if (!lines.length) { lines.push('取り込む月がありませんでした。'); }

  var message = lines.join('\n');
  Logger.log(message);
  metaNotify_('TikTokの取り込み（API）', message);
}

/** トークンとビジネスIDを登録する。どちらもセルには書かない。 */
function setTikTokToken() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var token = ui.prompt('TikTokのアクセストークン',
    'TikTok for Developers で発行したトークンを貼ってください。'
    + '\n空のままOKを押すと、いまの登録を消します。', ui.ButtonSet.OK_CANCEL);
  if (token.getSelectedButton() !== ui.Button.OK) { return; }
  var t = token.getResponseText().trim();
  if (t) { props.setProperty(TIKTOK_TOKEN_PROP, t); }
  else { props.deleteProperty(TIKTOK_TOKEN_PROP); }

  var business = ui.prompt('TikTokのビジネスID',
    'Business Account API の business_id です。', ui.ButtonSet.OK_CANCEL);
  if (business.getSelectedButton() !== ui.Button.OK) { return; }
  var b = business.getResponseText().trim();
  if (b) { props.setProperty(TIKTOK_BUSINESS_PROP, b); }
  else { props.deleteProperty(TIKTOK_BUSINESS_PROP); }

  ui.alert('登録しました',
    'トークンはスクリプトの設定にだけ入れています。シートには書きません。',
    ui.ButtonSet.OK);
}

/** 登録の状態だけ見る。トークンは伏せて出す。 */
function checkTikTokSettings() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty(TIKTOK_TOKEN_PROP);
  var business = props.getProperty(TIKTOK_BUSINESS_PROP);

  var lines = [
    'トークン：' + (token ? '登録あり（' + metaMask_(token) + '）' : '未登録'),
    'ビジネスID：' + (business || '未登録')
  ];

  if (token && business) {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    try {
      var span = metaMonthSpan_(igStartMonth_(ss),
        Math.max(0, tkLatestPastIndex_(igStartMonth_(ss))));
      var got = tkFetch_(token, business, span);
      lines.push('接続テスト：成功（' + span.since + '〜' + span.until + '）');
      lines.push(got ? '　表示回数 ' + (got['表示回数'] || 0).toLocaleString()
                     : '　この月は記録がありません');
    } catch (e) {
      lines.push('接続テスト：失敗　' + e.message);
    }
  } else {
    lines.push('', '審査が終わるまでは、CSVを貼るほうを使ってください。');
  }

  metaNotify_('TikTokの設定', lines.join('\n'));
}

/** 今日までで一番新しい月。 */
function tkLatestPastIndex_(start) {
  var today = new Date();
  for (var i = MONTHS.length - 1; i > 0; i--) {
    if (metaMonthSpan_(start, i).first <= today) { return i; }
  }
  return 0;
}

/**
 * 1ヶ月ぶん取る。
 *
 * 返ってくる形が版によって変わるので、data の直下と data.metrics の
 * 両方を見る。項目名が変わっていたら、取れたものだけ入れる。
 */
function tkFetch_(token, business, span) {
  // 月末が未来だと弾かれるので、今日までに丸める（YouTubeImport.gs の関数）
  var range = ytClampSpan_(span);
  var fields = TIKTOK_API_FIELDS.map(function (f) { return f.api; });
  var url = TIKTOK_API
    + '?business_id=' + encodeURIComponent(business)
    + '&fields=' + encodeURIComponent(JSON.stringify(fields))
    + '&start_date=' + range.since
    + '&end_date=' + range.until;

  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {'Access-Token': token},
    muteHttpExceptions: true
  });

  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) { /* 本文が壊れている */ }

  if (res.getResponseCode() !== 200 || Number(body.code) !== 0) {
    throw new Error(tkErrorMessage_(res.getResponseCode(), body));
  }

  var data = body.data || {};
  var flat = {};
  Object.keys(data).forEach(function (k) { flat[k] = data[k]; });
  Object.keys(data.metrics || {}).forEach(function (k) { flat[k] = data.metrics[k]; });

  var out = {};
  TIKTOK_API_FIELDS.forEach(function (f) {
    var n = tkNumber_(flat[f.api]);
    if (n !== null) { out[f.key] = n; }
  });
  return Object.keys(out).length ? out : null;
}

/** いまのフォロワー数。過去にはさかのぼれない。 */
function tkFollowers_(token, business) {
  try {
    var res = UrlFetchApp.fetch(TIKTOK_API
      + '?business_id=' + encodeURIComponent(business)
      + '&fields=' + encodeURIComponent(JSON.stringify(['followers_count'])),
      {method: 'get', headers: {'Access-Token': token}, muteHttpExceptions: true});
    var body = JSON.parse(res.getContentText());
    return tkNumber_((body.data || {}).followers_count);
  } catch (e) {
    Logger.log('TikTokのフォロワー数を取れませんでした: ' + e.message);
    return null;
  }
}

/** TikTokのエラーを、次に何をすればいいか分かる文にする。 */
function tkErrorMessage_(code, body) {
  var message = body.message || ('HTTP ' + code);
  if (/token/i.test(message)) {
    return 'トークンが無効か期限切れです（' + message + '）\n'
         + 'TikTok for Developers で発行し直してください。';
  }
  if (/permission|scope|auth/i.test(message)) {
    return '権限が足りません（' + message + '）\n'
         + 'アプリの審査で Business Account API が承認されているか確認してください。';
  }
  return message;
}
