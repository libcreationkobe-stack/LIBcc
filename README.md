# Googleビジネスプロフィール 投稿・写真 自動下書きツール（GAS）

スプレッドシートを管理画面にして、**Googleビジネスプロフィール（GBP）の「最新情報」投稿文と写真を自動で下書き準備**するための Google Apps Script プロジェクトです。

- リール動画 → **Notta(+Zapier)で文字起こし** → Claude で投稿文に要約（**パターンA**）
- 写真 + メモ → Claude で投稿文に整形（**パターンB**）
- 完成した投稿文はスプレッドシートに、写真は Drive の「投稿準備済」フォルダに集約

> ⚠️ **このツールは「下書き準備」までを自動化します。** GBP への最終投稿は人が確認してから行う運用です（GBP の Business Profile API は利用申請・審査が必要なため、まずは審査不要のこの形から始められます）。

あわせて、**月次請求書のPDF自動作成**も同じスプレッドシートから使えます（[`docs/INVOICE.md`](docs/INVOICE.md)）。

詳しい全体設計・運用フローは [`docs/SETUP.md`](docs/SETUP.md) を参照してください。

## できること

| 機能 | 内容 |
|------|------|
| 文字起こし | Notta(+Zapier) でリール動画を文字に変換 → 結果をシート/Driveで受け取り |
| 文章生成 | 文字起こし結果・メモ・写真情報から GBP 投稿文を Claude が作成 |
| 写真整理 | Drive / Dropbox から写真を取得し「投稿準備済」フォルダへ |
| 進捗管理 | スプレッドシートで `下書き作成中 → 確認待ち → 投稿済` を管理 |
| 請求書 | シートの内容から**毎月の請求書PDFを自動作成**し Drive に保存（[詳細](docs/INVOICE.md)） |

## 構成ファイル

```
gas/
  appsscript.json   … マニフェスト（権限スコープ）
  Config.gs         … 設定・APIキー（スクリプトプロパティ）
  Menu.gs           … スプレッドシートのカスタムメニュー
  Main.gs           … メイン処理（行を走査して下書きを作る）
  SheetService.gs   … シート読み書き
  DriveService.gs   … Google Drive のファイル取得・整理
  DropboxService.gs … Dropbox のファイル取得
  Transcribe.gs     … Nottaの文字起こし結果を受け取る（シートE列 / Driveの.txt）
  Claude.gs         … Claude API 呼び出し（投稿文生成）
  InvoiceConfig.gs  … 請求書の設定（自社情報・シート列・自動実行の時刻）
  Invoice.gs        … 請求書の作成処理（明細の集計 → PDF → Drive保存 → ログ）
  InvoiceTemplate.gs… 請求書のレイアウト（HTML→PDF）
  InvoiceTrigger.gs … 毎月の自動実行トリガー
docs/
  SETUP.md          … 導入手順・全体設計
  INVOICE.md        … 月次請求書の自動PDF作成の手順
```

## クイックスタート

1. [clasp](https://github.com/google/clasp) を使うか、Apps Script エディタに `gas/` の中身を貼り付け
2. スプレッドシートに「投稿管理」シートを用意（列は `docs/SETUP.md` 参照）
3. スクリプトプロパティに API キーを登録（`Config.gs` 参照）
4. シートのメニュー **［GBP自動化］→［下書きを作成］** を実行

## 月次請求書の自動PDF作成

「請求先マスタ」「請求明細」の2シートに情報を入れておくと、毎月きまった日に請求書PDFを自動作成して Drive に保存します。

1. メニュー **［請求書］→［シートを準備する］**（3シートが作られます）
2. `gas/InvoiceConfig.gs` の `ISSUER` に自社情報・登録番号・振込先を入力
3. 「請求先マスタ」に請求先、「請求明細」に対象年月・品目・単価を入力
4. メニュー **［請求書］→［請求書PDFを作成（前月ぶん）］** で試し、問題なければ **［毎月の自動作成をONにする］**

- 税率ごとの区分・消費税額・登録番号を記載した、適格請求書（インボイス）の形式です
- 発行済みは「請求書ログ」を見てスキップするので、二重発行しません
- 任意でPDFを添付したGmailの**下書き**まで作成できます（自動送信はしません）

詳しくは [`docs/INVOICE.md`](docs/INVOICE.md) を参照してください。
