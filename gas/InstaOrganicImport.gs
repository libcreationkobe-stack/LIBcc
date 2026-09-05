/**
 * Instagramのオーガニック実績を、月次KPIのInstagram行へ自動で取り込む。
 *
 * 取れるのは リーチ数・表示回数・プロフィール表示・フォロワー数 の4つ。
 * LINE友だち追加から下はAPIに無いので手入力のまま。
 *
 * 事前準備:
 *   1. Metaのアクセストークンに次の権限を足して発行し直す
 *      instagram_basic / instagram_manage_insights /
 *      pages_show_list / pages_read_engagement
 *      （ads_read も残しておけば、広告とオーガニックを1つのトークンで賄える）
 *   2. メニュー「APIキー・トークンを設定する」で登録
 *   3. メニュー「Instagramの数字を取り込む」を実行。
 *      初回だけ、どのInstagramアカウントかを選ぶ
 *
 * 選んだアカウントIDはスクリプトプロパティに持つ。
 * ファイルごとに別なので、クライアントごとにシートをコピーしても混ざらない。
 */

var IG_ACCOUNT_PROP = 'IG_ACCOUNT_ID';

/**
 * 日ごとの推移で取れる指標。period=day で日別に返るので、月ぶんを足す。
 */
var IG_DAILY_METRICS = [
  {api: 'reach',         key: 'リーチ数'},
  {api: 'profile_views', key: 'プロフィール表示'}
];

/**
 * 合計値でしか取れない指標。metric_type=total_value を付けないと弾かれる。
 * 表示回数（views）は日別では取れず、この形でしか返らない。
 * 保存とシェアは別々に返るので、足して「保存＋シェア」にする。
 */
var IG_TOTAL_METRICS = [
  {api: 'views',  key: '表示回数'},
  {api: 'saves',  key: '保存・シェア'},
  {api: 'shares', key: '保存・シェア'}
];

/* ---------------- 入口 ---------------- */

/** メニューから実行する。今日までの月をまとめて取り込む。 */
function importInstagramInsights() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var kpi = ss.getSheetByName(SHEET_NAME);
  if (!kpi) { throw new Error('「' + SHEET_NAME + '」タブがありません。'); }

  var channelIndex = CHANNELS.indexOf('Instagram');
  if (channelIndex < 0) { throw new Error('CHANNELS に Instagram がありません。'); }

  var token = metaToken_();
  var account = igAccount_(token);
  var start = igStartMonth_(ss);

  var today = new Date();
  var wrote = [];
  var empty = [];
  var failed = [];
  var latestRow = 0;

  for (var i = 0; i < MONTHS.length; i++) {
    var span = metaMonthSpan_(start, i);
    if (span.first > today) { break; }

    var got;
    try {
      got = igFetchMonth_(token, account.id, span);
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

  // フォロワー数は「いま何人か」しか取れない。過去の月には入れず、最後の月だけに入れる。
  var followers = igFollowers_(token, account.id);
  if (followers !== null && latestRow) {
    kpi.getRange(col_('フォロワー数') + latestRow).setValue(followers);
  }

  var lines = ['アカウント：@' + account.username];
  if (wrote.length) { lines.push('取り込んだ月：' + wrote.join('・')); }
  if (empty.length) { lines.push('記録が無かった月：' + empty.join('・')); }
  if (failed.length) { lines.push('取れなかった月：\n' + failed.join('\n')); }
  if (followers !== null) {
    lines.push('フォロワー数：' + followers.toLocaleString()
      + '人（今日の数字なので、一番新しい月にだけ入れています）');
  }
  lines.push('', 'LINE友だち追加から下は、APIに無いので手入力のままです。');

  var message = lines.join('\n');
  Logger.log(message);
  metaNotify_('Instagramの取り込み', message);
}

/** どのInstagramアカウントを見ているか確かめる。数字は書き込まない。 */
function checkInstagramSettings() {
  var lines = [];
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty(META_TOKEN_PROP);
  lines.push('トークン：' + (token ? '登録あり（' + metaMask_(token) + '）' : '未登録'));

  var saved = props.getProperty(IG_ACCOUNT_PROP);
  lines.push('Instagramアカウント：' + (saved ? saved : '未選択（取り込み時に選びます）'));

  if (token) {
    try {
      var list = igListAccounts_(token);
      lines.push('', '見えているアカウント：');
      list.forEach(function (a) { lines.push('　@' + a.username + '（' + a.page + '）'); });
      if (!list.length) {
        lines.push('　ありません。トークンに instagram_basic と pages_show_list が'
          + '入っているか確認してください。');
      }
    } catch (e) {
      lines.push('一覧の取得に失敗：' + e.message);
    }
  }

  var message = lines.join('\n');
  Logger.log(message);
  metaNotify_('Instagramの設定', message);
}

/** 別のInstagramアカウントに切り替える。 */
function resetInstagramAccount() {
  PropertiesService.getScriptProperties().deleteProperty(IG_ACCOUNT_PROP);
  SpreadsheetApp.getActive().toast('次の取り込みのときに、もう一度アカウントを選びます。');
}

/* ---------------- アカウントの解決 ---------------- */

/**
 * 使うInstagramアカウント。1つしか無ければ黙って決める。
 * 複数あるときだけ聞き、選んだものを覚える。
 */
function igAccount_(token) {
  var props = PropertiesService.getScriptProperties();
  var saved = props.getProperty(IG_ACCOUNT_PROP);
  var list = igListAccounts_(token);

  if (!list.length) {
    throw new Error(
      'Instagramのビジネスアカウントが見つかりません。\n'
      + 'トークンに instagram_basic / instagram_manage_insights / pages_show_list / '
      + 'pages_read_engagement が入っているか、\n'
      + 'InstagramがFacebookページに紐付いているかを確認してください。');
  }

  if (saved) {
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === saved) { return list[i]; }
    }
    // 覚えているIDが今のトークンで見えない。選び直す。
  }

  var chosen = list.length === 1 ? list[0] : igAskAccount_(list);
  props.setProperty(IG_ACCOUNT_PROP, chosen.id);
  return chosen;
}

