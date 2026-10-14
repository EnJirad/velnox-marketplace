import { SITE_URLS } from "@velnox/shared/lib/sites";
import { ArrowRight, ArrowUpRight, Check, ShoppingBag, Store } from "lucide-react";

/**
 * Velnox Group corporate landing page.
 *
 * POSITIONING (2026-10-14): the site sells what the platform actually does
 * today — buy and sell, retail and wholesale. Two buyer tracks on one
 * marketplace:
 *
 *   1. ordinary retail customers, who browse, add to cart and pay;
 *   2. community / village shops, which restock by line item and can buy by the
 *      piece or by the pack at a lower unit price.
 *
 * The "Customer Memory / จำแทนคุณ" promise (and VelRepeat) is PARKED — see
 * `packages/shared/src/lib/features.ts`. It is deliberately absent from this
 * page rather than described as a live capability; the marketing illustration
 * is labelled as an example so nothing here reads as a live storefront.
 */
const STEPS = [
  { n: "01", label: "เลือกสินค้า", desc: "เรียกดูสินค้าจากร้านค้าจริง เลือกได้ทีละรายการ" },
  { n: "02", label: "เลือกจำนวน", desc: "ซื้อปลีกเป็นชิ้น หรือยกแพ็ค/ยกกล่อง" },
  { n: "03", label: "ราคาส่ง", desc: "ซื้อเป็นแพ็ค ราคาต่อหน่วยถูกลง" },
  { n: "04", label: "ชำระเงิน", desc: "ชำระผ่านระบบ ตรวจสอบยอดได้" },
  { n: "05", label: "ส่งถึงร้าน", desc: "ของถึงร้าน ติดตามสถานะได้ตลอด" },
] as const;

function WholesaleCard() {
  return (
    <div className="relative mx-auto w-full max-w-sm rounded-3xl border border-slate-200 bg-white p-6 shadow-xl shadow-slate-900/5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          ร้านค้าชุมชน · เติมสต็อก
        </p>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">
          ตัวอย่าง
        </span>
      </div>
      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">น้ำมะพร้าว 1 ลิตร</p>
            <p className="mt-0.5 text-xs text-slate-500">ปลีก ฿ 55/ขวด · ยกแพ็ค 12 ขวด ฿ 540</p>
          </div>
          <span className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">
            1 แพ็ค
          </span>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">ขนมขบเคี้ยวรวม</p>
            <p className="mt-0.5 text-xs text-slate-500">ปลีก ฿ 12/ซอง · ยกแพ็ค 20 ซอง ฿ 200</p>
          </div>
          <span className="shrink-0 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">
            2 แพ็ค
          </span>
        </div>
      </div>
      <div className="mt-5 rounded-2xl bg-slate-900 p-4 text-white">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-300">เฉพาะของที่หมด</span>
          <span className="font-semibold">2 รายการ</span>
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          ของในร้านที่ยังเหลือไม่ต้องสั่งซ้ำ — เลือกเติมเฉพาะรายการที่หมดได้เลย
        </p>
      </div>
      <div className="mt-4 flex items-center gap-2 text-sm font-medium text-emerald-700">
        <Check className="size-4" />
        สั่งปลีกหรือยกแพ็ค ในบัญชีเดียวกัน
      </div>
    </div>
  );
}

