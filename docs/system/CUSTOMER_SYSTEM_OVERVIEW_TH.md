# ภาพรวมระบบฝั่ง Customer (Unified System Overview) - Extreme Detail Edition

เอกสารฉบับนี้รวบรวมรายละเอียดเชิงลึกระดับเทคนิค (Technical Spec) ของโครงสร้างฐานข้อมูล, ตรรกะ Backend, และการทำงานของ Hooks ทั้งหมดในฝั่งระบบ Customer ของ BuzzlyDev โดยมุ่งเน้นความละเอียดสูงสุดในทุกโมดูล

---

## 1. หน้า Dashboard หลัก (/dashboard)
ศูนย์กลางการประมวลผลข้อมูลประสิทธิภาพ (Performance Center) และระบบ Onboarding Guard อัจฉริยะ

### **1. Database Schema & Relations**
- **`public.ad_insights`**: (Raw Metrics)
    - `id`: `UUID` | `date`: `DATE` | `impressions`: `INTEGER`
    - `clicks`: `INTEGER` | `spend`: `NUMERIC(15,2)` | `conversions`: `INTEGER`
- **`public.revenue_metrics`**: (Business Reality)
    - `team_id`: `UUID` (FK -> `workspaces.id`)
    - `gross_revenue`, `net_revenue`, `profit`: `NUMERIC(15,2)`
    - `total_orders`, `new_customers`: `INTEGER`
    - `metric_date`: `DATE`
- **`public.ad_accounts`**: (Source Mapping)
    - `team_id`: `UUID` | `platform_id`: `UUID` | `is_active`: `BOOLEAN`

### **2. Backend Services & RPC/APIs**
- **RPC `get_workspace_performance`**: (Legacy/Standard)
    - **Input**: `p_workspace_id`, `p_start_date`, `p_end_date`
    - **Output**: JSON สรุปรายวันที่มีประสิทธิภาพสูง (Indexed Query)
- **Data Pipeline (Sync Engine)**: 
    - อัปเดตข้อมูล `ad_insights` จากแพลตฟอร์มภายนอก (Real-time Webhooks & Periodic Sync)
- **Revenue Estimation Logic**:
    - ระบบจะประมวลผลข้อมูลจาก `revenue_metrics` ล่าสุดเสมอ แต่หากไม่มีข้อมูล จะทำการคำนวณแบบ **Derived Revenue** อัตโนมัติจาก Ad Data

### **3. Frontend Hooks & State Management**
- **`useDashboardMetrics`**: 
    - จัดการตรรกะ **Date Range Parsing** (7d, 30d, 90d, Custom) เพื่อแปลงเป็น ISO Date
    - ทำหน้าที่ **Aggregation** ในระดับ Client-side (Sum/Avg) เพื่อลดภาระการประมวลผลของฐานข้อมูล
- **`useRevenueMetrics`**: 
    - สนับสนุนตรรกะ **Automatic Source Switching**: หาก `revenue_metrics` ส่งค่า `null` กลับมา Hook จะสลับไปใช้ **Derived Logic** ทันที
- **Caching Strategy**: ใช้ TanStack Query (React Query) โดยมี `queryKey` ที่ประกอบด้วย `dateRange`, `platformId` และ `workspaceId`

### **4. Business Logic, Constraints & Edge Cases**
- **Derived Revenue Formula**: 
    - `Estimated Gross = Total Spend * Avg ROAS`
    - `Estimated Net = Estimated Gross * 0.85` (หักค่าธรรมเนียม standard 15%)
    - `New Customers = Total Conversions * 0.6` (ค่าคงที่ประมาณการ 60%)
- **Onboarding Guard Layer**: 
    - ระบบจะตรวจสอบ `workspaces.status` และ `ad_accounts.is_active` หากไม่ผ่านเงื่อนไข ระบบจะบังคับ Redirect ไปที่หน้า Onboarding หรือแสดง Alert Banner เพื่อป้องกัน Data Missing Error
- **Arithmetic Safety**: ใช้ฟังก์ชัน `safe(n)` เพื่อตรวจสอบ `Number.isFinite(n)` ก่อนแสดงผลบน UI ป้องกันค่า `NaN` หรือ `Infinity` (Division by zero)

---

## 2. ระบบ Social Planner (/social/planner)
ระบบวางแผนคอนเทนต์และปฏิทินอัจฉริยะแบบ Extreme Technical Blueprint จัดการทั้ง Organic และ Paid Ads แบบไร้รอยต่อ

### **1. Database Schema & Relations**
- **`public.social_posts`**: ตารางศูนย์กลางสำหรับคอนเทนต์
    - `id`: `UUID` (Primary Key) | `team_id`: `UUID` (FK -> `workspaces.id`)
    - `platform_id`: `UUID` (FK -> `platforms.id`)
    - `post_channel`: `VARCHAR(50)` ('social' = โพสต์ทั่วไป, 'ad' = ใช้เป็นโฆษณา)
    - `post_type`: `VARCHAR(50)` ('image', 'video', 'text', 'carousel')
    - `content`: `TEXT` | `media_urls`: `TEXT[]` (Array of Cloud Storage URLs)
    - `status`: `VARCHAR(50)` (Draft, Scheduled, Published, Failed)
    - `scheduled_at`, `published_at`: `TIMESTAMPTZ`
    - `platform_post_id`: `VARCHAR(255)` (ID อ้างอิงจากโซเชียลจริง)
- **`public.post_personas`**: (Junction Table)
    - `post_id` (FK -> `social_posts`) | `persona_id` (FK -> `customer_personas`)
- **`public.ads`**: รายละเอียดโฆษณาที่ผูกกับโพสต์
    - `ad_group_id` (FK -> `ad_groups`) | `headline`, `ad_copy`, `budget` (NUMERIC)

### **2. Backend Services & RPC/APIs**
- **Supabase RPC `create_social_post`**:
    - **Input**: `PostData`, `PersonaIDs[]` 
    - **Output**: `PostRow`
    - **Logic**: ทำการ Insert ข้อมูลลง `social_posts` และสร้างความสัมพันธ์ใน `post_personas` พร้อมกันภายใน Single Transaction
- **Background Publishing Job**: 
    - วนลูปตรวจสอบโพสต์ที่ถึงเวลา `scheduled_at` ทุกนาที
    - เรียกใช้ Edge Function เพื่อยิง API ไปยัง Meta Graph API หรือ TikTok API ตาม `platform_id`
- **Webhook Status Sync**: รับ Callback จาก Social Platforms เพื่ออัปเดตสถานะโพสต์และเก็บ Error Log กรณีโพสต์ล้มเหลว

### **3. Frontend Hooks & State Management**
- **`useSocialPosts`**: 
    - จัดการ CRUD และสเตทข้อมูลโพสต์ (Loading, Error, Refetching)
    - ตรรกะการดึง `persona_names` มาฝังรวมกับข้อมูลโพสต์เพื่อแสดงผลใน UI
- **`useAds`**: 
    - ตรรกะ **"Ad Mirroring"**: เมื่อผู้ใช้แก้ไขข้อมูล Ad สเตทจะถูก Sync ไปยัง Social Post ที่เกี่ยวข้องอัตโนมัติ
- **`useUnifiedCalendar`**: จัดเก็บสเตทของปฏิทิน (Month/Week View) และการฟิลเตอร์ประเภทโพสต์

### **4. Business Logic, Constraints & Edge Cases**
- **Mirroring Logic**: เมื่อติ๊กสร้าง Ad จากโพสต์ ระบบจะ Clone ข้อมูลจาก Social ไปเป็น Ad และล็อกความสัมพันธ์ไว้เพื่อป้องกัน Data Inconsistency
- **Time Constraints**: ระบบไม่อนุญาตให้ Schedule โพสต์ที่เหลือน้อยกว่า 15 นาทีก่อนเผยแพร่ (Metal API Safety Margin)
- **Media Validation**: ตรวจสอบ Aspect Ratio และขนาดไฟล์ (เช่น TikTok Video ต้องไม่เกิน 50MB และต้องเป็นแนวตั้ง)

