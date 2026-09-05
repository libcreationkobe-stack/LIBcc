/**
 * Meta広告の数字を「広告」タブへ自動で取り込む。
 *
 * 転記していたのは 消化金額・インプレッション・リーチ・リンククリック の4つ。
 * ここが毎月いちばん手間で、いちばん写し間違えやすい。
 *
 * 事前準備:
 *   1. Metaのビジネス設定でシステムユーザーを作り、ads_read 権限のトークンを発行する
 *   2. Apps Script の「プロジェクトの設定」→「スクリプト プロパティ」に
 *      META_ACCESS_TOKEN = そのトークン
 *      （メニューの「APIキー・トークンを設定する」からでも入れられる）
 *   3. 「広告」タブ2行目に広告アカウントID、5行目に集計の開始年月を入れる
 *
 * トークンはスクリプトプロパティにだけ置く。セルにも書かないし、ログにも出さない。
 */

var META_TOKEN_PROP = 'META_ACCESS_TOKEN';

/**
 * Graph APIのバージョン。Metaは約2年で古い版を止めるので、
 * 「サポートされていないバージョン」と言われたらここを上げる。
 * エラー本文にMetaが有効な版を書いてくるので、それに合わせればよい。
 */
var META_API_VERSION = 'v23.0';

/** 取りに行く指標と、広告タブのどの列に入れるか。 */
var META_FIELDS = [
  {api: 'spend',              key: '広告費'},
  {api: 'impressions',        key: 'インプレッション'},
  {api: 'reach',              key: 'リーチ'},
  {api: 'inline_link_clicks', key: 'クリック'}
];

/* ---------------- 入口 ---------------- */

/** メニューから実行する。今日までの月をまとめて取り込む。 */
function importMetaAds() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(AD_SHEET_NAME);
  if (!sheet) {
    throw new Error('「' + AD_SHEET_NAME + '」タブがありません。先に「シートを整える」を実行してください。');
  }

  var token = metaToken_();
  var accountId = metaAccountId_(sheet);
  var start = metaStartMonth_(sheet);
  var campaign = metaCampaignFilter_(sheet);
  var platformIndex = PAID_CHANNELS.indexOf('Meta広告');
  if (platformIndex < 0) { throw new Error('PAID_CHANNELS に Meta広告 がありません。'); }

  var today = new Date();
  var wrote = [];
  var skipped = [];
  var failed = [];

  for (var i = 0; i < MONTHS.length; i++) {
    var span = metaMonthSpan_(start, i);
    if (span.first > today) { break; }        // 未来の月は取りに行かない

    var row;
    try {
      row = metaFetchInsights_(token, accountId, span, campaign);
    } catch (e) {
      failed.push(MONTHS[i] + '：' + e.message);
      continue;
    }

    if (!row) { skipped.push(MONTHS[i]); continue; }

    var target = adRow_(i, platformIndex);
    META_FIELDS.forEach(function (f) {
      if (typeof row[f.key] !== 'number') { return; }
      sheet.getRange(adCol_(f.key) + target).setValue(row[f.key]);
    });
    wrote.push(MONTHS[i]);
  }

  var lines = [];
  if (wrote.length) { lines.push('取り込んだ月：' + wrote.join('・')); }
  if (skipped.length) { lines.push('配信の記録が無かった月：' + skipped.join('・')); }
  if (failed.length) { lines.push('取れなかった月：\n' + failed.join('\n')); }
  if (!lines.length) { lines.push('取り込む月がありませんでした。開始年月を確認してください。'); }

  var message = lines.join('\n');
  Logger.log(message);
  metaNotify_('Meta広告の取り込み', message);
}