/** 複数あるときに選んでもらう。 */
function igAskAccount_(list) {
  var ui;
  try {
    ui = SpreadsheetApp.getUi();
  } catch (e) {
    throw new Error('Instagramアカウントが複数あります。'
      + 'シートのメニューから実行して、どれを使うか選んでください。');
  }

  var menu = list.map(function (a, i) {
    return (i + 1) + '. @' + a.username + '（' + a.page + '）';
  }).join('\n');

  var res = ui.prompt('どのInstagramアカウントの数字を取り込みますか',
    menu + '\n\n番号を入れてください。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) {
    throw new Error('取り込みをやめました。');
  }

  var index = parseInt(res.getResponseText().trim(), 10) - 1;
  if (isNaN(index) || index < 0 || index >= list.length) {
    throw new Error('番号が正しくありません。1〜' + list.length + ' で入れてください。');
  }
  return list[index];
}

/** トークンで見えるページと、それに紐付いたInstagramアカウント。 */
function igListAccounts_(token) {
  // ページとInstagramの紐付きは2通りある。
  // instagram_business_account は新しい繋ぎ方、connected_instagram_account は古い繋ぎ方。
  // 片方しか見ないと、繋いでいるのに一覧に出てこないアカウントが出る。
  var url = igUrl_('me/accounts',
    {fields: 'name,instagram_business_account{id,username},connected_instagram_account{id,username}',
     limit: 100}, token);
  var data = igRequest_(url).data || [];

  var out = [];
  var seen = {};
  data.forEach(function (page) {
    [page.instagram_business_account, page.connected_instagram_account].forEach(function (ig) {
      if (!ig || !ig.id || seen[ig.id]) { return; }
      seen[ig.id] = true;
      out.push({id: ig.id, username: ig.username || ig.id, page: page.name});
    });
  });
  return out;
}

/* ---------------- 取得 ---------------- */

/**
 * その月の実績。取り方が違う2種類を、それぞれの形で聞きに行く。
 *
 * アカウントのインサイトは1回で30日ぶんまでしか返らないので、
 * 月を前半と後半に割って2回聞く。日別のほうは end_time の日付で
 * 重複を除いてから足す。
 *
 * どれか1つが取れなくても、取れた指標だけは書き込む。
 * Metaは版によって指標の扱いを変えるので、全部か無かにしない。
 */