---

## 3. ระบบ Social Analytics (/social/analytics)
การประมวลผล Metrics และวิเคราะห์ประสิทธิภาพเชิงลึกระดับ Extreme Engineering

### **1. Database Schema & Relations**
- **`public.ad_insights`**: ข้อมูล Performance รายวัน
    - `ads_id`: `UUID` (FK -> `ads.id`) | `campaign_id`: `UUID` (FK)
    - `date`: `DATE` | `impressions`, `clicks`: `INTEGER`
    - `spend`: `NUMERIC(15,2)` | `revenue`: `NUMERIC(15,2)`
    - `ctr`, `cpc`, `cpm`, `roas`: (Stored/Calculated Metrics)
- **`public.platforms`**: (Lookup Table) เก็บชื่อ ไอคอน และ API Config
- **Metric Normalization**: ข้อมูลจาก `social_posts` (Organic) และ `ad_insights` (Paid) จะถูกนำมารวมกันผ่าน `platform_id`

### **2. Backend Services & RPC/APIs**
- **Data Ingestion Engine (Edge Function)**:
    - ดึงข้อมูลจาก Meta/Google/TikTok API ทุก 6 ชั่วโมง
    - ทำการ **Deduplication** ข้อมูลที่ซ้ำกัน และคำนวณ Metrics อัตโนมัติก่อนบันทึก
- **RPC `get_aggregated_performance`**:
    - **Input**: `team_id`, `start_date`, `end_date`, `platform_filter[]`
    - **Output**: JSON สรุปรายวันสำหรับพล็อตกราฟ (Impressions, Clicks, Conversion Rate)

### **3. Frontend Hooks & State Management**
- **`useSocialAnalyticsSummary`**: 
    - ทำหน้าที่ **"Data Normalizer"**: แปลงข้อมูลดิบจากหลาย API ที่มีชื่อฟิลด์ต่างกัน (เช่น `reach` ของ FB vs `views` ของ TikTok) ให้เป็น Format เดียวกัน
- **`useAdInsights`**: จัดการ Caching ข้อมูลประสิทธิภาพโฆษณาโดยใช้ React Query (Stale Time: 5 mins)
- **Context API (`AnalyticsContext`)**: เก็บ Global State ของ Date Range และ Platform Selection

### **4. Business Logic, Constraints & Edge Cases**
- **Arithmetic Safety**: อัลกอริทึมคำนวณ CTR/ROAS จะมี Guard เพื่อป้องกัน `Division by Zero` หาก `impressions` หรือ `spend` เป็น 0
- **Missing Data Fallback**: เมื่อดึง API ล้มเหลว ระบบจะแสดงข้อมูลล่าสุดจาก Cache พร้อม Badge แจ้งสถานะ "Offline Data"
- **Currency Conversion**: รองรับการแปลงสกุลเงิน (เช่น USD -> THB) อัตโนมัติผ่านอัตราแลกเปลี่ยนคงที่ในระบบ

---

## 4. ระบบ Social Inbox (/social/inbox)
ระบบจัดการการสนทนาและวิเคราะห์ความรู้สึก (Sentiment) ระดับ High-Fidelity

### **1. Database Schema & Relations**
- **`public.social_comments`**: ตารางหลักเก็บข้อความ
    - `id`: `UUID` | `post_id`: `UUID` (FK -> `social_posts.id`)
    - `author_name`: `VARCHAR(255)` | `author_avatar_url`: `TEXT`
    - `content`: `TEXT` | `sentiment`: `VARCHAR(20)` (Positive, Negative, Neutral)
    - `is_read`, `is_replied`: `BOOLEAN`
    - `reply_content`: `TEXT` | `replied_at`: `TIMESTAMPTZ`
    - `platform_comment_id`: `VARCHAR(255)` (Composite Unique Key ร่วมกับ `platform_id`)
- **`public.social_posts`**: ทำหน้าที่เป็น "Conversation Root" (Thread Starter)

### **2. Backend Services & RPC/APIs**
- **AI Sentiment Engine (ML Service)**: 
    - เมื่อ Webhook รับคอมเมนต์ใหม่ ระบบจะประมวลผล NLP เพื่อระบุอารมณ์ทันที
- **Real-time Gateway (Supabase Realtime)**:
    - ทำหน้าที่ Broadcaster ส่งข้อความใหม่ไปยังหน้า Inbox ของแอดมินโดยไม่ต้อง Refresh
- **Webhook Listener**: รับข้อมูล Comment แบบ Batch ประสิทธิภาพสูงเพื่อรองรับ Social Post ที่เป็น Viral (High Traffic)

### **3. Frontend Hooks & State Management**
- **`useSocialInbox`**: 
    - จัดการสเตทของ "Thread List" และการกรอง (Unread, Sentiment Filter)
- **`useSocialComments`**: 
    - จัดการตรรกะการตอบกลับแบบ Inline และสเตทการอัปเดตสถานะ "Read" ทันทีที่ผู้ใช้คลิกดู
- **State Management**: ใช้ `useReducer` ในการจัดการสเตทการเลือก Thread ที่ซับซ้อน

### **4. Business Logic, Constraints & Edge Cases**
- **Sentiment Overwrite**: แอดมินสามารถเปลี่ยนค่า Sentiment ที่ AI วิเคราะห์ผิดได้ โดยระบบจะเก็บ Log การแก้ไขไว้
- **Threading Logic**: คอมเมนต์ที่ตอบกลับกันบนแพลตฟอร์ม (Reply-to-Reply) จะถูกแบนราบ (Flatten) เข้าสู่ระดับเดียวกันในระบบ Buzzly แต่จัดลำดับตามเวลา
- **Crisis Notification**: ระบบจะส่ง Notification เฉพาะเมื่อพบคอมเมนต์ที่เป็น `Negative` เกิน 3 รายการใน 5 นาที (Spam/Crisis Alert)

---

## 5. ระบบ Customer Personas (/personas)
ระบบวิเคราะห์พฤติกรรมกลุ่มเป้าหมายเชิงลึก (Intelligence Persona Blueprint)

### **1. Database Schema & Relations**
- **`public.customer_personas`**: โปรไฟล์ข้อมูลลูกค้า
    - `id`: `UUID` | `team_id`: `UUID` (FK)
    - `persona_name`: `VARCHAR(255)` | `description`: `TEXT`
    - `age_min`, `age_max`: `INTEGER`
    - `interests`: `TEXT[]` | `pain_points`: `TEXT[]` | `goals`: `TEXT[]`
    - `custom_fields`: `JSONB` (Dynamic metadata เช่น ระดับ Loyalty)
- **`public.workspace_ad_persona`**: (Mock-to-Production Schema)
    - เก็บข้อมูล Hero Persona สำหรับทำ Ad Creation ตั้งต้น
- **`public.ad_personas` / `post_personas`**: เชื่อมต่อ Persona เข้ากับ Ads/Social Content

### **2. Backend Services & RPC/APIs**
- **AI Persona Generator (Edge Function)**:
    - วิเคราะห์ข้อมูลย้อนหลังจาก `ad_insights` เพื่อสรุปว่าพฤติกรรมลูกค้าจริงๆ (Actual Audience) เป็นอย่างไร เทียบกับ Target Persona
- **RPC `calculate_persona_performance`**:
    - **Input**: `persona_id`, `date_range`
    - **Output**: Success Score (สัดส่วนการมีส่วนร่วมเทียบกับงบประมาณที่ใช้)

### **3. Frontend Hooks & State Management**
- **`useAdPersonas`**: 
    - ดึงข้อมูล Audience จริงจาก Meta/Google มาทำการ **Aggregated Representation** เป็นตัวละคร Persona
- **`useCustomerPersonas`**: 
    - จัดการ CRUD และสเตทของ "Persona Gallery"
- **`useWorkspaceAdPersona`**: 
    - มีตรรกะ **Fallback to LocalStorage**: หากฐานข้อมูลมีปัญหา ระบบจะดึงข้อมูล Persona ตั้งต้นจากเครื่องผู้ใช้เพื่อให้ App ทำงานต่อได้