/** 設定が通っているかだけを確かめる。数字は書き込まない。 */
function checkMetaSettings() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(AD_SHEET_NAME);
  var lines = [];

  var token = PropertiesService.getScriptProperties().getProperty(META_TOKEN_PROP);
  lines.push('トークン：' + (token ? '登録あり（' + metaMask_(token) + '）' : '未登録'));

  if (!sheet) {
    lines.push('広告タブ：ありません。先に「シートを整える」を実行してください。');
  } else {
    var id = String(sheet.getRange(AD_ACCOUNT_ROW, 3).getValue() || '').trim();
    var start = String(sheet.getRange(AD_START_ROW, 3).getValue() || '');
    lines.push('広告アカウントID：' + (id || '未入力'));
    lines.push('集計の開始年月：' + (start || '未入力'));
    var campaign = metaCampaignFilter_(sheet);
    lines.push('キャンペーンの絞り込み：'
      + (campaign.length ? campaign.join('と') + ' をすべて含むもの' : 'なし（アカウント全体）'));
  }

  if (token && sheet) {
    try {
      // 一番古い月を見に行くと、配信が後から始まった案件で必ず空になり、
      // 設定が悪いのか配信が無いだけなのか区別が付かない。直近の月で試す。
      var span = metaMonthSpan_(metaStartMonth_(sheet), metaLatestPastIndex_(sheet));
      var got = metaFetchInsights_(token, metaAccountId_(sheet), span,
                                  metaCampaignFilter_(sheet));
      lines.push('接続テスト：成功（' + span.since + '〜' + span.until + '）');
      lines.push(got ? '　消化金額 ¥' + Math.round(got['広告費'] || 0).toLocaleString()
                     : '　この月は、条件に合う配信がありません');
      if (!got) {
        lines.push('　（絞り込みの文字がキャンペーン名と違うか、この月に配信が無いかのどちらかです。'
          + '6行目を空にして試すと、アカウント全体に配信があるか分かります）');
      }
    } catch (e) {
      lines.push('接続テスト：失敗');
      lines.push('　' + e.message);
    }
  }

  var message = lines.join('\n');
  Logger.log(message);   // ダイアログは押されるまで止まるので、先にログへ残す
  metaNotify_('Meta広告の設定', message);
}

/**
 * APIキーとトークンをまとめて登録する。
 * アカウントごとにシートをコピーすると、スクリプトのプロパティは引き継がれない。
 * 設定画面を開かなくても入れ直せるようにしておく。
 */
function setApiKeys() {
  var ui = SpreadsheetApp.getUi();
  [{prop: 'ANTHROPIC_API_KEY', label: 'Anthropic の APIキー（総評とスライドに使います）'},
   {prop: META_TOKEN_PROP,     label: 'Meta のアクセストークン（広告の取り込みに使います）'}
  ].forEach(function (item) {
    var res = ui.prompt(item.label,
      '空のままOKを押すと、いまの設定をそのまま残します。', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) { return; }
    var value = res.getResponseText().trim();
    if (!value) { return; }
    PropertiesService.getScriptProperties().setProperty(item.prop, value);
  });
  SpreadsheetApp.getActive().toast('登録しました。値は画面にもセルにも残していません。');
}

/* ---------------- Meta API ---------------- */

function metaToken_() {
  var token = PropertiesService.getScriptProperties().getProperty(META_TOKEN_PROP);
  if (!token) {
    throw new Error(
      'Metaのアクセストークンが未設定です。\n'
      + 'メニュー「KPIシート」→「APIキー・トークンを設定する」から登録してください。');
  }
  return token;
}

function metaAccountId_(sheet) {
  var raw = String(sheet.getRange(AD_ACCOUNT_ROW, 3).getValue() || '').trim();
  if (!raw) {
    throw new Error('「' + AD_SHEET_NAME + '」タブの' + AD_ACCOUNT_ROW
      + '行目に、Meta広告アカウントIDを入れてください（例 act_1234567890 または 1234567890）。');
  }
  return raw.indexOf('act_') === 0 ? raw : 'act_' + raw.replace(/[^0-9]/g, '');
}

/**
 * 取り込むキャンペーンの絞り込み。空なら広告アカウント全体。
 *
 * 1つの広告アカウントで複数のクライアントと、集客広告・採用広告を
 * まとめて回していることがある。絞らないと全部が混ざるので、
 * スペースか読点で区切った言葉を「すべて含む」で絞れるようにする。
 * 例：「あおき屋 採用」→ 両方を含むキャンペーンだけ
 */
function metaCampaignFilter_(sheet) {
  var raw = String(sheet.getRange(AD_CAMPAIGN_ROW, 3).getValue() || '');
  return raw.split(/[\s、,]+/).filter(function (w) { return w !== ''; });
}

/** 集計の開始年月。入っていなければ今月から13ヶ月さかのぼった月にする。 */
function metaStartMonth_(sheet) {
  var raw = sheet.getRange(AD_START_ROW, 3).getValue();
  if (raw instanceof Date) { return new Date(raw.getFullYear(), raw.getMonth(), 1); }

  var text = String(raw || '').trim();
  var m = text.match(/(\d{4})\D+(\d{1,2})/);
  if (m) { return new Date(Number(m[1]), Number(m[2]) - 1, 1); }

  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - (MONTHS.length - 1), 1);
}

