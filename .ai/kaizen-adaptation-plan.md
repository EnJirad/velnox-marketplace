# Kaizen Adaptation Plan — Velnox Marketplace

> **เป้าหมาย:** นำ UI ที่ดีจาก [kaizen-kappa.vercel.app](https://kaizen-kappa.vercel.app) มาปรับใช้กับ Velnox Marketplace
> (velshop / velseller / velcenter) โดยคงธีม Velnox (emerald + dark slate + white)
> และโครงสร้าง Backend ของเราเอง (Render/Express/Neon)

---

## 1. สรุปภาพรวม Kaizen

Kaizen เป็น Social Community Platform สำหรับอนิเมะ/มังงะ/ครีเอเตอร์ — มีฟีเจอร์:

| หมวด | สิ่งที่มี |
|------|---------|
| **Feed/Social** | Stories (วงกลม顶部), Posts (รูป/วิดีโอ/ข้อความ), Like/Comment/Repost/Save/Share, สำหรับคุณ / กำลังติดตาม Tabs |
| **เมนูหลัก** | Bottom Tab Bar แบบลอย — สำหรับคุณ · ฟีด · สร้าง · สำรวจ · ข้อความ |
| **Hamburger** | เมนูข้าง: อนิเมะ, โรงหนัง, มังงะ, นิยาย, อีบุ๊ก, อันดับ, ค้นหา, แจ้งเตือน, ข้อความ, ชั้นหนังสือ, ประวัติ, Creator Studio, การตลาด, ตั้งค่า |
| **Discovery** | หน้าแนะนำ content, Featured anime, ช่วงหมวดหมู่, โพสต์มาแรง, มังงะ, อีบุ๊ก |
| **Anime** | แสดงซีรีส์, กรองตามหมวด/สถานะ, หน้า detail (rating, episodes, genre), วิดีโอ player |
| **Manga Reader** | Reader แบบ 2 mode: เลื่อนอ่าน / อ่านทีละหน้า, แสดงภาพ, next/prev chapter |
| **E-books** | ร้านค้าอีบุ๊ก, ขายดี, มาใหม่, Library |
| **Ranking** | K-Coin โหวต, tabs: อันดับ / กำลังมาแรง / ดวลกัน / ทำนายผล / ทำเนียบสมาชิก |
| **Creator Studio** | Dashboard: โปรไฟล์ครีเอเตอร์, สร้างโพสต์, อัปโหลดผลงาน, เขียนนิยาย, ลงขายอีบุ๊ก, ผลงาน, สินค้า, รายได้, ขาย, ยืนยันตัวตน |
| **Search** | 2 modes: ข้อความ (keyword) + AI (semantic), ปุ่มค้นหาแนะนำ |
| **Messages** | Chat (แต่ไม่สามารถเข้าได้ตอนยังไม่ login) |
| **Auth** | Google OAuth + Email/Password, Cloudflare Turnstile |
| **Tech Stack** | Supabase (Auth + REST + RPC), React + Vite + TypeScript, Vercel |

**Look & Feel:**
- ธีมมืดอมเทา (dark slate gray) เป็นหลัก
- Gradient background ในบางส่วน
- Bottom tab แบบ floating pill (rounded-2xl, backdrop-blur, shadow)
- Card ลอย white/translucent
- Typography: ไทย/อังกฤษผสม
- Stories: circular avatar + gradient border
- Posts: avatar + username + time + content + actions

---

## 2. UI Patterns ที่จะนำมาปรับใช้ (Priority สูง→ต่ำ)

### P0 — ต้องมี (Core UX)

1. **📱 Bottom Tab Bar แบบใหม่**
   - จาก: MobileTabBar ปัจจุบันของ Velnox (มีอยู่แล้ว — ดีอยู่แล้ว)
   - **ปรับ:** ทำให้สวยขึ้นตามแบบ Kaizen — floating pill, backdrop-blur, active indicator ดีงาม
   - สี active เป็น emerald (`#10B981`) — Velnox มีอยู่แล้ว
   - ปรับ tabs ตาม app: หน้าแรก · สินค้า · ตะกร้า · คำสั่งซื้อ · โปรไฟล์

2. **🔐 Login/Register Experience (สำคัญมาก)**
   - จาก: Auth.tsx ปัจจุบันของ Velnox
   - **ปรับให้เหมือน Kaizen:**
     - หน้า login แบบ clean card-centered
     - ปุ่ม Google OAuth (เราใช้ backend express + middleware auth)
     - Email/Password พร้อม input styled สวย
     - Forgot password link
     - Cloudflare Turnstile integration (กันบอท)
     - "ใช้งานต่อโดยไม่เข้าสู่ระบบ" + privacy/terms links
     - Register slide-up / bottom sheet
     - ดีไซน์ responsive (มือถือ/เดสก์ท็อป)

3. **🔄 Stories Bar (Feed แนว Social)**
   - วงกลม avatar แนวนอนด้านบน feed
   - ใช้กับร้านค้า / โปรโมชั่น / creator content
   - อนาคต: ร้านค้าสามารถอัปโหลด story ได้

4. **📝 Post Card / Product Social Feed**
   - Design Card แบบ Kaizen: avatar + name + time → content (รูป/วิดีโอ) → action buttons
   - สี card: white (`#ffffff`) บนพื้น slate-50
   - Action bar: like · comment · share · save

### P1 — ควรมี

5. **🔍 Search Bar + AI Search Toggle**
   - Search bar ติดอยู่ด้านบนเสมอ
   - Toggle: Keyword mode / AI mode
   - Suggested searches pills (tags, users, categories)
   - Live search results

6. **🎯 Discover / For You Page**
   - Hero section (featured product/banner)
   - แถวหมวดหมู่สินค้า (Rail cards)
   - แถวสินค้ามาแรง
   - Social feed ส่วนล่าง

7. **📊 Ranking System**
   - Tabs: อันดับ / มาแรง / ดวล
   - Product ranking, seller ranking, หมวดหมู่ ranking
   - ปุ่ม vote (ใช้ระบบ K-Coin หรือ point)
   - Search ranking categories

8. **🛍️ Manga Reader → Product Gallery / Content Viewer**
   - 2 modes: scroll / page-by-page
   - ใช้กับสินค้าที่มีรูปหลายรูป (gallery slideshow)
   - หรือใช้กับ content / คู่มือ

### P2 — Optional

9. **🎨 Floating Action Button (FAB) "สร้าง"**
   - ปุ่มสร้างโพสต์หรือเพิ่มสินค้าลอย

10. **📈 Creator Studio → Seller Dashboard**
    - แดชบอร์ดรวม: รายได้, สินค้า, การขาย, ยืนยันตัวตน
    - แยกหน้า: profile, products, revenue, sales history, verification

11. **🏪 Library / My Books → My Orders / My Products**
    - Layout card แนวนอนพร้อมสถานะ

12. **💬 Social Actions on Products**
    - Like, Comment, Share, Save บนสินค้า
    - Hashtag system

---

## 3. Auth Flow Adaptation (สำคัญที่สุด)

### Current Velnox Auth (ยังทำงานได้)
- Google OAuth → Express backend → JWT httpOnly cookie
- Email/password (Zod validation + bcrypt)
- หน้า Auth.tsx (shadcn/ui card)

### ปรับให้เหมือน Kaizen + Cloudflare

```
┌──────────────────────────────────────────────────┐
│                  AUTH PAGE                        │
│                                                   │
│              [Logo KAIZEN → Logo Velnox]          │
│                                                   │
│         "ยินดีต้อนรับกลับมา" / "เข้าสู่ระบบ"       │
│                                                   │
│         ┌────────────────────────────────┐        │
│         │    ดำเนินการต่อด้วย Google       │        │
│         └────────────────────────────────┘        │
│                                                   │
│         ──── หรือใช้อีเมล ────                     │
│                                                   │
│         อีเมล                                    │
│         ┌────────────────────────────────┐        │
│         │ you@example.com                │        │
│         └────────────────────────────────┘        │
│                                                   │
│         รหัสผ่าน                                  │
│         ┌────────────────────────────────┐        │
│         │ •••••••••              👁️      │        │
│         └────────────────────────────────┘        │
│                                                   │
│         [ Cloudflare Turnstile Widget ]            │
│                                                   │
│         ลืมรหัสผ่าน?                               │
│                                                   │
│         ┌────────────────────────────────┐        │
│         │          เข้าสู่ระบบ            │        │
│         └────────────────────────────────┘        │
│                                                   │
│    เพิ่งเคยใช้? สมัครสมาชิก                        │
│                                                   │
│    ─────────────────────────────────────           │
│    ใช้งานต่อโดยไม่เข้าสู่ระบบ                        │
│    นโยบายความเป็นส่วนตัว · ข้อกำหนดการใช้งาน          │
│    ปกป้องโดย freebuff.com                          │
└──────────────────────────────────────────────────┘
```

### Register Page (Bottom Sheet)

```
┌──────────────────────────────────────────────────┐
│              สมัครสมาชิก VELNOX                   │
│                                                   │
│    ชอบฟีดนี้ไหม? สมัครฟรีเพื่อใช้งานได้ครบทุกฟีเจอร์ │
│    • กดถูกใจ คอมเมนต์ และบันทึกคลิปที่ชอบ        │
│    • ติดตามครีเอเตอร์ และรับฟีดที่ตรงใจคุณ         │
│    • จอง @ยูสเซอร์เนม ที่ไม่ใครก่อนคนอื่น           │
│                                                   │
│         ┌────────────────────────────────┐        │
│         │    สมัครด้วย Google             │        │
│         └────────────────────────────────┘        │
│                                                   │
│         ──── หรือ ────                             │
│                                                   │
│         ชื่อ                                      │
│         อีเมล                                    │
│         รหัสผ่าน                                  │
│         [Cloudflare Turnstile]                    │
│                                                   │
│         ┌────────────────────────────────┐        │
│         │          สมัครสมาชิก            │        │
│         └────────────────────────────────┘        │
│                                                   │
│              มีบัญชีอยู่แล้ว? เข้าสู่ระบบ           │
│              ไว้ทีหลัง                              │
└──────────────────────────────────────────────────┘
```

### Cloudflare กันบอท

**วิธีทำ:**
1. ลงทะเบียน Cloudflare Turnstile → ได้ Site Key + Secret Key
2. เพิ่ม Site Key ใน frontend env (`VITE_TURNSTILE_SITE_KEY`)
3. เพิ่ม Secret Key ใน backend env (`TURNSTILE_SECRET_KEY`)
4. ฝัง `<CfTurnstile>` widget ในหน้า login/register
5. ส่ง token ไปกับ form submission → backend verify POST `https://challenges.cloudflare.com/turnstile/v0/siteverify`

**Backend ตรวจสอบ:**
```
POST /api/auth/login  → รับ body { email, password, turnstileToken }
→ verify turnstile token ก่อนตรวจสอบ credentials
→ ถ้า invalid → 400 "กรุณายืนยันว่าคุณไม่ใช่บอท"
```

---

## 4. Color Theme — Velnox Style (คงเดิม)

เราใช้ tokens ปัจจุบันของ Velnox ไม่เปลี่ยนเป็น dark theme ของ Kaizen เพราะเป็น marketplace สไตล์ clean/bright

| Token | Hex | Usage |
|-------|-----|-------|
| `--background` | `#f8fafc` | Page background (slate-50) |
| `--card` | `#ffffff` | Card/surface |
| `--primary` | `#0f172a` | Dark slate primary |
| `--accent` | `#10B981` | Emerald brand — active tab, success, Add to Cart |
| `--muted` | `#f1f5f9` | Muted surfaces |
| `--border` | `#e2e8f0` | Borders |
| `--foreground` | `#0f172a` | Primary text |
| `--ring` | `#10B981` | Focus ring emerald |
| Tab active bg: `#ECFDF5` | emerald-50 | Active tab background |

**สิ่งที่ปรับเพิ่มจาก Kaizen:**
- Floating bottom tab bar: `bg-white/95 backdrop-blur border-slate-200/80 shadow`
- Stories ring: gradient border (emerald → emerald-light หรือเทา)
- Post card: white บนพื้น slate-50
- Search: white pill with icon
- Action icon colors: `text-slate-400 hover:text-slate-600`

---

## 5. Component Roadmap — จัดลำดับความสำคัญ

### Sprint 1: Core UI + Auth (NOW)

| Component | Action | ไฟล์เป้าหมาย |
|-----------|--------|-------------|
| **Auth Page** 🔥 | Restyle to match Kaizen: clean card, Cloudflare Turnstile, Google + Email, Forgot password, "ใช้ต่อไม่ login" | `packages/shared/src/pages/Auth.tsx` |
| **Register bottom sheet** 🔥 | Bottom sheet registration card with benefits list | `packages/shared/src/pages/Auth.tsx` (เพิ่มในหน้าเดียวกัน) |
| **Cloudflare Turnstile hook** 🔥 | New hook + backend verify route | `packages/shared/src/hooks/use-turnstile.ts`, `backend/routes/auth.ts` |
| **Bottom Tab Bar** 🎨 | Restyle floating pill with better active states | `packages/shared/src/components/MobileTabBar.tsx` |
| **Global CSS** 🎨 | Add floating tab bar styles, white card, shadows | `packages/shared/globals.css` หรือ `apps/velshop/src/main.tsx` |

### Sprint 2: Social Feed + Stories

| Component | Action | ไฟล์เป้าหมาย |
|-----------|--------|-------------|
| **StoryCircle** 🆕 | Horizontal scrollable story avatars | `packages/shared/src/components/shop/StoryCircle.tsx` |
| **PostCard** 🆕 | Social-style post card for products/content | `apps/velshop/src/components/shop/PostCard.tsx` |
| **TabBar "For You" / "Following"** 🎨 | Restyle feed tabs | `apps/velshop/src/pages/ShopHome.tsx` |
| **ActionBar** 🆕 | Like/Comment/Share/Save widget | `packages/shared/src/components/shop/ActionBar.tsx` |

### Sprint 3: Discovery + Search

| Component | Action | ไฟล์เป้าหมาย |
|-----------|--------|-------------|
| **Discover Page** 🆕 | New discovery page: featured + rails + trending posts | `apps/velshop/src/pages/ShopDiscover.tsx` |
| **Search AI toggle** 🆕 | Keyword ↔ AI search mode | `apps/velshop/src/pages/ShopSearch.tsx` |
| **Hamburger Menu** 🎨 | Restyle navigation drawer | `packages/shared/src/components/AppHeader.tsx` |

### Sprint 4: Rankings + Seller Studio

| Component | Action | ไฟล์เป้าหมาย |
|-----------|--------|-------------|
| **Ranking page** 🆕 | Product ranking with vote system | `apps/velshop/src/pages/ShopRanking.tsx` หรือ `apps/velseller/src/pages/` |
| **Seller Studio Dashboard** 🎨 | Redesign seller dashboard | `apps/velseller/src/pages/` |
| **Gallery Viewer** 🎨 | Product image gallery (reader-style) | `packages/shared/src/components/shop/` |

---

## 6. UI Design Principles (ยืดหยุ่น)

จาก Kaizen สู่ Velnox:

```
Kaizen (Social)                         Velnox (Marketplace)
─────────────────                       ────────────────────
Dark theme (slate-gray)          →       Clean/bright (white + slate-50)
Gradient backgrounds             →       Solid light bg
Story circles for anime/manga    →       Story circles for shops/promos
Post cards (text/image/video)    →       Product cards + activity feed
Anime episodes list              →       Product variants/gallery
Manga reader (scroll/page)       →       Product image gallery viewer
Creator Studio                   →       Seller Dashboard
K-Coin voting                    →       Product rating + review
Messages (social chat)           →       Customer ↔ Seller chat
Search (keyword + AI)            →       Same — 2 modes
Auth: Supabase                   →       Auth: Express + Google OAuth + JWT
Cloudflare Turnstile             →       เพิ่ม Cloudflare Turnstile
Bottom tab pill-style            →       ปรับ MobileTabBar ให้เหมือน
```

⚠️ **ข้อควรระวัง:** ไม่ลอกเลียนแบบตรงๆ — ทุก component ต้องผ่าน lens ของ Velnox Design System:
- สี emerald = brand accent
- Slate-50 page bg
- White cards
- รองรับ 3 ภาษา (TH/EN/MY)
- Mobile-first

---

## 7. Auth Implementation Guide

### Frontend: Cloudflare Turnstile

```tsx
// packages/shared/src/hooks/use-turnstile.ts
import { useScript } from "@velnox/shared/lib/utils";

export function useTurnstile() {
  const [token, setToken] = useState<string | null>(null);
  const widgetId = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useScript("https://challenges.cloudflare.com/turnstile/v0/api.js");

  useEffect(() => {
    if (!window.turnstile || !containerRef.current) return;
    widgetId.current = window.turnstile.render(containerRef.current, {
      sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
      callback: (t: string) => setToken(t),
      "error-callback": () => setToken(null),
      "expired-callback": () => setToken(null),
    });
    return () => {
      if (widgetId.current) window.turnstile.remove(widgetId.current);
    };
  }, []);

  return { token, containerRef };
}
```

### Backend: verify route

```ts
// backend/routes/auth.ts
async function verifyTurnstile(token: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret || !token) return false;
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ secret, response: token }),
  });
  const data = await res.json();
  return data.success === true;
}
```

### CSS Key Improvements from Kaizen

```css
/* Floating bottom tab bar */
.floating-tabbar {
  @apply fixed inset-x-0 bottom-0 z-50;
  @apply pointer-events-none flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))];
}
.floating-tabbar-inner {
  @apply pointer-events-auto flex h-16 w-full max-w-md items-stretch;
  @apply rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_10px_34px_rgba(15,23,42,0.14)] backdrop-blur;
}
.floating-tabbar-item {
  @apply relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-1.5 transition-colors;
}
.floating-tabbar-item--active {
  @apply text-[#10B981];
}
.floating-tabbar-icon-wrap {
  @apply relative flex h-8 w-14 items-center justify-center rounded-full transition-colors;
}
.floating-tabbar-icon-wrap--active {
  @apply bg-[#ECFDF5];
}
```

---

## 8. รายการปรับปรุงแยกตาม App

### VelShop (Customer-facing)
- [ ] **P0** Auth page restyle (+ Turnstile)
- [ ] **P0** Bottom tab bar restyle (+ badges)
- [ ] **P1** Stories bar for shop/promos
- [ ] **P1** Discover / For You page redesign
- [ ] **P1** Search + AI mode
- [ ] **P1** Product social actions (like, share, save)
- [ ] **P2** Ranking page
- [ ] **P2** Product image gallery reader

### VelSeller (Seller-facing)
- [ ] **P0** Same Auth page (shared)
- [ ] **P1** Seller Dashboard (like Creator Studio)
- [ ] **P2** Sales/revenue dashboard

### VelCenter (Admin-facing)
- [ ] **P0** Same Auth page (shared)
- [ ] **P2** Admin ranking/vote management

### VelNox (Corporate)
- [ ] **P2** Corporate site — น้อยที่สุดที่ต้องปรับ

---

## 9. ข้อสรุป

**สิ่งที่ต้องปรับทันที (Sprint 1):**

1. Auth page → ดีไซน์เหมือน Kaizen + Cloudflare Turnstile → ใช้กับทุก app
2. Bottom Tab Bar → floating pill แบบใหม่
3. Register bottom sheet → หน้า register แบบแยก

**สิ่งที่ไม่ต้องเปลี่ยน:**
- Backend API structure (Express + Neon)
- Database schema
- สีธีมหลัก Velnox (emerald + dark slate)
- การจัดการ state (cart, auth, i18n)
- Vercel deployment

**Timeline ประมาณ:**
- Sprint 1: 2-3 วัน
- Sprint 2: 3-4 วัน
- Sprint 3: 3-4 วัน
- Sprint 4: 3-4 วัน