### **4. Business Logic, Constraints & Edge Cases**
- **Weighted Performance Scoring**: การคำนวณคะแนน Persona จะใช้หลักการถ่วงน้ำหนัก (60% Conversion, 40% Engagement)
- **Persona Accuracy Index**: แสดง "แถบความแม่นยำ" (Confidence Level) โดยอ้างอิงจากปริมาณ Data Points ที่ใช้ประมวลผล (ถ้าข้อมูลน้อย แถบจะเป็นสีเหลือง/แดง)
- **Data Privacy**: ไม่มีการเก็บข้อมูล PII (Personally Identifiable Information) ของลูกค้าจริงใน Persona แต่เก็บเป็น Aggregate Segment เสมอ

---

## 6. ระบบ Campaigns (/campaigns & /campaigns/:id)
การบริหารจัดการแคมเปญแบบมุ่งเน้นผลลัพธ์ (KPI-Driven) และระบบติดตามความคืบหน้าอัจฉริยะ

### **1. Database Schema & Relations**
- **`public.campaigns`**: ตารางหลักเก็บเป้าหมายและสถานะ
    - `id`: `UUID` | `team_id`: `UUID` (FK)
    - `name`: `VARCHAR` | `status`: `VARCHAR` (Active, Paused, Completed)
    - `start_date`, `end_date`: `TIMESTAMPTZ`
    - `target_kpi_metric`: `VARCHAR` (Clicks, Conversions, Spend, Impressions)
    - `target_kpi_value`: `NUMERIC`
- **`public.campaign_ads`**: (Junction Table)
    - `campaign_id` (FK -> `campaigns`) | `ad_id` (FK -> `ads`)
- **`public.campaign_tags`**: (Junction Table)
    - `campaign_id` (FK) | `tag_id` (FK -> `tags`)

### **2. Backend Services & RPC/APIs**
- **RPC `award_loyalty_points`**:
    - **Input**: `p_action_type` ('create_campaign')
    - **Logic**: ตรวจสอบว่าเป็นการสร้างแคมเปญแรกหรือไม่ หากใช่ ให้มอบคะแนนสะสม (Loyalty Points) ทันที
- **Audit Logs Service**:
    - ทุกกิจกรรม (Created, Updated, Deleted) จะถูกบันทึกผ่าน `auditCampaign` helper ลงใน `audit_logs`
- **Insight Aggregator**: 
    - ระบบจะดึงข้อมูลจาก `ad_insights` โดยเชื่อมโยงผ่าน `campaign_ads` เพื่อสรุปผลรายแคมเปญแบบ Real-time

### **3. Frontend Hooks & State Management**
- **`useCampaigns`**: 
    - จัดการ Lifecycle ทั้งหมด (CRUD)
    - **Double-counting Prevention**: ตรรกะการรวม Insights ที่ฉลาดพอจะแยกแยะระหว่าง Direct Link (Legacy) และ User-assigned Ads เพือความแม่นยำ 100%
- **`useCampaignInsights`**: 
    - ดึงข้อมูล `ad_insights` รายวันเฉพาะของแคมเปญนี้เพื่อแสดงผลใน `AreaChart` (Trend Visualization)
- **`calculateCampaignProgress`**: 
    - Hook Helper สำหรับคำนวณ Progress แบบ Dynamic ไม่มีการบันทึกลง Base แต่ประมวลผลสดทุกครั้งที่ Query

### **4. Business Logic, Constraints & Edge Cases**
- **Progress Weight Formula**: 
    - `Overall % = (KPI_Progress * 0.5) + (Time_Progress * 0.5)`
    - `Time_Progress = (Now - Start) / (End - Start) * 100` (Max 100%)
    - `KPI_Progress = (Actual_KPI / Target_KPI) * 100` (Max 100%)
- **Validation Rules**: วันที่สิ้นสุด (`end_date`) ต้องอยู่หลังวันที่เริ่มต้น (`start_date`) เสมอ
- **Edge Case - No KPI**: หากไม่ได้ระบุ KPI เป้าหมาย `kpiProgress` จะถูกนับเป็น 0% และความคืบหน้าจะขึ้นอยู่กับ `Time_Progress` เป็นหลัก

---

## 7. ระบบ Customer Journey (/customer-journey)
การวิเคราะห์พฤติกรรมลูกค้าตามขั้นตอน (Step-by-Step Funnel) และระบบประมาณการ AI อัจฉริยะ

### **1. Database Schema & Relations**
- **`public.funnel_stages`**: นิยามขั้นตอนของ Journey
    - `id`: `UUID` | `slug`: `VARCHAR` (awareness, consideration, acquisition, intent, conversion)
    - `name`: `VARCHAR` | `display_order`: `INTEGER`
    - `aarrr_categories_id`: `UUID` (FK -> `aarrr_categories.id`)
- **`public.ad_insights`**: (Data Source) 
    - ใช้ฟิลด์ `impressions`, `clicks`, `leads`, `adds_to_cart`, `conversions` เป็นตัวแปรต้นในการคำนวณแต่ละ Stage

### **2. Backend Services & RPC/APIs**
- **RPC `get_customer_journey_funnel_totals`**:
    - **Input**: `p_date_from`, `p_platform_id`
    - **Output**: JSON สรุปยอดรวม (Totals) และชุด Flag `used_fallback` (ระบุว่าข้อมูลไหนมาจากการประมาณการ)
    - **Logic**: หากข้อมูลจริง (`leads`, `adds_to_cart`) เป็น 0 ระบบจะคำนวณอัตโนมัติในระดับ SQL เพื่อความรวดเร็ว
- **RPC `get_customer_journey_monthly_data`**:
    - สรุปข้อมูลรายเดือนย้อนหลัง เพื่อใช้เปรียบเทียบความสำเร็จของการดึงลูกค้าเข้าสู่ Journey ในแต่ละช่วงเวลา

### **3. Frontend Hooks & State Management**
- **`useFunnelData`**: 
    - Hook ศูนย์กลางที่จัดการทั้ง Fetching และ **Waterfall Constraint Logic**
    - บริหารจัดการสเตท `usedFallback` เพื่อนำไปแสดงผลสถานะ "Estimated" บน UI
- **`useCustomerJourneyData`**: 
    - ทำหน้าที่ระบุสถานะราย Stage (Awareness -> Conversion) พร้อมคำนวณ **Retention Rate** (เปอร์เซ็นต์การไหลจาก Stage ก่อนหน้า)

### **4. Business Logic, Constraints & Edge Cases**
- **Waterfall Constraint Rule**: 
    - `Value[Stage_i] = Min(Raw_Value[Stage_i], Value[Stage_{i-1}])`
    - กฎนี้รับประกันว่าจำนวนลูกค้าในขั้นตอนที่ลึกกว่า "ต้องไม่มากกว่า" ขั้นตอนก่อนหน้า เพื่อความถูกต้องตามหลักสถิติ Funnel
- **AI Estimation Formulas (Fallback)**:
    - `Leads (Acquisition) = Clicks * 0.05` (5% Assumption)
    - `Adds to Cart (Intent) = Max(Leads * 0.25, Conversions * 2.5)`
    - `Conversions = Adds to Cart * 0.35`
- **Missing Data Handling**: หาก `conversions` เป็น 0 แต่มี `adds_to_cart` ระบบจะใช้ Ratio 35% เพื่อส่งต่อข้อมูลไปยังขั้นตอนสุดท้าย ไม่ให้ Journey ขาดตอน

---

## 8. ระบบ AARRR Funnel (/aarrr-funnel)
กรอบการวิเคราะห์การเติบโตแบบองค์รวมผ่าน 5 ระยะหลัก (Acquisition -> Referral)

### **1. Database Schema & Relations**
- **`public.aarrr_categories`**: มาตรฐานการแบ่งกลุ่มกิจกรรม
    - `id`: `UUID` | `slug`: `VARCHAR` (acquisition, activation, retention, revenue, referral)
    - `name`: `VARCHAR` | `display_order`: `INTEGER`
