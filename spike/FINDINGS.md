# Spike: Landed Rate fizibilitesi

**Tarih:** 2026-10-01
**Soru:** Ajanların dosya düzenlemelerini git geçmişiyle güvenilir şekilde eşleştirip "işin koda girip girmediğini" söyleyebilir miyiz?
**Cevap:** Evet. Yöntem 5.4 GB yerel geçmiş üzerinde yaklaşık 25 saniyede çalışıyor ve yanlış pozitif oranı düşük.

## Veri

| Kaynak | Dosya | Düzenleme (anlamlı satır içeren) | Git reposunda |
|---|---|---|---|
| Claude Code transcript'leri (`~/.claude/projects`) | 143 jsonl + subagent | 928 | 763 |
| Codex rollout'ları (`~/.codex/sessions`) | 996 jsonl | 9.189 | 8.123 |

- Claude: `toolUseResult.structuredPatch` (Edit/Write). Tekilleştirme `tool_use_id` ile yapıldı.
- Codex: `item_completed` → `FileChange.changes[path].unified_diff`. Eski dosyalarda `apply_patch` girdisi kullanıldı. Aynı oturumda aynı patch tekrar gelirse tekilleştirildi.
- Düzenlemelerin %12'si (1.214 adet) artık var olmayan worktree'lerde ya da repo dışı dizinlerde. Bunlar **unknown** olarak sayıldı.

## Yöntem

1. Her düzenlemeden eklenen satırlar alınır. Whitespace normalize edilir, 8 karakterden kısa ya da yalnızca noktalama içeren satırlar atılır, aynı hunk içinde yeri değişen satırlar çıkarılır.
2. Her repo için `git log --all -p -U0` çalıştırılır. Yalnızca ajanların dokunduğu dosyalar indekslenir: satır → (commit zamanı, sha).
3. Sınıflandırma:
   - **landed:** Satırların en az %50'si, düzenlemeden sonra (120 sn tolerans) aynı dosyaya yapılan bir commit'te var.
   - **uncommitted:** Commit'te yok, ama satırların en az %50'si şu anki working tree'de duruyor.
   - **partial:** Kısmi eşleşme.
   - **lost:** Hiçbir yerde yok.
4. Ölçüm iki seviyede yapıldı: tek tek düzenleme, ve oturum × dosya bazında net sonuç (oturum içinde sonradan silinen ara satırlar düşülür).

## Doğruluk kontrolleri

| Kontrol | Claude | Codex | Anlamı |
|---|---|---|---|
| A: Aynı dosya, **düzenlemeden önceki** commit'ler | 2.4% | 4.8% | Satır zaten vardı ya da tesadüfen eşleşti. Yanlış pozitif için üst sınır. |
| B: **Rastgele başka bir dosya**, düzenlemeden sonraki commit'ler | 0.1% | 0.1% | Genel ya da tesadüfi satır eşleşmesi |
| Landed sayılanlarda tam eşleşme (fa = 1.0) | 93% | 80% | Eşleşmelerin çoğu belirsiz değil, net |

Manuel örneklem (lost: 8, landed: 6, partial: 4) tutarlı çıktı:
- Lost örnekleri: silinmiş `.tmp.spec.ts` dosyası, sonradan yeniden yazılmış evidence dokümanları, sonradan değişmiş içerik.
- Landed örnekleri: ilgili commit mesajlarıyla birebir uyumlu.

## Sonuçlar (oturum × dosya, net)

| Ajan | n | landed | uncommitted | partial | lost |
|---|---|---|---|---|---|
| Claude | 328 | 47% | 51% | 1% | 2% |
| Codex | 2.957 | 93% | 3% | 1% | 3% |

- Commit gecikmesi: medyan 0.8 saat, p90 24 saat.
- Hayatta kalma: landed düzenlemelerin yaklaşık %86'sı bugün hâlâ working tree'de. Kalan yaklaşık %14 sonradan değişmiş ya da silinmiş (churn).
- Codex'in oturum × dosya çıktılarının **%31'i doküman ya da evidence dosyası** (913 / 2.957). Bu bir "ajan overhead" sinyali.

## Senin verinden çıkan "açık uç" örneği

`~/Desktop/mobile-app`: Claude'un bu repodaki 174 oturum × dosya çıktısının %94'ü hiç commit edilmemiş. Repoda toplam 7 commit var ve sonuncusu 2025-11-17 tarihli. Working tree'de commit edilmemiş 5.883 yol duruyor. Ürünün "Açık uçlar" özelliğinin göstermesi gereken şey tam olarak bu.

## Önemli uyarılar

- **Ajan karşılaştırması bu veriyle yapılamaz.** Claude ile Codex arasındaki fark büyük ölçüde repo ve iş akışı farkından geliyor: Claude'un verisinin çoğu commit'lenmemiş mobile-app reposundan. Üründe "hangi ajan daha iyi" türü bir karşılaştırma ancak aynı repo ve aynı iş türü için kontrollü yapılmalı. Yoksa yanıltıcı olur.
- Shell komutuyla yapılan değişiklikler (sed, codegen, formatter) ajan patch'lerinde görünmüyor.
- Commit'i kimin attığı (ajan mı insan mı) ayrıştırılmadı. Kaba bir sayımla eşleşen commit'lerin yaklaşık %14'ünde ajan izi var.
- Formatter tarafından değiştirilen satırlar (örneğin tırnak stili) lost ya da partial görünebilir. Bu veride partial yalnızca %1–2.
- Silinmiş worktree'lerdeki %12'lik kısım, branch'leri hâlâ duruyorsa ana repo üzerinden eşleştirilebilir. Bu iş yapılmadı.

## Ürün açısından çıkarımlar

1. Teknik temel sağlam: config değişikliği gerektirmeden, geçmiş veriyle dakikalar içinde sonuç üretiliyor.
2. Tek bir "landed rate" yüzdesi disiplinli bir iş akışında doyuyor (Codex'te %93). **Asıl değer uç durumlarda:** açık uçlar (uncommitted), kaybolan iş (lost), churn ve overhead. Kahraman metrik tek bir oran olmamalı. Bir **sonuç dağılımı** olmalı, yanına bir **açık uçlar listesi**.
3. Ajan karşılaştırması ancak repo ve iş türüne göre kontrollü yapılırsa güvenilir olur. Bu, PRD'deki "no fake precision" ilkesiyle de uyumlu.

## Dosyalar

- `extract.py`: transcript ve rollout dosyalarından düzenlemeleri çıkarır → `edits.jsonl`
- `match.py`: git eşleştirmesi ve rapor → `results.json`
- `validate.py`: negatif kontroller
