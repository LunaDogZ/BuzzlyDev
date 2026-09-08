# Developer System Overview (รายละเอียดระบบฝั่งนักพัฒนา)

เอกสารฉับนี้สรุปรายละเอียดทางเทคนิคของระบบฝั่งนักพัฒนา (Developer Console) ของ BuzzlyDev โดยครอบคลุมโครงสร้างฐานข้อมูล, บริการหลังบ้าน (Backend), Hook ฝั่งหน้าบ้าน (Frontend), และตรรกะทางธุรกิจ (Business Logic) ของแต่ละส่วนงานสำคัญ

---

## 1. Monitor Dashboard (/dev/monitor)
ระบบตรวจสอบสุขภาพของเซิร์ฟเวอร์, สถานะ Pipeline ข้อมูล และสถานะ API ภายนอกแบบ Real-time

### รายละเอียดฐานข้อมูล (Database Schema)
- **`public.server`**: เก็บข้อมูลสุขภาพของเซิร์ฟเวอร์รายเครื่อง (Hostname, Status, CPU/Memory/Disk usage)
- **`public.data_pipeline`**: เก็บรายการและสถานะของ Pipeline ข้อมูล (Schedule, Last/Next run time, Success/Failure status)
- **`public.external_api_status`**: เก็บข้อมูลสุขภาพของ API ภายนอก (Platform name, Status code, Latency)
- **`public.error_logs`**: เก็บ Log ความผิดพลาดระดับระบบเพื่อนำมาสรุปสถิติ (Critical, Error, Warning, Info)

### บริการหลังบ้าน (Backend Services)
- **Supabase Realtime**: ใช้ช่องทาง (Channels) เพื่อส่งข้อมูลอัปเดตแบบสดๆ ไปยังหน้าจอ:
  - `admin-server-health-live`
  - `admin-pipelines-live`
  - `admin-external-api-live`
- **Computed Status Logic**: มีฟังก์ชันคำนวณสถานะความเสี่ยง (Warning/Critical) โดยอัตโนมัติตามระดับการใช้งานทรัพยากร (เช่น CPU > 90% หรือ Disk/Memory > 95% จะถูกระบุว่าเป็น Critical)

### Frontend Hooks
- **`useServerHealth`**: ดึงข้อมูลและสมัครรับข้อมูลการเปลี่ยนแปลงของตาราง `server`
- **`useDataPipelines`**: จัดการข้อมูล Pipeline พร้อมระบบกรองสถานะและการค้นหา
- **`useExternalAPIStatus`**: ตรวจสอบสุขภาพของ API ภายนอก แยกตามหมวดหมู่ (Social, Cloud, Shopping)
- **`useErrorLogStats`**: สรุปสถิติความผิดพลาดในรอบ 24 ชั่วโมงล่าสุด
- **`usePerformanceMetrics`**: รวมสถิติภาพรวมในระบบ (Aggregated Metrics) เพื่อแสดงในส่วน Summary

### ตรรกะทางธุรกิจ (Business Logic)
- **Health Calculation**: ใช้เกณฑ์ 80/85% สำหรับ Warning และ 90/95% สำหรับ Critical เพื่อระบุสุขภาพทรัพยากร
- **Real-time Synchronization**: ระบบจะ Refetch ข้อมูลอัตโนมัติทุก 10 วินาที และใช้ Postgres Changes เพื่อตอบสนองต่อการเปลี่ยนแปลงทันที
- **Error Analytics**: การรวมกลุ่ม Error ที่เกิดขึ้นบ่อย (Top Issues) และการพล็อตกราฟแนวโน้ม (Trends) เพื่อช่วยในการวินิจฉัยปัญหา

---

## 2. Audit Logs (/dev/audit-logs)
ระบบบันทึกประวัติกิจกรรมของผู้ใช้และการเปลี่ยนแปลงที่สำคัญภายในระบบ (System Audit Trail)

### รายละเอียดฐานข้อมูล (Database Schema)
- **`public.audit_logs_enhanced`**: ตารางหรือ View หลักที่รวบรวมประวัติกิจกรรม (Action, Description, Metadata, IP Address)
- **`public.action_type`**: ตารางเก็บประเภทของกิจกรรม (Action Names)
- **`public.employees` & `public.customer`**: ใช้ในการ Join ข้อมูลเพื่อระบุอีเมลและบทบาท (Role) ของผู้ที่ทำรายการ

### บริการหลังบ้าน (Backend Services)
- **Audit Logging Service**: บริการรวบรวม Log จากส่วนต่างๆ ของระบบ (Workspace, Campaigns, Loyalty) และเก็บ Metadata แบบ JSONB
- **Stats Aggregation**: ฟังก์ชันสรุปจำนวนกิจกรรมแยกตามประเภท (เช่น Total Logins, Failed Logins, Settings Changes)

### Frontend Hooks
- **`useAuditLogs`**: Hook สำหรับดึงข้อมูล Log แบบแบ่งหน้า (Pagination) พร้อมระบบกรอง (Category, Role, Status, Action)
- **`useAuditLogStats`**: ดึงสถิติจำนวนกิจกรรมสำคัญเพื่อแสดงผลใน Dashboard Cards

