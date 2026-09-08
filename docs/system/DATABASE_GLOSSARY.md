# DATABASE_GLOSSARY.md — Buzzly Customer Table Reference

> คู่มือแยกแยะตาราง Customer ในระบบ เพื่อป้องกันความสับสนระหว่าง developer

---

## ชัดเจนก่อน: "Customer" มีหลายความหมายในระบบนี้

| คำ | ความหมาย | ตาราง |
|---|---|---|
| **Buzzly Customer** | เจ้าของธุรกิจที่ใช้ Buzzly platform | `customer` |
| **End Consumer** | ลูกค้าของเจ้าของธุรกิจนั้น (ผู้ใช้ loyalty program) | `profile_customers` |
| **Customer Persona** | Persona สมมติที่ทีม marketing สร้างเพื่อวิเคราะห์ | `customer_personas` |

---

## Table Reference

### `customer`
- **ใคร**: Buzzly B2B subscriber — เจ้าของร้านที่สมัครใช้ Buzzly
- **สร้างเมื่อ**: signup trigger บน `auth.users`
- **Field สำคัญ**: `plan_type`, `company_name`, `loyalty_tier_id` (plan tier ของ Buzzly)
- **อย่าเอาไปปนกับ**: `profile_customers` (คนละ concept)

---

### `profile_customers`
- **ใคร**: End consumer ของร้านค้า — คนที่สะสมแต้ม, แลกของรางวัล
- **สร้างเมื่อ**: signup trigger บน `auth.users` (เดียวกัน)
- **Source of Truth สำหรับ**: Loyalty, Tiers, Rewards, Coupons
- **Join chain**: `profile_customers` → `loyalty_points` → `loyalty_tiers`
- **Hook**: `useProfileCustomer`, `useCustomerTiers`, `useCustomerRewards`

---

### `customer_personas`
- **ใคร**: Persona สมมติ ไม่ใช่ real user
- **ใช้ทำอะไร**: Campaign targeting, audience definition
- **Scoped ด้วย**: `team_id` (แต่ละ workspace มี personas ของตัวเอง)
- **Route**: `/personas` (เดิมคือ `/prospects`)
- **Hook**: `useCustomerPersonas`

---

### `customer_activities`
- **ใคร**: Log กิจกรรมของ `profile_customers`
- **ใช้ทำอะไร**: AARRR Funnel analysis, Customer Journey
- **Hook**: `useFunnelData`, `useAnalyticsData`, `useActivity`

---

### `customer_notifications`
- **ใคร**: การแจ้งเตือนที่ส่งไปหา end consumer
- **ใช้ทำอะไร**: แจ้งเตือน discount/coupon ใหม่
- **Hook**: `useCustomerCoupons`

---

### `customer_insights` ⚠️ LEGACY
- **Status**: ไม่ควรใช้งานเพิ่มเติม
- **ทับซ้อนกับ**: `profile_customers.salary_range`, `customer_personas.profession`
- **หากต้องการข้อมูลอาชีพ**: ใช้ `customer_personas` แทน

---

### `prospects` → `_deprecated_prospects` 🚫
- **Status**: Deprecated (renamed 2026-03-07)
- **Route เดิม**: `/prospects` → redirect ไปที่ `/personas`
- **อนาคต**: อาจ drop ได้ถ้าไม่มีข้อมูลสำคัญ

---

## Dependency Map

```
auth.users
  ├─ customer          (B2B Buzzly subscriber)
  └─ profile_customers (B2C end consumer)
       ├─ loyalty_points ─── loyalty_tiers
       ├─ customer_activities
       ├─ customer_notifications
       └─ customer_coupons ─── discounts

teams (workspaces)
  └─ customer_personas (marketing archetypes, scoped by team_id)
```