function igFetchMonth_(token, accountId, span) {
  var windows = igWindows_(span);
  var out = {};

  var days = igDailySeries_(token, accountId, windows);
  IG_DAILY_METRICS.forEach(function (m) {
    var byDay = days[m.api];
    if (!byDay) { return; }
    var total = 0;
    Object.keys(byDay).forEach(function (d) { total += byDay[d]; });
    if (total > 0) { out[m.key] = total; }
  });

  var totals = igTotalValues_(token, accountId, windows);
  IG_TOTAL_METRICS.forEach(function (m) {
    var v = totals[m.api];
    if (typeof v !== 'number') { return; }
    // 保存とシェアは同じ列に足し込む。
    out[m.key] = (out[m.key] || 0) + v;
  });

  return Object.keys(out).length ? out : null;
}

/** 月を前半・後半に割る。1回で30日ぶんまでしか返らないため。 */
function igWindows_(span) {
  var y = span.first.getFullYear();
  var m = span.first.getMonth();
  return [
    {since: metaDate_(span.first), until: metaDate_(new Date(y, m, 15))},
    {since: metaDate_(new Date(y, m, 16)), until: span.until}
  ];
}

/** 日ごとに返る指標。指標名 → 日付 → 値。 */
function igDailySeries_(token, accountId, windows) {
  var seen = {};
  var metrics = IG_DAILY_METRICS.map(function (m) { return m.api; });

  windows.forEach(function (w) {
    var data = igTry_(function () {
      return igRequest_(igUrl_(accountId + '/insights',
        {metric: metrics.join(','), period: 'day', since: w.since, until: w.until}, token));
    });
    if (!data) { return; }

    (data.data || []).forEach(function (m) {
      seen[m.name] = seen[m.name] || {};
      (m.values || []).forEach(function (v) {
        var day = String(v.end_time || '').slice(0, 10);
        if (day) { seen[m.name][day] = Number(v.value) || 0; }
      });
    });
  });
  return seen;
}

/** 合計値でしか返らない指標。指標名 → その月の合計。 */
function igTotalValues_(token, accountId, windows) {
  var out = {};
  var metrics = [];
  IG_TOTAL_METRICS.forEach(function (m) {
    if (metrics.indexOf(m.api) < 0) { metrics.push(m.api); }
  });

  windows.forEach(function (w) {
    var data = igTry_(function () {
      return igRequest_(igUrl_(accountId + '/insights',
        {metric: metrics.join(','), period: 'day', metric_type: 'total_value',
         since: w.since, until: w.until}, token));
    });
    if (!data) { return; }

    (data.data || []).forEach(function (m) {
      var v = m.total_value && m.total_value.value;
      if (typeof v !== 'number') { return; }
      out[m.name] = (out[m.name] || 0) + v;
    });
  });
  return out;
}

/**
 * 取れなければ諦めて null。指標の扱いは版で変わるので、
 * 1つ落ちただけで月ごと失敗させない。理由はログに残す。
 */
function igTry_(fn) {
  try {
    return fn();
  } catch (e) {
    Logger.log('取得を1つ諦めました: ' + e.message);
    return null;
  }
}

/** いまのフォロワー数。過去にさかのぼっては取れない。 */
function igFollowers_(token, accountId) {
  try {
    var res = igRequest_(igUrl_(accountId, {fields: 'followers_count'}, token));
    return typeof res.followers_count === 'number' ? res.followers_count : null;
  } catch (e) {
    Logger.log('フォロワー数を取れませんでした: ' + e.message);
    return null;
  }
}

/* ---------------- 通信 ---------------- */

function igUrl_(path, params, token) {
  var query = Object.keys(params).map(function (k) {
    return k + '=' + encodeURIComponent(params[k]);
  });
  query.push('access_token=' + encodeURIComponent(token));
  return 'https://graph.facebook.com/' + META_API_VERSION + '/' + path + '?' + query.join('&');
}

/** 1回叩く。失敗したら、次に何をすればいいか分かる文にして投げる。 */
function igRequest_(url) {
  var res = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
  var code = res.getResponseCode();
  if (code === 200) { return JSON.parse(res.getContentText()); }
  throw new Error(metaErrorMessage_(code, res.getContentText()));
}

/** 集計の開始年月。広告タブの設定を使い回す。 */
function igStartMonth_(ss) {
  var ad = ss.getSheetByName(AD_SHEET_NAME);
  if (ad) { return metaStartMonth_(ad); }
  var now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - (MONTHS.length - 1), 1);
}