### ตรรกะทางธุรกิจ (Business Logic)
- **Category Normalization**: การจัดกลุ่มหมวดหมู่ UI (เช่น Authentication, Data, Security) ให้เป็นหมวดหมู่ทางเทคนิคในฐานข้อมูล
- **Page Labeling**: การแปลง Path ของหน้าเว็บ (URL) ให้เป็นชื่อหน้าภาษาอังกฤษหรือไทยที่อ่านง่ายใน Log
- **User Enrichment**: ระบบจะตรวจสอบ User ID จากทั้งตารางพนักงาน (Employees) และตารางลูกค้า (Customers) เพื่อระบุตัวตนที่ชัดเจนพร้อม Role (Owner, Dev, Support, Customer)

---

## 3. Employee Management (/dev/employees)
ระบบจัดการพนักงานฝั่ง Developer รวมถึงการอนุมัติผู้สมัครและกำหนดสิทธิ์การเข้าถึง

### รายละเอียดฐานข้อมูล (Database Schema)
- **`public.employees`**: ตารางหลักเก็บข้อมูลพนักงานและสถานะการอนุมัติ (Approval Status)
- **`public.employees_profile`**: เก็บข้อมูลส่วนบุคคลและการเข้าใช้งานล่าสุด (First/Last name, Aptitude, Last active)
- **`public.role_employees`**: ตารางกำหนดบทบาทของพนักงาน (เช่น Owner, Developer, Support)

### บริการหลังบ้าน (Backend Services)
- **Employee Lifecycle API**: ชุดฟังก์ชันสำหรับจัดการวงจรชีวิตพนักงาน (Create/Approve/Suspend/Reactivate/Delete)
- **Signup Synchronization**: ตรรกะที่เชื่อมโยงอีเมลที่ถูกเพิ่มไว้ล่วงหน้าเข้ากับ Account ของผู้ใช้เมื่อเข้าสู่ระบบครั้งแรก

### Frontend Hooks
- **`useEmployees`**: จัดการข้อมูลพนักงานทั้งหมด, รายการบทบาท, และรองรับการทำ Mutation (CRUD) ผ่าน UI

### ตรรกะทางธุรกิจ (Business Logic)
- **3-Step Approval Workflow**: พนักงานใหม่จะอยู่ในสถานะ `pending` จนกว่าผู้ดูแลระบบจะ `approved` หรือ `rejected`
- **Employee Status Logic**: สถานะพนักงานแบ่งเป็น `active` (เปิดใช้งาน), `suspended` (ระงับชั่วคราว), และ `not_signed_up` (อนุมัติแล้วแต่ยังไม่ได้สมัครสมาชิก)
- **Role Permissions Guard**: กำหนดสิทธิ์พื้นฐาน เช่น ห้ามลบหรือระงับสิทธิ์พนักงานระดับ `Owner`

---

## 4. Support & Error Logs (/dev/support)
ระบบสนับสนุนทางเทคนิคและการวินิจฉัยความผิดพลาดของระบบในระดับลึก

### รายละเอียดฐานข้อมูล (Database Schema)
- **`public.error_logs`**: ตารางศูนย์กลางสำหรับจัดเก็บ Error รายการละเอียด รวมถึง Message, Stack Trace และ Metadata

### บริการหลังบ้าน (Backend Services)
- **`logError` Service**: ฟังก์ชันกลางใน Frontend (`services/errorLogger.ts`) ที่ทำหน้าที่ส่งข้อมูลความผิดพลาดไประบุไว้ในฐานข้อมูลโดยอัตโนมัติ
- **Diagnostics API**: การเข้าถึงข้อมูลระดับ Stack Trace เพื่อการวิเคราะห์เหตุการณ์ผิดปกติ

### Frontend Hooks
- **`useDevErrorLogs`**: ดึงรายการ Error Logs พร้อมการค้นหากระบวนการวิเคราะห์เชิงลึก (UUID Search)
- **`useDevLogStats`**: สรุปสถิติจำนวน Error แยกตามระดับความรุนแรง (Critical, Error, Warning, Info)

### ตรรกะทางธุรกิจ (Business Logic)
- **Fault Simulation**: ระบบจัดเตรียมเครื่องมือ "Test Error" เพื่อให้นักพัฒนาตรวจสอบว่าระบบ Logging และ Notification ทำงานถูกต้องหรือไม่
- **UUID-Smart Search**: ระบบค้นหาอัจฉริยะที่ตรวจสอบว่าสิ่งที่ป้อนคือ Request ID หรือ User ID (UUID) หรือไม่ เพื่อกรองข้อมูลที่เกี่ยวข้องได้ทันที
- **Contextual Visualization**: การแสดงผล Stack Trace และ Augmented Metadata ในรูปแบบที่อ่านง่าย (Diagnostic View) เพื่อลดเวลาในการแก้ไขบั๊ก (Debugging)

---

## ตารางสรุปหน้าที่ของหน้าจอ (System Path Mapping)

| URL Path | Objective | Key Database Tables |
| :--- | :--- | :--- |
| `/dev/monitor` | ตรวจสอบสุขภาพระบบ hardware & APIs | `server`, `data_pipeline`, `external_api_status` |
| `/dev/audit-logs` | บันทึกประวัติและพฤติกรรมผู้ใช้ | `audit_logs_enhanced`, `action_type` |
| `/dev/employees` | จัดการบุคลากรและสิทธิ์การเข้าใช้งาน | `employees`, `employees_profile`, `role_employees` |
| `/dev/support` | วิเคราะห์ความผิดพลาดและวินิจฉัยปัญหา | `error_logs` |