/** 今日までで一番新しい月が、開始年月から何ヶ月後か。 */
function metaLatestPastIndex_(sheet) {
  var start = metaStartMonth_(sheet);
  var today = new Date();
  for (var i = MONTHS.length - 1; i > 0; i--) {
    if (metaMonthSpan_(start, i).first <= today) { return i; }
  }
  return 0;
}

/** 開始年月からindexヶ月後の、月初と月末。 */
function metaMonthSpan_(start, index) {
  var first = new Date(start.getFullYear(), start.getMonth() + index, 1);
  var last = new Date(start.getFullYear(), start.getMonth() + index + 1, 0);
  return {first: first, last: last, since: metaDate_(first), until: metaDate_(last)};
}

function metaDate_(d) {
  return Utilities.formatDate(d, 'JST', 'yyyy-MM-dd');
}

/**
 * その期間の広告実績を取る。配信が無ければ null。
 * 数字は文字列で返ってくるので、ここで数値に直す。
 */
function metaFetchInsights_(token, accountId, span, campaign) {
  // level=account のまま絞り込むのが要点。level=campaign にして足し上げると、
  // リーチが重複したまま合算され、実際より多く出てしまう。
  var url = 'https://graph.facebook.com/' + META_API_VERSION + '/' + accountId + '/insights'
    + '?level=account'
    + '&fields=' + META_FIELDS.map(function (f) { return f.api; }).join(',')
    + '&time_range=' + encodeURIComponent(JSON.stringify({since: span.since, until: span.until}))
    + '&access_token=' + encodeURIComponent(token);

  if (campaign && campaign.length) {
    // 条件を並べるとANDになる。区切った言葉をすべて含むものだけが残る。
    url += '&filtering=' + encodeURIComponent(JSON.stringify(
      campaign.map(function (word) {
        return {field: 'campaign.name', operator: 'CONTAIN', value: word};
      })));
  }

  var res = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
  var code = res.getResponseCode();
  var body = res.getContentText();

  if (code !== 200) {
    throw new Error(metaErrorMessage_(code, body));
  }

  var data = JSON.parse(body).data;
  if (!data || !data.length) { return null; }

  var out = {};
  META_FIELDS.forEach(function (f) {
    var v = data[0][f.api];
    if (v === undefined || v === null || v === '') { return; }
    var n = Number(v);
    if (!isNaN(n)) { out[f.key] = n; }
  });
  return Object.keys(out).length ? out : null;
}

/** Metaのエラーを、次に何をすればいいか分かる文にする。 */
function metaErrorMessage_(code, body) {
  var error = {};
  try { error = (JSON.parse(body) || {}).error || {}; } catch (e) { /* 本文が壊れている */ }
  var message = error.message || body.slice(0, 300);

  if (error.code === 190) {
    var expired = /expired/i.test(message)
      ? 'トークンの期限が切れています。'
      : 'トークンが無効です。';
    return expired + '（' + message + '）\n'
         + 'ビジネス設定で「システムユーザー」を作り、有効期限を無期限にしてトークンを\n'
         + '発行し直してください。グラフAPIエクスプローラで出したトークンは数時間で切れます。';
  }
  if (error.code === 100 && /version/i.test(message)) {
    return 'APIのバージョンが古くなっています（' + message + '）\n'
         + 'MetaAdsImport.gs の META_API_VERSION を、上のメッセージにある版へ書き換えてください。';
  }
  if (error.code === 200 || error.code === 10 || error.code === 272) {
    return '権限が足りません（' + message + '）\n'
         + 'システムユーザーに ads_read を付け、広告アカウントへの割り当てを確認してください。';
  }
  return 'HTTP ' + code + '：' + message;
}

/** 先頭と末尾だけ見せる。トークンそのものはログにも画面にも出さない。 */
function metaMask_(token) {
  if (token.length < 14) { return '短すぎます'; }
  return token.slice(0, 8) + '…' + token.slice(-4) + '（' + token.length + '文字）';
}

/** エディタから実行したときはUIが無いので、その場合はログだけで済ませる。 */
function metaNotify_(title, message) {
  try {
    SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (e) {
    // UIが使えない文脈。ログには出してある。
  }
}
