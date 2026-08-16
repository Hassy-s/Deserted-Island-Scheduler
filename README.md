# 無人島工房スケジューラー

FINAL FANTASY XIV「無人島開拓」の開拓工房向けスケジュール作成ツールです。

## 主な機能

- 開拓ランク・工房数・ランドマーク数に対応
- 使いたくない島産品の除外
- 「ねこみみさんのおねがい」の指定と必要完成数の達成
- あわせて生産・工房のやる気を考慮
- 5日間の素材使用量を分散する標準検索
- 素材負担を無視した最高効率検索
- 採集 / 作物 / 飼育動物 / グラナリー素材ごとの使用目安設定
- 今週分を確定して素材使用履歴を保存
- 設定・履歴はブラウザの localStorage に保存

## 注意

ゲーム内の需要・人気度は考慮せず、島産品の基本価値と週間の素材負担をもとに計算します。

## GitHub Pages で公開する

1. このフォルダの中身を GitHub リポジトリのルートへアップロードします。
2. GitHub のリポジトリで **Settings → Pages** を開きます。
3. **Build and deployment** の Source を **Deploy from a branch** にします。
4. Branch を **main / (root)** にして **Save** します。
5. 数分後、GitHub Pages のURLから利用できます。

## ファイル構成

```text
island-workshop-scheduler/
├─ index.html
├─ css/
│  └─ style.css
├─ js/
│  ├─ data.js
│  └─ app.js
└─ README.md
```

## ローカル利用

`index.html` をブラウザで開くだけでも利用できます。