export function CorporateHome() {
  return (
    <div>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-slate-600">
              <span className="size-1.5 rounded-full bg-emerald-500" />
              Velnox Group · แพลตฟอร์มซื้อขายออนไลน์
            </p>
            <h1 className="mt-6 text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-6xl">
              ซื้อขายจริง ทั้ง{" "}
              <span className="text-emerald-600">ปลีกและส่ง</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
              Velnox คือตลาดออนไลน์ที่เชื่อมคนซื้อทั่วไปเข้ากับร้านค้าจริงทั่วประเทศ
              และเปิดทางให้ร้านค้าชุมชนสั่งของเข้าสต็อกได้แบบยกแพ็คในราคาส่ง
              — ไม่ต้องมีสาขาเป็นร้อย ก็เข้าถึงสินค้าได้ทั้งประเทศ
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <a
                href={SITE_URLS.velshop}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
              >
                เริ่มช้อปปิ้งที่ VelShop
                <ArrowRight className="size-4" />
              </a>
              <a
                href={SITE_URLS.velseller}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3.5 text-sm font-semibold text-slate-900 transition-colors hover:border-slate-400 hover:bg-slate-50"
              >
                สมัครเปิดร้านค้า
                <Store className="size-4" />
              </a>
            </div>
            <p className="mt-6 text-sm text-slate-500">
              ไม่ต้องสมัครก็ดูสินค้าได้ · สมัครใช้รหัส OTP ทางอีเมล ไม่ต้องจำรหัสผ่าน
            </p>
          </div>
          <WholesaleCard />
        </div>
      </section>

      {/* How a restock order works */}
      <section className="bg-slate-900 py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-400">
            การสั่งซื้อแบบร้านค้า
          </p>
          <h2 className="mt-3 max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-4xl">
            เติมสต็อกเข้าร้านได้ใน 5 ขั้นตอน
          </h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {STEPS.map((step) => (
              <div
                key={step.n}
                className="rounded-2xl border border-white/10 bg-white/5 p-5 transition-colors hover:border-emerald-400/40 hover:bg-white/10"
              >
                <p className="text-sm font-bold text-emerald-400">{step.n}</p>
                <p className="mt-3 text-base font-semibold text-white">{step.label}</p>
                <p className="mt-1.5 text-sm leading-6 text-slate-400">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Two purchase modes */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">
            สองโหมดการซื้อ
          </p>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            ซื้อปลีกก็ได้ ซื้อส่งก็ดี
          </h2>
          <p className="mt-4 text-base leading-7 text-slate-600">
            บัญชีเดียวใช้ได้ทั้งสองแบบ — ลูกค้าทั่วไปซื้อปลีกได้ตามปกติ
            และร้านค้าสามารถเลือกซื้อเป็นแพ็คเพื่อเติมสต็อกได้ในราคาต่อหน่วยที่ถูกลง
          </p>
        </div>
        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
            <div className="inline-flex size-10 items-center justify-center rounded-xl bg-slate-100 text-slate-700">
              <ShoppingBag className="size-5" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-slate-900">ซื้อปลีก — สำหรับลูกค้าทั่วไป</h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              ประสบการณ์มาร์เก็ตเพลสครบรูปแบบ: ค้นหา → ดูสินค้า → ตะกร้า → ชำระเงิน
              → รับออเดอร์ ครบถ้วนและรวดเร็วในตัวมันเอง
            </p>
          </div>
          <div className="relative rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-7 shadow-sm">
            <span className="absolute right-5 top-5 rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-bold text-white">
              จุดต่างของ Velnox
            </span>
            <div className="inline-flex size-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
              <Check className="size-5" />
            </div>
            <h3 className="mt-4 text-lg font-bold text-slate-900">
              ซื้อส่ง — สำหรับร้านค้าชุมชน
            </h3>
            <p className="mt-2 text-sm leading-7 text-slate-600">
              เลือกซื้อเป็นรายการ ซื้อเป็นชิ้นหรือยกแพ็ค ราคาต่อหน่วยถูกลงเมื่อยกแพ็ค
              และสั่งเติมเฉพาะรายการที่หมดได้ — เหมาะกับร้านค้าในหมู่บ้านและร้านค้าขนาดเล็ก
              ที่ต้องดูแลสต็อกของตัวเองทุกสัปดาห์
            </p>
          </div>
        </div>
      </section>

      {/* Ecosystem preview */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="grid gap-10 lg:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-600">
                ระบบนิเวศ
              </p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                หนึ่งแพลตฟอร์ม ครบทุกบทบาท
              </h2>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                จากลูกค้าที่กำลังช้อปปิ้ง ไปจนถึงเจ้าของร้านและทีมงานบริษัท
                — ทุกคนทำงานบนแบ็กเอนด์และฐานข้อมูลเดียวกัน
              </p>
              <a
                href="/ecosystem"
                className="mt-6 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 hover:text-emerald-800"
              >
                ดูระบบนิเวศทั้งหมด
                <ArrowRight className="size-4" />
              </a>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:col-span-2">
              {[
                {
                  title: "VelShop",
                  desc: "หน้าร้านค้าสำหรับลูกค้า — ค้นหา เลือกซื้อ และชำระเงิน",
                  href: SITE_URLS.velshop,
                },
                {
                  title: "VelSeller",
                  desc: "เครื่องมือเจ้าของร้าน — สินค้า ออเดอร์ รายได้ ค่าธรรมเนียม",
                  href: SITE_URLS.velseller,
                },
                {
                  title: "VelCenter",
                  desc: "ศูนย์กลางธุรกิจภายใน — KPI ออเดอร์ และผู้ใช้ (เฉพาะทีมงาน)",
                  href: SITE_URLS.velcenter,
                },
                {
                  title: "Velnox Group",
                  desc: "เว็บไซต์องค์กร — วิสัยทัศน์ ธุรกิจ เทคโนโลยี และข่าวสาร",
                  href: "/about",
                },
              ].map((app) => (
                <a
                  key={app.title}
                  href={app.href}
                  target={app.href.startsWith("http") ? "_blank" : undefined}
                  rel={app.href.startsWith("http") ? "noreferrer" : undefined}
                  className="group rounded-2xl border border-slate-200 bg-background p-6 transition-all hover:-translate-y-0.5 hover:border-emerald-200 hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-slate-900">{app.title}</h3>
                    <ArrowUpRight className="size-4 text-slate-300 transition-colors group-hover:text-emerald-500" />
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{app.desc}</p>
                </a>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="rounded-3xl bg-slate-900 px-6 py-14 text-center sm:px-12">
          <h2 className="mx-auto max-w-2xl text-2xl font-bold tracking-tight text-white sm:text-4xl">
            พร้อมเริ่มซื้อขายกับ Velnox หรือยัง?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-7 text-slate-400">
            ลูกค้าทั่วไปเริ่มจากการช้อปปิ้งครั้งแรก ส่วนร้านค้าเริ่มจากการสมัครเปิดร้าน
            แล้วเลือกซื้อแบบยกแพ็คเพื่อเติมสต็อกได้ทันที
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href={SITE_URLS.velshop}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-emerald-400"
            >
              เริ่มช้อปปิ้ง
              <ArrowRight className="size-4" />
            </a>
            <a
              href={SITE_URLS.velseller}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 px-6 py-3.5 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              เปิดร้านค้าของคุณ
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}