- **`public.funnel_stages`**: ขั้นตอนปลีกย่อยที่ผูกกับหมวดหมู่ AARRR
    - `aarrr_categories_id`: `UUID` (FK -> `aarrr_categories`)
- **`public.ad_insights`**: ข้อมูลดิบรายวัน
    - ฟิลด์ที่ใช้: `impressions` (Acq), `clicks` (Act), `leads` (Ret), `conversions` (Rev)

### **2. Backend Services & RPC/APIs**
- **RPC `get_customer_journey_monthly_data`**:
    - **Logic**: ทำการ Aggregation ข้อมูลจาก `ad_insights` รายวันให้เป็นรายเดือน โดยแยกตาม `team_id` และกรองตาม `platform_id`
    - **Output**: รายภูมิภาค/แพลตฟอร์ม เพื่อใช้สร้าง Stacked Area Chart
- **Referral Calculation Layer**: เนื่องจากไม่มีข้อมูล Referral โดยตรง ระบบจะฉีด (Inject) ค่าเสมือนที่คำนวณจากสูตรทางธุรกิจเข้าไปในชุดข้อมูล JSON ก่อนส่งออก API

### **3. Frontend Hooks & State Management**
- **`useAARRRMonthlyData`**: 
    - ทำหน้าที่ "Data Transformer" ซึ่งแปลงโครงสร้างข้อมูลจาก SQL Result ไปเป็นรูปเล่มที่ Chart Library (Recharts) ต้องการ
    - **Caching**: ใช้ React Query เก็บข้อมูลย้อนหลัง 6 เดือนเพื่อลด Latency ในการเปลี่ยน Tab Platform
- **`useFunnelData`**: สรุปยอดรวมสะสม (Cumulative Totals) เพื่อคำนวณ Drop-off Rate ระหว่าง Stage

### **4. Business Logic, Constraints & Edge Cases**
- **AARRR Mapping Formula**:
    - `Acquisition` = `SUM(impressions)`
    - `Activation` = `SUM(clicks)`
    - `Retention` = `SUM(leads)` (หรือ AI Fallback)
    - `Revenue` = `SUM(conversions)`
    - `Referral` = `Revenue * 0.15` (15% Referral Potential Assumption)
- **Visual Bottle Neck Constraint**: 
    - ความกว้างของ Funnel จะลดหลั่นตามสัดส่วนจริง แต่จำกัดขั้นต่ำ (Min-width) ไว้ที่ 15% เพื่อให้ข้อความบน UI ยังอ่านได้แม้ Conversion จะต่ำมาก
- **Edge Case - Partial Months**: สำหรับเดือนปัจจุบัน ระบบจะแสดงเครื่องหมาย "Ongoing" และใช้สัดส่วนเฉลี่ยรายวันเพื่อพยากรณ์ผลลัพธ์ปลายเดือน

---

## 9. ระบบ Dashboard Analytics (/analytics)
การวิเคราะห์เชิงลึกด้านพฤติกรรมลูกค้าและประสิทธิภาพช่องทาง (Multi-dimensional Data Mining)

### **1. Database Schema & Relations**
- **`public.customer_activities`**: บันทึก Log พฤติกรรมราย Event
    - `id`: `UUID` | `profile_customer_id`: `UUID` (FK -> `profile_customers`)
    - `event_type_id`: `UUID` (FK -> `event_types`)
    - `device_type`, `browser`: `VARCHAR` | `page_url`: `TEXT`
- **`public.cohort_analysis`**: ตารางสรุปผลการรักษาฐานลูกค้า (Retention)
    - `cohort_date`: `DATE` | `cohort_size`: `INTEGER`
    - `retention_data`: `JSONB` (เก็บอัตราการกลับมาใช้ซ้ำในเดือนที่ 1, 2, 3...)
    - `lifetime_value`: `DECIMAL(15,2)`
- **`public.conversion_events`**: รายการธุรกรรม/เหตุการณ์สร้างรายได้
    - `event_value`: `NUMERIC` | `processing_status`: `VARCHAR`

### **2. Backend Services & RPC/APIs**
- **Activity Tracking Engine**: 
    - รับข้อมูลผ่าน Webhook หรือ Client SDK เพื่อบันทึกลง `customer_activities` แบบ Asynchronous
- **Cohort Generator Job (Cron)**:
    - รันทุกสัปดาห์เพื่อประมวลผลข้อมูล `customer_activities` และ `conversions` แล้วสรุปผลลงตาราง `cohort_analysis`
- **Platform Analytics Aggregator**:
    - RPC สำหรับคำนวณ **Share of Voice (SOV)** โดยเปรียบเทียบ Impressions ของแต่ละแพลตฟอร์มเทียบกับยอดรวมทั้งหมด

### **3. Frontend Hooks & State Management**
- **`useAnalyticsData`**: 
    - ดึงข้อมูลแบบ Multi-source (Cohorts, Activities, Conversions) มาประกอบกัน
    - **Local Aggregation**: คำนวณ Device Breakdown และ Browser Breakdown ในระดับ Client เพื่อความรวดเร็วในการสลับมิติกราฟ
- **Dual-Y-Axis Chart Logic**: สลับหน่วยวัดระหว่าง "จำนวนครั้ง (Count)" และ "มูลค่าเงิน (Currency)" ในกราฟเดียวกัน

### **4. Business Logic, Constraints & Edge Cases**
- **LTV Calculation**: `Lifetime Value = SUM(event_value) per Profile` 
- **Share of Market Formula**: `(Platform_Spend / Total_Spend) * 100` เพื่อดูการกระจายงบประมาณ
- **Validation**: 
    - ระบบจะกรองบอท (Bot Filtering) โดยตรวจสอบ `user_agent` และความถี่ของกิจกรรมที่ผิดปกติ (Velocity Check)
- **Edge Case - Cross-Device Sync**: หากลูกค้าคนเดิมเปลี่ยนอุปกรณ์ ระบบจะพยายามเชื่อมโยงผ่าน `session_id` หรือ Email หากมีการ Login

---

## 10. ระบบจัดการทีม (/team)
การบริหารจัดการสิทธิ์ผู้ใช้งาน (RBAC) และการทำงานร่วมกันในองค์กร

### **1. Database Schema & Relations**
- **`public.workspaces`**: ข้อมูลองค์กร/พื้นที่ทำงาน
    - `id`: `UUID` | `owner_id`: `UUID` | `name`: `VARCHAR`
- **`public.workspace_members`**: รายชื่อและระดับสิทธิ์ของสมาชิก
    - `team_id`: `UUID` (FK -> `workspaces`)
    - `user_id`: `UUID` (FK -> `profiles`)
    - `role`: `ENUM` (owner, admin, editor, viewer)
    - `custom_permissions`: `JSONB` (ใช้ Override สิทธิ์พื้นฐานรายบุคคล)
    - `status`: `ENUM` (active, suspended)
- **`public.team_invitations`**: ระบบคำเชิญผ่านอีเมล
    - `email`: `VARCHAR` | `token`: `VARCHAR` | `status`: `ENUM` (pending, accepted, declined)

### **2. Backend Services & RPC/APIs**
- **Invitation Service**: 
    - ระบบส่ง Email ผ่าน SMTP/Postmark พร้อมสร้าง Secure Token ที่มีอายุ 7 วัน
- **Real-time Activity Logs**:
    - ทุกการแก้ไขสิทธิ์ (Role Change) จะถูกบันทึกลง `team_activity_logs` อัตโนมัติผ่าน Triggers หลังบ้าน
- **Permission Check Middleware**:
    - RPC ฝั่ง Database สำหรับตรวจสอบสิทธิ์ก่อนอนุญาตให้ทำการลบแคมเปญหรือส่งออกรายงาน

