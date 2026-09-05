# SUS — แบบประเมินการใช้งานระบบ (Thai administration)

Instrument: **System Usability Scale**, Brooke (1996). 10 items, alternating
polarity, 1–5 Likert. Administered in Thai; the English original is kept beside
each item so a reader can check the translation. The result is reported as
**"SUS (Thai administration)"** — a translated SUS is not the validated English
instrument, and the chapter says so.

**Hand this to the participant after T5 and before the debrief.**

---

## คำชี้แจง

กรุณาให้คะแนนความรู้สึกของคุณที่มีต่อระบบที่เพิ่งใช้ไป โดยเลือกตัวเลข 1–5

**1 = ไม่เห็นด้วยอย่างยิ่ง … 5 = เห็นด้วยอย่างยิ่ง**

ตอบตามความรู้สึกแรกได้เลย ไม่มีข้อถูกข้อผิด และถ้าข้อไหนตัดสินใจไม่ได้จริง ๆ
ให้เลือก 3 ครับ

| # | ข้อความ | English original | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|---|---|
| 1 | ฉันคิดว่าฉันอยากจะใช้ระบบนี้บ่อย ๆ | I think that I would like to use this system frequently. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 2 | ฉันรู้สึกว่าระบบนี้ซับซ้อนเกินความจำเป็น | I found the system unnecessarily complex. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 3 | ฉันรู้สึกว่าระบบนี้ใช้งานง่าย | I thought the system was easy to use. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 4 | ฉันคิดว่าฉันต้องมีคนที่เชี่ยวชาญด้านเทคนิคคอยช่วย ถึงจะใช้ระบบนี้ได้ | I think that I would need the support of a technical person to be able to use this system. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 5 | ฉันรู้สึกว่าฟังก์ชันต่าง ๆ ในระบบนี้เชื่อมโยงเข้ากันได้ดี | I found the various functions in this system were well integrated. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 6 | ฉันรู้สึกว่าระบบนี้มีความไม่สอดคล้องกันอยู่มาก | I thought there was too much inconsistency in this system. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 7 | ฉันคิดว่าคนส่วนใหญ่จะเรียนรู้การใช้ระบบนี้ได้เร็วมาก | I would imagine that most people would learn to use this system very quickly. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 8 | ฉันรู้สึกว่าระบบนี้ใช้งานยุ่งยากมาก | I found the system very cumbersome to use. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 9 | ฉันรู้สึกมั่นใจเวลาใช้ระบบนี้ | I felt very confident using the system. | ☐ | ☐ | ☐ | ☐ | ☐ |
| 10 | ฉันต้องเรียนรู้อะไรหลายอย่างก่อน ถึงจะเริ่มใช้ระบบนี้ได้ | I needed to learn a lot of things before I could get going with this system. | ☐ | ☐ | ☐ | ☐ | ☐ |

**ทุกข้อต้องมีคำตอบ** — ข้อที่เว้นว่างทำให้คะแนน SUS ของคนนั้นใช้ไม่ได้ทั้งชุด
ตรวจก่อนที่ผู้เข้าร่วมจะลุกจากที่นั่ง

---

## Scoring

Store the **raw 1–5 responses** in the participant file, never the converted
values — the conversion must stay reproducible from raw data.

1. Odd items (1, 3, 5, 7, 9): contribution = `response − 1`
2. Even items (2, 4, 6, 8, 10): contribution = `5 − response`
3. `SUS = (sum of the 10 contributions) × 2.5` → 0–100

Each item contributes 0–4, so the sum is 0–40 and the score is a multiple of
2.5. **A SUS score is not a percentage** and must not be written with a `%`.

### Threshold

**≥ 68** — pre-registered, Class 1 (proposal §1.3). 68 is the *mean* of a large
SUS corpus (Sauro & Lewis 2016; Bangor, Kortum & Miller 2008), i.e. "average",
not "good". Say that in the chapter so the bar is not oversold.

### Adjective anchors (Bangor et al., 2008) — report, do not grade on

| Adjective | Mean SUS in the corpus |
|---|---|
| Worst imaginable | 12.5 |
| Awful | 20.3 |
| Poor | 35.7 |
| OK | 50.9 |
| Good | 71.4 |
| Excellent | 85.5 |
| Best imaginable | 90.9 |

Report the adjective nearest the study mean, and say it is an anchor from that
corpus rather than a grade boundary invented here.
