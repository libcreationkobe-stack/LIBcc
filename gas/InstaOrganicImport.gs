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
 * 取りに行く指標と、KPIシートのどの列に入れるか。
 *
 * アカウントのインサイトは、いまはどれも metric_type=total_value でしか返らない。
 * period=day の日別で聞くと「total_value を付けろ」と弾かれる。
 *
 * 合計値で取るほうが正確でもある。日別のリーチを足し上げると、
 * 複数の日に見た人を二重に数えてしまうため。
 */
var IG_METRICS = [
  {api: 'reach',         key: 'リーチ数'},
  {api: 'views',         key: '表示回数'},
  {api: 'profile_views', key: 'プロフィール表示'},
  {api: 'saves',         key: '保存・シェア'},
  {api: 'shares',        key: '保存・シェア'}   // 保存とシェアは足して1列に入れる
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
      list.forEach(function (a) {
        lines.push('　@' + a.username + '（' + a.page + '）');
        lines.push('　　' + a.id);
      });
      lines.push('', '※ ここに出ないアカウントは、メニューの'
        + '「InstagramアカウントIDを直接入れる」で指定できます。');
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
  SpreadsheetApp.getActive().toast(
    '次に「Instagramの数字を取り込む」を実行したとき、どのアカウントか聞き直します。');
}

/**
 * IDの一覧を貼ると、どれがどのアカウントかを名前で返す。
 *
 * me/accounts に出てこないアカウントでも、IDさえ分かれば名前は引ける。
 * アクセストークンデバッガーの instagram_basic に並んでいる番号を
 * そのまま貼れるよう、区切り文字は何でも受ける。
 */
function listInstagramNames() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('IDから名前を調べる',
    'アクセストークンデバッガーの instagram_basic に並んでいる番号を、'
    + 'まとめて貼り付けてください（改行でも読点でもOK）。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) { return; }

  var ids = res.getResponseText().split(/[^0-9]+/).filter(function (v) { return v.length > 5; });
  if (!ids.length) { return; }

  var token = metaToken_();
  var lines = [];
  ids.forEach(function (id) {
    var name = igTry_(function () {
      return igRequest_(igUrl_(id, {fields: 'username,name'}, token));
    });
    lines.push(name && name.username
      ? '@' + name.username + '　' + (name.name || '') + '\n　' + id
      : '（読めませんでした）\n　' + id);
  });

  var message = ids.length + '件のうち、名前が引けたものです。\n\n' + lines.join('\n');
  Logger.log(message);   // 多いときはログからコピーできる
  metaNotify_('Instagramアカウントの一覧', message);
}

/**
 * InstagramアカウントIDを手で入れる。
 *
 * ページとの繋ぎ方によっては、権限があるのに一覧へ出てこないアカウントがある。
 * その場合の逃げ道。IDが正しいかどうかは、ユーザー名を引いて確かめる。
 */