### **3. Frontend Hooks & State Management**
- **`useTeamManagement`**: 
    - หัวใจหลักของหน้านี้ ทำหน้าที่รวบรวบทั้ง Members, Invitations และ Activity Logs มาไว้ใน State เดียว
    - **Optimistic Updates**: เมื่อมีการระงับใช้สมาชิก (Suspend) UI จะอัปเดตสถานะทันทีในขณะที่รอดำเนินการฝั่งเซิร์ฟเวอร์
- **`useTeamPermissions`**: 
    - ใช้ประมวลผล **Effective Permissions** (Role + Custom Overrides) เพื่อตัดสินใจในการแสดง/ซ่อนปุ่มบน UI

### **4. Business Logic, Constraints & Edge Cases**
- **Effective Permission Rule**: 
    - `Can_Action = Role_Default OR Custom_Permission_Override`
- **Team Hierarchy Constraints**: 
    - `Admin` ไม่สามารถลบหรือแก้ไขสิทธิ์ของ `Owner` ได้
    - `Editor` สามารถดู Dashboard ได้แต่ไม่สามารถจัดการการตั้งค่า Billing
- **Edge Case - Last Owner Guard**: 
    - ระบบไม่อนุญาตให้ `Owner` ลบตัวเองหรือลาออกหากเหลือตัวเองเพียงคนเดียวใน Workspace
- **Invite Reuse Prevention**: เมื่อ Token ถูกใช้แล้ว หรืออีเมลถูกระงับสิทธิ์ (Suspended) การพยายาม Join ใหม่จะถูกบล็อกทันที

---

## 11. ระบบคลังรายงาน (/reports)
การสร้างและจัดเก็บรายงานสรุปผลอัตโนมัติ (Automated Reporting Engine)

### **1. Database Schema & Relations**
- **`public.reports`**: ข้อมูลรายงานที่สร้างสำเร็จ
    - `id`: `UUID` | `team_id`: `UUID` (FK)
    - `report_type`: `VARCHAR` (Performance, Monthly, ROI)
    - `file_url`: `TEXT` (S3/Supabase Storage Link)
    - `filters`: `JSONB` (เก็บ Criteria ที่ใช้สร้างรายงานนั้นๆ)
- **`public.scheduled_reports`**: การตั้งค่ารายงานล่วงหน้า
    - `id`: `UUID` | `name`: `VARCHAR`
    - `frequency`: `ENUM` (daily, weekly, monthly)
    - `recipients`: `JSONB` (รายการอีเมลผู้รับ)
    - `is_active`: `BOOLEAN`
    - `report_id`: `UUID` (FK -> `reports`)

### **2. Backend Services & RPC/APIs**
- **PDF Generation Lambda (Edge Function)**:
    - รับอาเรย์ข้อมูลดิบ -> เรนเดอร์เป็น Template สวยงาม -> แปลงเป็น PDF -> อัปโหลดเข้า Storage
- **Scheduler Worker (Cron Job)**:
    - รันทุกต้นชั่วโมงเพื่อตรวจสอบว่ามี `scheduled_reports` ตัวไหนถึงเวลาส่งแล้วบ้าง
- **CDN Signed URL Service**:
    - สร้าง Link ดาวน์โหลดชั่วคราวที่มีอายุจำกัด เพื่อความปลอดภัยของข้อมูลบริษัท

### **3. Frontend Hooks & State Management**
- **`useReports`**: 
    - จัดการรายการรายงานย้อนหลัง พร้อมระบบ Filter ตามวันที่และประเภท
- **`useScheduledReports`**: 
    - จัดการระบบ Automation ของผู้ใช้งาน (สร้าง/แก้ไข/เปิด-ปิด ตารางเวลา)
    - **Query Invalidation**: เมื่อรายงานใหม่สร้างเสร็จ จะทำการ Refetch รายการทั้งหมดเพื่อแสดงผลล่าสุดทันที

### **4. Business Logic, Constraints & Edge Cases**
- **Reference ID Generation**: 
    - รายงานทุกฉบับจะมี ID รูปแบบ `#BZY-[Year]-[Timestamp]` เพื่อใช้ในการอ้างอิงและตรวจสอบย้อนกลับ (Auditing)
- **Data Retention Rule**: 
    - รายงานที่เก่าเกิน 1 ปีจะถูกย้ายจาก High-availability Storage ไปยัง Deep Archive เพื่อลดต้นทุน
- **Edge Case - Dynamic Filter Validation**: 
    - หากมีการเลือกช่วงวันที่ในอนาคต ระบบจะปฏิเสธการสร้างรายงานทันทีเนื่องจากไม่มีข้อมูลจริง
- **Recipient Verification**: ตรวจสอบรูปแบบอีเมล (RegEx) ก่อนบันทึกลงในระบบการตั้งเวลาส่ง

---

## 12. การเชื่อมต่อ API Channels (/api-keys)
การบริหารจัดการสิทธิ์และการเชื่อมต่อกับแพลตฟอร์มการตลาดภายนอก

### **1. Database Schema & Relations**
- **`public.workspace_api_keys`**: ตารางจัดเก็บสิทธิ์การเข้าถึงแบบเข้ารหัส 
    - `team_id`: `UUID` (FK -> `workspaces`) | `platform_id`: `UUID` (FK -> `platforms`)
    - `access_token`: `TEXT` | `api_key_encrypted`: `TEXT`
    - `sync_status`: `ENUM` (pending, connected, error)
    - `is_active`: `BOOLEAN`
- **`public.platforms`**: ข้อมูล Metadata ของแพลตฟอร์ม (Facebook, Shopee, ฯลฯ)
    - `id`: `UUID` | `slug`: `VARCHAR` | `icon_url`: `TEXT`

### **2. Backend Services & RPC/APIs**
- **OAuth Ingestion Engine**:
    - ฟังก์ชันประมวลผลการเชื่อมต่อผ่าน `MOCK_API_BASE_URL/api/connect` เพื่อทำการดึงข้อมูล (Ingest) จาก API ภายนอกเข้าสู่ Database โดยตรง
- **RPC `award_loyalty_points`**:
    - **Logic**: เมื่อมีการเชื่อมต่อ Platform สำเร็จเป็นครั้งแรก ระบบจะมอบคะแนนสะสมพิเศษ (`p_action_type = 'connect_api'`)
- **Background Health Check**:
    - ระบบตรวจสอบความถูกต้องของ Token อัตโนมัติทุก 24 ชั่วโมงเพื่ออัปเดตสถานะ `sync_status`

### **3. Frontend Hooks & State Management**
- **`usePlatformConnections`**: 
    - จัดการ Global State ของการเชื่อมต่อทั้งหมดผ่าน `PlatformConnectionsProvider`
    - **Caching Strategy**: ใช้ TanStack Query ในการล้างข้อมูล (Invalidate) ทุกครั้งที่มีการเชื่อมต่อใหม่ เพื่อให้ Dashboard แสดงผลข้อมูลล่าสุดทันที
- **`useTokenValidation`**: ตรวจสอบรูปแบบ (Format) และความปลอดภัยของ Key ก่อนส่งไปยัง Backend

### **4. Business Logic, Constraints & Edge Cases**
- **Token Masking Rule**: 
    - `Display_Value = API_Key.slice(0, 4) + '...' + API_Key.slice(-4)`
    - ค่า Token จริงจะถูกซ่อนอยู่เบื้องหลังและแสดงผลเฉพาะเมื่อผ่านการยืนยันตัวตนเท่านั้น
- **Platform Restrictions**: 
    - จำกัดการเชื่อมต่อเฉพาะแพลตฟอร์มที่ได้รับอนุญาตใน `ALLOWED_SLUGS` (Facebook, Instagram, TikTok, Shopee, Google)
- **Edge Case - Workspace-less Connection**: ระบบจะบล็อกการเชื่อมต่อทันทีหากตรวจพบว่าผู้ใช้ยังไม่มี `team_id` ที่ถูกต้อง
- **Loyalty Sync Event**: เมื่อเชื่อมต่อสำเร็จ ระบบจะยิง `loyalty-refetch` Global Event เพื่ออัปเดตสถานะ Loyalty Tier ทั่วทั้งแอป

---

## 13. ตั้งค่าระบบและงบประมาณ (/settings)
หัวใจหลักของการควบคุม Workspace และคลังงบประมาณการตลาด (Marketing Treasury)

### **1. Database Schema & Relations**
- **`public.workspaces`**: ข้อมูลการตั้งค่าองค์กร
    - `id`: `UUID` | `name`: `VARCHAR` | `logo_url`: `TEXT`
- **`public.budgets`**: จัดเก็บงบประมาณตามประเภท
    - `id`: `UUID` | `team_id`: `UUID` (FK)
    - `budget_amount`: `NUMERIC` | `budget_type`: `VARCHAR` (total, platform, campaign)
    - `start_date`, `end_date`: `DATE`
- **`public.workspace_members`**: (Referenced) ใช้ตรวจสอบสิทธิ์ในการแก้ไข Billing

### **2. Backend Services & RPC/APIs**
- **RPC `update_workspace_profile`**: 
    - จัดการอัปเดตข้อมูล Metadata ของ Workspace และโครงสร้างร้านค้า (Store Profile)
- **Budget Threshold Service**: 
    - ตรวจสอบยอดคงเหลือแบบ Real-time และบันทึกประวัติการปรับเปลี่ยนงบประมาณทุกครั้งใน `audit_logs`
- **Marketing Treasury Calculation**:
    - ระบบรวบรวมข้อมูลยอดใช้จริง (Actual Spend) จาก `ad_insights` มาหักลบกับค่าในตาราง `budgets`

### **3. Frontend Hooks & State Management**
- **`useWorkspaces`**: จัดการ Context ของ Workspace ที่ผู้ใช้กำลังทำงานอยู่
- **`useBudgets`**: 
    - ทำหน้าที่ดึงข้อมูลและจัดการสถานะ (CRUD) ของงบประมาณ
    - **Optimization**: มีการทำ Data Debouncing ในหน้าแก้ไขเพื่อให้แน่ใจว่าจะไม่มีการยิง API พร่ำเพรื่อเมื่อผู้ใช้คีย์ตัวเลขตัวเงิน

### **4. Business Logic, Constraints & Edge Cases**
- **Marketing Treasury Principle**: 
    - งบประมาณแคมเปญรวมกันจะต้องไม่เกินงบประมาณรวม (Total Budget) ที่ตั้งไว้ในระดับ Workspace
- **Overlap Validation**: ระบบไม่อนุญาตให้สร้างแผนงบประมาณที่มีช่วงเวลาทับซ้อนกันในประเภทเดียวกัน
- **Edge Case - Budget Depletion**: หากงบประมาณใช้ไปแล้วเกิน 90% ระบบจะแสดงสถานะ Alert (สีส้ม) และหากเกิน 100% จะแสดง Over-budget (สีแดง)
- **Soft Deletion Profile**: เมื่อมีการเปลี่ยน Store Profile ข้อมูลเก่าจะยังคงถูกเก็บไว้เป็น Archival สำหรับการทำ Historical Reports

## 14. รายละเอียดแคมเปญ (/campaigns/:id)
การวิเคราะห์เจาะลึกประสิทธิภาพรายแคมเปญและรายการโฆษณา

### **1. Database Schema & Relations**
- **`public.campaigns`**: ข้อมูลเป้าหมายและสถานะ 
- **`public.campaign_ads`**: ตารางเชื่อมโยง (Junction Table)
    - `campaign_id`: `UUID` (FK) | `ad_id`: `UUID` (FK -> `ads`)
    - `assigned_at`: `TIMESTAMPTZ`
- **`public.ad_insights`**: ข้อมูลสถิติรายวัน (Source of truth สำหรับกราฟ)

### **2. Backend Services & RPC/APIs**
- **RPC `award_loyalty_points`**: มอบสิทธิ์การสะสมคะแนนเมื่อแคมเปญผ่านเงื่อนไขที่กำหนด
- **Insight Time-series Aggregator**: 
    - ประมวลผลข้อมูล `ad_insights` ย้อนหลังตามช่วงเวลาที่กำหนดเพื่อส่งกลับไปแสดงผลเป็นกราฟ Trend (Area Chart)
- **Status Sync Engine**: คอยอัปเดตสถานะแคมเปญอัตโนมัติ (เช่น เปลี่ยนเป็น "Expired" เมื่อเลย End Date)

### **3. Frontend Hooks & State Management**
- **`useCampaigns` (Detail Mode)**: 
    - ดึงข้อมูล Metadata ของแคมเปญพร้อมสถานะการเชื่อมต่อโฆษณา
- **`useCampaignInsights`**: 
    - เจาะจงดึงเฉพาะข้อมูลเชิงลึกของแคมเปญโดยเฉพาะ เพื่อลดขนาด Payload ของข้อมูล
- **Granular Filter State**: จัดการสถานะการเลือกดูข้อมูลแยกตามแพลตฟอร์มภายในตัวแคมเปญเอง

### **4. Business Logic, Constraints & Edge Cases**
- **Weighted Progress Formula**: 
    - `Overall % = (KPI_Progress * 0.5) + (Time_Progress * 0.5)`
    - รับประกันว่าความคืบหน้าที่เห็นบน UI สะท้อนทั้งในแง่ของ "เวลาที่ใช้ไป" และ "เป้าหมายที่ทำสำเร็จ"
- **Target Variance Constraint**: แคมเปญที่มี Performance ต่ำกว่าเป้าหมาย 20% จะถูกติดปลาก "Underperforming" อัตโนมัติ
- **Edge Case - Ad Removal**: หากมีการสะบัดโฆษณาออกจากแคมเปญ ระบบจะทำการ Re-calculate Insights ใหม่ทันทีเพื่อความถูกต้อง
- **Data Pruning**: ข้อมูลรายวันของโฆษณาที่ถูกลบออกจากแคมเปญจะยังคงอยู่ใน DB เพื่อใช้คำนวณสถิติย้อนหลัง (Historical Integrity)

---

## 15. หน้าการเชื่อมต่อโซเชียล (/social/integrations)
ศูนย์กลางการตรวจสอบประวัติการซิงค์ข้อมูล (Audit Trail) และสุขภาพของแพลตฟอร์ม

### **1. Database Schema & Relations**
- **`public.sync_history`**: บันทึก Log การทำงานของระบบซิงค์
    - `team_id`: `UUID` (FK) | `platform_id`: `UUID` (FK)
    - `sync_type`: `VARCHAR` (Full, Incremental)
    - `status`: `VARCHAR` (processing, completed, failed)
    - `rows_synced`: `INTEGER`
    - `error_message`: `TEXT`
- **`public.platforms`**: (Referenced) เพื่อแสดงไอคอนและชื่อแบรนด์

### **2. Backend Services & RPC/APIs**
- **Sync Status Polling Interface**:
    - ช่องทางสำหรับ Client ในการติดตามความคืบหน้าของการซิงค์ข้อมูลแบบ Real-time
- **Manual Refresh Trigger**: 
    - RPC สำหรับสั่งให้ระบบดึงข้อมูลล่าสุดจาก API ภายนอกทันที (On-demand Sync)
- **`invalidateSocialRealtimeQueries`**: 
    - กลไกการเคลียร์ Cache เพื่อให้มั่นใจว่า UI ของ Social Planner/Analytics จะแสดงข้อมูลที่เพิ่งซิงค์เสร็จ

### **3. Frontend Hooks & State Management**
- **`useSyncHistory`**: 
    - ดึงรายการประวัตการซิงค์ โดยเรียงลำดับจากเหตุการณ์ล่าสุด
    - **Live Status Logic**: เมื่อตรวจพบสถานะ "processing" Hook จะทำการ Poll ข้อมูลทุกๆ 5 วินาทีจนกว่าจะเสร็จสิ้น
- **`refetchLoyalty` logic**: เชื่อมต่อกับการเปลี่ยนแปลงสถานะเพื่อให้ User รู้สึกถึงความคืบหน้าของระดับสมาชิกทุกครั้งที่มีกิจกรรม