function setInstagramAccountId() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('InstagramアカウントIDを直接入れる',
    'アクセストークンデバッガーの instagram_basic の欄に並んでいる、'
    + '17841… で始まる番号です。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) { return; }

  var id = res.getResponseText().replace(/[^0-9]/g, '');
  if (!id) { return; }

  var token = metaToken_();
  var name;
  try {
    name = igRequest_(igUrl_(id, {fields: 'username'}, token)).username;
  } catch (e) {
    ui.alert('そのIDでは読めませんでした', e.message + '\n\nIDを確かめてください。',
      ui.ButtonSet.OK);
    return;
  }

  PropertiesService.getScriptProperties().setProperty(IG_ACCOUNT_PROP, id);
  ui.alert('設定しました', '@' + (name || id) + ' の数字を取り込みます。', ui.ButtonSet.OK);
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

  // 手でIDを入れた場合、一覧に出てこなくてもそのまま使う。
  if (saved) {
    var known = false;
    list.forEach(function (a) { if (a.id === saved) { known = true; } });
    if (!known) {
      try {
        var name = igRequest_(igUrl_(saved, {fields: 'username'}, token)).username;
        return {id: saved, username: name || saved, page: '（IDを直接指定）'};
      } catch (e) {
        // 読めないIDなら、覚えているものを捨てて選び直す。
        props.deleteProperty(IG_ACCOUNT_PROP);
        saved = null;
      }
    }
  }

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

/**
 * トークンで見えるInstagramアカウントを、集められる限り集める。
 *
 * me/accounts は「自分がページの管理者として直接入っているページ」しか返さない。
 * ビジネスポートフォリオ経由で預かっているクライアントのページはここに出ないので、
 * ビジネス配下のページも見に行く（business_management があるときだけ通る）。
 */
function igListAccounts_(token) {
  var out = [];
  var seen = {};

  var pageFields = 'name,instagram_business_account{id,username},'
                 + 'connected_instagram_account{id,username},instagram_accounts{id,username}';

  var collect = function (path) {
    var data = igTry_(function () {
      return igRequest_(igUrl_(path, {fields: pageFields, limit: 100}, token));
    });
    if (!data) { return; }

    (data.data || []).forEach(function (page) {
      igAddAccounts_(page, out, seen);
    });
  };

  // ① 自分が管理者として入っているページ
  collect('me/accounts');

  // ② ビジネスポートフォリオ配下のページ。
  //    owned_pages は自社所有、client_pages は クライアントから預かっているページ。
  var businesses = igTry_(function () {
    return igRequest_(igUrl_('me/businesses', {fields: 'name', limit: 100}, token));
  });
  if (businesses) {
    (businesses.data || []).forEach(function (biz) {
      collect(biz.id + '/owned_pages');
      collect(biz.id + '/client_pages');
    });
  }

  return out;
}

/** ページに紐付いたInstagramを、繋ぎ方3通りぶん拾う。 */
function igAddAccounts_(page, out, seen) {
  var add = function (ig) {
    if (!ig || !ig.id || seen[ig.id]) { return; }
    seen[ig.id] = true;
    out.push({id: ig.id, username: ig.username || ig.id, page: page.name || ''});
  };
  add(page.instagram_business_account);
  add(page.connected_instagram_account);
  ((page.instagram_accounts || {}).data || []).forEach(add);
}

/* ---------------- 取得 ---------------- */

/**
 * その月の実績。1回で30日ぶんまでしか返らないので、31日ある月だけ2回に分ける。
 *
 * 半月ずつに割ると、リーチの重複が2週間ぶん出てしまう。
 * 30日ぶんを1回で取り、はみ出す1日だけを別に聞くほうが、重複が最小になる。
 *
 * どれか1つ取れなくても、取れた指標だけ書き込む。
 * Metaは版によって指標の扱いを変えるので、全部か無かにしない。
 */
function igFetchMonth_(token, accountId, span) {
  var totals = {};

  igWindows_(span).forEach(function (w) {
    var data = igTry_(function () {
      return igRequest_(igUrl_(accountId + '/insights',
        {metric: igMetricNames_().join(','), period: 'day', metric_type: 'total_value',
         since: w.since, until: w.until}, token));
    });
    if (!data) { return; }

    (data.data || []).forEach(function (m) {
      var v = m.total_value && m.total_value.value;
      if (typeof v === 'number') { totals[m.name] = (totals[m.name] || 0) + v; }
    });
  });

  var out = {};
  IG_METRICS.forEach(function (m) {
    var v = totals[m.api];
    if (typeof v !== 'number') { return; }
    out[m.key] = (out[m.key] || 0) + v;
  });
  return Object.keys(out).length ? out : null;
}

/** 重複しない指標名。保存とシェアは同じ列だが、聞くときは別々。 */
function igMetricNames_() {
  var names = [];
  IG_METRICS.forEach(function (m) {
    if (names.indexOf(m.api) < 0) { names.push(m.api); }
  });
  return names;
}

/** 30日を超える月だけ2回に分ける。はみ出した日だけを別に聞く。 */
function igWindows_(span) {
  var days = Math.round((span.last - span.first) / 86400000) + 1;
  if (days <= 30) {
    return [{since: span.since, until: span.until}];
  }
  var y = span.first.getFullYear();
  var m = span.first.getMonth();
  return [
    {since: span.since, until: metaDate_(new Date(y, m, 30))},
    {since: metaDate_(new Date(y, m, 31)), until: span.until}
  ];
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