### **4. Business Logic, Constraints & Edge Cases**
- **Exponential Backoff**: หากการซิงค์ล้มเหลว ระบบจะพยายามใหม่ (Retry) โดยมีระยะเวลาห่างเพิ่มขึ้นเรื่อยๆ เพื่อเลี่ยงการโดน Rate Limit จาก API ปลายทาง
- **Audit Logging Policy**: เก็บประวัติการซิงค์ย้อนหลัง 30 วันหรือ 100 รายการล่าสุดเพื่อประหยัดพื้นที่จัดเก็บ
- **Edge Case - Incomplete Sync**: หากการซิงค์หยุดชะงักกลางคัน (Interrupted) ระบบจะทำเครื่องหมาย "Partial" และส่งการแจ้งเตือน Error Message ที่ชัดเจนไปยังผู้ใช้งาน
- **Validation**: ตรวจสอบ `team_id` ของผู้เรียกใช้ก่อนคืนค่า Sync Logs เพื่อความปลอดภัยของข้อมูล Multi-tenancy

---

---

## 16. ระบบ Loyalty Missions & Gamification (/loyalty/missions)
ระบบกระตุ้นการมีส่วนร่วมผ่านภารกิจและการมอบรางวัลอัตโนมัติ

### **1. Database Schema & Relations**
- **`public.loyalty_activity_codes`**: คลังภารกิจที่กำหนดไว้ในระบบ
    - `id`: `UUID` | `action_code`: `VARCHAR` (Unique เช่น 'create_campaign', 'connect_api')
    - `reward_points`: `INTEGER` | `is_active`: `BOOLEAN`
- **`public.loyalty_mission_completions`**: บันทึกการทำภารกิจสำเร็จรายบุคคล
    - `user_id`: `UUID` (FK -> `auth.users`) | `action_code`: `VARCHAR` (FK)
    - `completed_at`: `TIMESTAMPTZ`
- **`public.loyalty_points`**: ยอดคะแนนสะสมคงเหลือ
    - `user_id`: `UUID` | `point_balance`: `INTEGER`

### **2. Backend Services & RPC/APIs**
- **RPC `award_loyalty_points`**:
    - **Logic**: ตรวจสอบว่าภารกิจนั้นๆ (`p_action_code`) ถูกทำไปแล้วหรือยัง (One-time mission) หากยัง ให้ทำการเพิ่มแต้มใน `loyalty_points` และบันทึกประวัติใน `loyalty_mission_completions` ภายใน Transaction เดียวกัน
- **Mission Board Processor**:
    - ฟังก์ชันสำหรับ Aggregation รายการภารกิจทั้งหมดและสถานะการทำสำเร็จของ User เพื่อแสดงผล Progress

### **3. Frontend Hooks & State Management**
- **`useLoyaltyMissions`**:
    - ดึงข้อมูลภารกิจทั้งหมดพร้อมสถานะ `isCompleted`
    - คำนวณ `progressPercent` สดบน Client จากอัตราส่วนแต้มที่ทำได้เทียบกับแต้มทั้งหมด
- **`useAwardMission`**: Hook สำหรับสั่งให้ Backend มอบแต้มเมื่อ User ทำ Action สำเร็จตามเงื่อนไข

### **4. Business Logic, Constraints & Edge Cases**
- **One-time Completion**: ภารกิจส่วนใหญ่จะจำกัดการทำสำเร็จเพียงครั้งเดียวต่อ User เพื่อป้องกันการปั๊มแต้ม
- **Point Integrity**: หากการบันทึกประวัติล้มเหลว การเพิ่มแต้มจะต้องถูก Rollback ทันที
- **Edge Case - Mission Deactivation**: หากภารกิจถูกปิดใช้งาน (`is_active = false`) โดย Admin ตรรกะการคำนวณ Progress จะต้องไม่นำแต้มจากภารกิจนั้นมารวมเป็นตัวหาร

---

## 17. ระบบสิทธิประโยชน์และระดับสมาชิก (/loyalty/tiers)
การบริหารจัดการระดับลูกค้า (Tiering) และการแลกรับสิทธิพิเศษ

### **1. Database Schema & Relations**
- **`public.loyalty_tiers`**: นิยามระดับสมาชิก
    - `id`: `UUID` | `name`: `VARCHAR` (Bronze, Silver, Gold, Platinum)
    - `min_points`: `INTEGER` (แต้มขั้นต่ำเพื่อเข้าสู่ Tier)
    - `priority_level`: `INTEGER` (ใช้ในการจัดลำดับความสำคัญ)
- **`public.loyalty_tier_history`**: บันทึกประวัติการเปลี่ยนระดับ
    - `old_tier`, `new_tier`: `VARCHAR` | `change_type`: `ENUM` (auto, manual)
- **`public.redemption_requests`**: รายการแลกของรางวัล
    - `reward_id`: `UUID` | `status`: `ENUM` (pending, approved, rejected)

### **2. Backend Services & RPC/APIs**
- **RPC `manual_override_customer_tier`**:
    - อนุญาตให้ Admin ปรับระดับสมาชิกให้ลูกค้าแบบแมนนวล พร้อมระบุเหตุผล (Reason) ลงในประวัติ
- **Tier Evaluation Engine (RPC)**:
    - `evaluate_inactivity_tier_downgrades`: ตรวจสอบลูกค้าที่ไม่มีความเคลื่อนไหวตามระยะเวลาที่กำหนดเพื่อปรับลด Tier อัตโนมัติ

### **3. Frontend Hooks & State Management**
- **`useTierManagement`**:
    - จัดการประวัติการเปลี่ยน Tier และระบบค้นหาลูกค้า (Customer Search) สำหรับ Admin
- **`useRewardsManagement` & `useRedemptionRequests`**:
    - ดูแล Lifecycle ของการแลกรางวัล ตั้งแต่การยื่นคำขอไปจนถึงการอนุมัติ

### **4. Business Logic, Constraints & Edge Cases**
- **Proration & Calculation**: การเลื่อนขั้นทำทันทีเมื่อแต้มถึงเป้า แต่การลดขั้นจะเกิดขึ้นผ่าน Batch Process รอบดึกเท่านั้น
- **Suspicious Activity Alert**: หากมีการเพิ่มแต้มที่ผิดปกติ ระบบจะสร้าง Log ใน `suspicious_activities` เพื่อรอ Admin ตรวจสอบ
- **Manual Priority**: หากมีการปรับ Tier แบบ Manual ระบบจะถือเป็นสิทธิ์ขาดจนกว่า Admin จะสั่ง Evaluate ใหม่อีกครั้ง

---

## 18. ระบบสมาชิกและบิลลิ่ง (/settings/billing)
การจัดการสมัครสมาชิกของ Buzzly (B2B SaaS Subscription Engine)

### **1. Database Schema & Relations**
- **`public.subscription_plans`**: รายละเอียดแพ็กเกจ (Free, Pro, Team)
    - `price_monthly`, `price_yearly`: `NUMERIC`
    - `limits`: `JSONB` (เช่น จำนวน User สูงสุด, จำนวนแคมเปญ)
- **`public.subscriptions`**: สถานะการสมัครใช้งานปัจจุบัน
    - `status`: `VARCHAR` (active, upgraded, cancelled)
    - `current_period_end`: `TIMESTAMPTZ`
- **`public.payment_transactions` & `invoices`**: ประวัติการเงินและใบแจ้งหนี้

### **2. Backend Services & RPC/APIs**
- **RPC `apply_collected_discount`**:
    - ตรรกะการตรวจสอบและใช้คูปองส่วนลดแบบ Atomic เพื่อป้องกันการใช้คูปองซ้ำ (Race Condition Safety)
- **Proration Engine**:
    - คำนวณส่วนต่างราคา (Time Credit) เมื่อผู้ใช้เปลี่ยน Plan ระหว่างรอบบิลเพื่อนำมาหักลบกับยอดชำระใหม่

### **3. Frontend Hooks & State Management**
- **`useSubscription`**:
    - หัวใจหลักในการจัดการ Checkout Workflow, Credit Calculation และการดึงข้อมูล Plan
- **`useInvoices`**: ดึงประวัติการชำระเงินและจัดการการดาวน์โหลด PDF ใบเสร็จ

### **4. Business Logic, Constraints & Edge Cases**
- **No Downgrade Rule**: ระบบไม่อนุญาตให้ Downgrade ไปยัง Plan ที่ต่ำกว่าแบบ Automation เพื่อป้องกัน Data Overhead (ต้องติดต่อ Support)
- **Proration Formula**: `Credit = (CurrentPrice * DaysRemaining) / TotalDays`
- **Edge Case - Payment Failure**: หากสมัครไม่สำเร็จ สถานะ Subscription เดิมจะต้องคงอยู่ ไม่ถูกปิดไปก่อน

---

## 19. ระบบการแจ้งเตือนและความปลอดภัย (/notifications)
ศูนย์กลางการสื่อสารและ Audit Trail ของระบบ

### **1. Database Schema & Relations**
- **`public.notifications`**: บันทึกการแจ้งเตือน
    - `id`: `UUID` | `type`: `VARCHAR` (system, loyalty, security)
    - `is_read`: `BOOLEAN` | `metadata`: `JSONB`
- **`public.audit_logs`**: บันทึกกิจกรรมสำคัญทั่วมั้งแอป (Immutable Log)
    - `action`: `VARCHAR` | `actor_id`: `UUID` | `target_id`: `UUID`
- **`public.notification_preferences`**: การตั้งค่าการรับข่าวสารรายบุคคล

### **2. Backend Services & RPC/APIs**
- **Real-time Notify Engine**:
    - ใช้ Supabase Realtime เพื่อ Push การแจ้งเตือนไปยัง UI ทันทีเมื่อเกิดเหตุการณ์สำคัญ
- **Global Audit Logger**:
    - Helper กลาง (`auditSecurity`, `auditCampaign`, ฯลฯ) ที่ใช้บันทึกทุกการเปลี่ยนแปลงลง `audit_logs` เพื่อความโปร่งใส

### **3. Frontend Hooks & State Management**
- **`useNotifications`**: จัดการสเตทการอ่านและการทำเครื่องหมาย Read All
- **`useAuditLogs`**: บริหารจัดการข้อมูลประวัติกิจกรรมพร้อมระบบ Filter ตาม Role และ Status

### **4. Business Logic, Constraints & Edge Cases**
- **Unread Persistence**: ยอด Unread Count จะถูก Cache ไว้และอัปเดตเฉพาะเมื่อมีการเปิด Notification Panel หรือได้รับ Event ใหม่
- **Audit Immutability**: ข้อมูลใน `audit_logs` จะไม่มี API สำหรับการ Update หรือ Delete (Write-once Only)
- **Crisis Mode**: หากความต้องการส่งแจ้งเตือนสูงผิดปกติ ระบบจะทำการ Batch Notification เพื่อลดภาระของ Database

---

## 20. ระบบจัดการพนักงาน (/employees)
การบริหารจัดการทีมงานภายในพื้นที่ทำงานของลูกค้า (Customer Workspace Team)

### **1. Database Schema & Relations**
- **`public.employees`**: ตารางพนักงาน
    - `email`, `status`, `approval_status`, `is_locked`
- **`public.employees_profile`**: ข้อมูลส่วนตัวพนักงาน
    - `first_name`, `last_name`, `aptitude` (ความถนัด)
- **`public.role_employees`**: นิยามความรับผิดชอบ (Member, Lead, Admin)

### **2. Backend Services & RPC/APIs**
- **Employee Lifecycle Workflow**:
    - กระบวนการเพิ่มพนักงานใหม่ (Invitation) -> อนุมัติ (Approval) -> เปิดใช้งาน (Activation)
- **Trigger-based Role Assignment**:
    - เมื่อพนักงาน Signup ใน Auth ระบบจะใช้ DB Trigger เพื่อ Map เข้ากับ `employees` record ที่รออยู่โดยอัตโนมัติ

### **3. Frontend Hooks & State Management**
- **`useEmployees`**:
    - รวมชุดคำสั่ง CRUD สำหรับพนักงาน (Create, Update, Suspend, Delete)
    - จัดการ Join ข้อมูลข้าม 3 ตารางเพื่อให้ได้ข้อมูล Employee Object ที่สมบูรณ์

### **4. Business Logic, Constraints & Edge Cases**
- **Activation Guard**: พนักงานที่ถูก Invite จะอยู่ในสถานะ `inactive` จนกว่าจะทำการ Signup และได้รับการยืนยัน
- **Locked Account Property**: ระบบสามารถ Lock บัญชีพนักงานได้ชั่วคราวโดยไม่ต้องลบข้อมูล (เช่น กรณี Security Breach)
- **Atomic Creation**: การสร้างพนักงานและโปรไฟล์ต้องสำเร็จทั้งคู่ หากอย่างใดอย่างหนึ่งพลาด ระบบจะทำการ Rollback ข้อมูลที่เหลือทิ้ง

---

## ตารางสรุปหน้าระบบ Customer (Customer Pages Summary)

| หน้า (URL Path) | วัตถุประสงค์หลัก | ส่วนประกอบสำคัญ | ข้อมูลที่ใช้ (Key Data) |
| :--- | :--- | :--- | :--- |
| `/` | Dashboard ภาพรวม | KPI Cards, Real-time Charts | `campaign_stats`, `workspace_metrics` |
| `/social/planner` | วางแผนคอนเทนต์ | Calendar View, Scheduler | `social_posts`, `assets` |
| `/social/analytics` | วิเคราะห์ Social | Engagement Charts, CTR | `social_insights`, `platform_data` |
| `/social/inbox` | รวมแชททุกช่องทาง | Chat Interface, AI Reply | `messages`, `customer_profiles` |
| `/social/integrations`| จัดการการเชื่อมต่อโซเชียล| Sync History, Connection Cards | `platform_connections`, `sync_history` |
| `/personas` | จัดกลุ่มลูกค้า | Avatar Cards, Pain Points | `persona_profiles`, `target_segments` |
| `/campaigns` | จัดการแคมเปญ | KPI Progress, Reward System | `campaigns`, `loyalty_programs` |
| `/campaigns/:id` | รายละเอียดแคมเปญ | Daily Trend Chart, Ad List | `ad_insights`, `campaign_ads` |
| `/customer-journey` | วิเคราะห์เส้นทางลูกค้า | Funnel Visualization, Flow | `customer_events`, `touchpoints` |
| `/aarrr-funnel` | วิเคราะห์ Growth | Funnel Layers, 15% Referral | `ad_insights`, `acquisition_metrics` |
| `/analytics` | วิเคราะห์เชิงลึก | Dual Y-Axis Graphs, ROAS | `ad_insights`, `campaign_stats` |
| `/team` | จัดการทีม/สิทธิ์ | Member List, Perms Matrix | `workspace_members`, `user_roles` |
| `/reports` | คลังรายงาน | Report Archive, PDF Gen | `reports`, `report_templates` |
| `/api-keys` | เชื่อมต่อ API | Platform Sync, Token Masking | `platform_connections`, `api_tokens` |
| `/settings` | ตั้งค่า/งบประมาณ | Marketing Treasury, Profile | `workspaces`, `marketing_budgets` |
| `/loyalty/missions` | ภารกิจสะสมแต้ม | Mission Board, Progress Bar | `loyalty_activity_codes`, `missions` |
| `/loyalty/tiers` | จัดการระดับสมาชิก | Tier History, Manual Override | `loyalty_tiers`, `tier_history` |
| `/settings/billing` | จัดการการสมัครสมาชิก | Pricing Cards, Billing Info | `subscription_plans`, `invoices` |
| `/notifications` | ศูนย์รวมการแจ้งเตือน | Notification Center, Preferences | `notifications`, `audit_logs` |
| `/employees` | จัดการพนักงานร้าน | Staff List, Role Management | `employees`, `employees_profile` |
