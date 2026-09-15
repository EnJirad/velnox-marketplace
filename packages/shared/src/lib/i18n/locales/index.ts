import type { Language } from "../config";
import { th } from "./th";
import { en } from "./en";
import { my as myBase } from "./my";

/** Shape of every locale dictionary — derived from Thai (source of truth). */
export type Dict = typeof th;

/**
 * Seller-identity verification copy (TH / EN / MY).
 *
 * Velnox runs ONE verification system: SELLER / SHOP identity verification.
 * A shop whose verification status is approved shows the single green V on all
 * of its products. The V never asserts product quality, authenticity, or a
 * manufacturer warranty. These overrides replace the legacy product-verification
 * wording and the garbled Thai strings that predate this change.
 */
const thVerificationCopy = {
  sellerVerificationSeparateNote:
    "การยืนยันร้านค้าตรวจสอบตัวตนของร้านค้า — สินค้าทั้งหมดของร้านจะแสดงเครื่องหมาย V เมื่อร้านผ่านการยืนยัน",
  productVerificationSeparateNote:
    "เครื่องหมาย V แสดงว่าร้านค้าผ่านการยืนยันตัวตนตามเกณฑ์ของ Velnox",
  vInfoTitle: "V — ร้านค้าที่ได้รับการยืนยัน",
  vInfoDesc: "เครื่องหมาย V แสดงว่าร้านค้านี้ผ่านกระบวนการยืนยันตัวตนตามเกณฑ์ของ Velnox",
  vInfoCheckSeller: "ร้านค้านี้ผ่านการยืนยันตัวตนโดย Velnox",
  vInfoDisclaimer:
    "V หมายถึงร้านค้าผ่านการยืนยันตัวตนตามเกณฑ์ของ Velnox ไม่ได้เป็นการรับประกันคุณภาพ ความแท้จริง หรือการรับประกันจากผู้ผลิตของสินค้าแต่ละชิ้น",
  vInfoAriaLabel: "ข้อมูลการยืนยันร้านค้า",
  velshopVerified: "ร้านค้าที่ได้รับการยืนยัน",
  velshopVerifiedDesc: "ร้านค้าที่ผ่านการยืนยันตัวตนตามเกณฑ์ของ Velnox",
  velshopVerifiedFilter: "ร้านค้าที่ได้รับการยืนยันเท่านั้น",
} satisfies Partial<Dict["verification"]>;

const enVerificationCopy = {
  sellerVerificationSeparateNote:
    "Seller verification checks the shop's identity — every product of an approved shop shows the single V.",
  productVerificationSeparateNote:
    "The V badge means the shop has passed Velnox's identity verification.",
  vInfoTitle: "V — Verified shop",
  vInfoDesc:
    "The V badge means this shop has passed Velnox's identity verification process.",
  vInfoCheckSeller: "This shop has been identity-verified by Velnox",
  vInfoDisclaimer:
    "V means the shop has passed Velnox's identity verification. It is not a guarantee of product quality, authenticity, or a manufacturer warranty for individual products.",
  vInfoAriaLabel: "Shop verification information",
  velshopVerified: "Verified shops",
  velshopVerifiedDesc: "Shops that have passed Velnox identity verification",
  velshopVerifiedFilter: "Verified shops only",
} satisfies Partial<Dict["verification"]>;

const myVerificationCopy = {
  sellerVerificationSeparateNote:
    "ဆိုင်အတည်ပြုခြင်းသည် ဆိုင်၏ မူလအာခံကို စစ်ဆေးသည် — အတည်ပြုပြီးဆိုင်တစ်ခု၏ ကုန်ပစ္စည်းအားလုံးတွင် V တစ်ခုတည်း ပြသသည်",
  productVerificationSeparateNote:
    "V အမှတ်အသားသည် ဆိုင်သည် Velnox ၏ မူလအာခံအတည်ပြုမှုကို ဖြတ်ကျော်ပြီးဖြစ်ကြောင်း ပြသသည်",
  vInfoTitle: "V — အတည်ပြုပြီးဆိုင်",
  vInfoDesc:
    "V အမှတ်အသားသည် ဤဆိုင်သည် Velnox ၏ မူလအာခံအတည်ပြုမှု လုပ်ငန်းစဉ်ကို ဖြတ်ကျော်ပြီးဖြစ်ကြောင်း ပြသသည်",
  vInfoCheckSeller: "ဤဆိုင်ကို Velnox မှ မူလအာခံအတည်ပြုပြီးဖြစ်သည်",
  vInfoDisclaimer:
    "V သည် ဆိုင်သည် Velnox ၏ မူလအာခံအတည်ပြုမှုကို ဖြတ်ကျော်ပြီးဖြစ်ကြောင်း ညွှန်ပြသည်။ ထုတ်ကုန်တစ်ခုချင်းစီ၏ အရည်အသွေး၊ မှန်ကန်မှု သို့မဟုတ် ထုတ်လုပ်သူအာမခံကို အာမခံချက် မဟုတ်ပါ။",
  vInfoAriaLabel: "ဆိုင်အတည်ပြုမှု အချက်အလက်",
  velshopVerified: "အတည်ပြုပြီးဆိုင်များ",
  velshopVerifiedDesc: "Velnox မှ မူလအာခံအတည်ပြုပြီးသော ဆိုင်များ",
  velshopVerifiedFilter: "အတည်ပြုပြီးဆိုင်များသာ",
} satisfies Partial<Dict["verification"]>;

const thCategoriesCopy = {
  velshopVerified: "ร้านค้าที่ได้รับการยืนยัน",
  velshopVerifiedDesc: "ร้านค้าที่ผ่านการยืนยันตัวตนตามเกณฑ์ของ Velnox",
} satisfies Partial<Dict["categories"]>;

const enCategoriesCopy = {
  velshopVerified: "Verified shops",
  velshopVerifiedDesc: "Shops that have passed Velnox identity verification",
} satisfies Partial<Dict["categories"]>;

const myCategoriesCopy = {
  velshopVerified: "အတည်ပြုပြီးဆိုင်များ",
  velshopVerifiedDesc: "Velnox မှ မူလအာခံအတည်ပြုပြီးသော ဆိုင်များ",
} satisfies Partial<Dict["categories"]>;

/** Category picker UI copy (TH / EN / MY). */
interface CategoryPickerCopy {
  title: string;
  search: string;
  all: string;
  back: string;
  cancel: string;
  select: string;
  close: string;
  loading: string;
  noResults: string;
  noResultsHint: string;
  empty: string;
  subcategories: string;
  selected: string;
}

const thCategoryPicker: CategoryPickerCopy = {
  title: "เลือกหมวดหมู่สินค้า",
  search: "ค้นหาหมวดหมู่...",
  all: "ทั้งหมด",
  back: "ย้อนกลับ",
  cancel: "ยกเลิก",
  select: "เลือก",
  close: "ปิด",
  loading: "กำลังโหลดหมวดหมู่...",
  noResults: "ไม่พบหมวดหมู่ที่ค้นหา",
  noResultsHint: "ลองค้นหาด้วยคำอื่น",
  empty: "ไม่มีหมวดหมู่ย่อย",
  subcategories: "{count} หมวดย่อย",
  selected: "เลือกแล้ว",
};

const enCategoryPicker: CategoryPickerCopy = {
  title: "Select a category",
  search: "Search categories...",
  all: "All",
  back: "Back",
  cancel: "Cancel",
  select: "Select",
  close: "Close",
  loading: "Loading categories...",
  noResults: "No categories found",
  noResultsHint: "Try a different keyword",
  empty: "No subcategories",
  subcategories: "{count} subcategories",
  selected: "Selected",
};

const myCategoryPicker: CategoryPickerCopy = {
  title: "ကုန်ပစ္စည်းအမျိုးအစား ရွေးပါ",
  search: "အမျိုးအစား ရှာဖွေရန်...",
  all: "အားလုံး",
  back: "နောက်သို့",
  cancel: "မလုပ်တော့ပါ",
  select: "ရွေးရန်",
  close: "ပိတ်ရန်",
  loading: "အမျိုးအစားများ ဖွင့်နေသည်...",
  noResults: "အမျိုးအစား မတွေ့ပါ",
  noResultsHint: "အခြားစကားလုံးဖြင့် ရှာကြည့်ပါ",
  empty: "အမျိုးအစားခွဲ မရှိပါ",
  subcategories: "အမျိုးအစားခွဲ {count} ခု",
  selected: "ရွေးပြီး",
};

/**
 * Burmese auth-flow strings added in the production auth upgrade.
 *
 * `my.ts` is a large append-only translation table; the auth section sits
 * beyond the safe edit window, so the new keys are merged here instead.
 * This keeps the Burmese locale at exact key parity with Thai/English
 * (enforced by tests/locale-parity.test.ts). Merge these into my.ts whenever
 * that file can be rewritten wholesale.
 */
const myAuthPatch = {
  continue: "ဆက်လုပ်ရန်",
  sendingCode: "ကုဒ်ပို့နေသည်...",
  otpTitle: "သင့်အီးမေးလ် အတည်ပြုပါ",
  otpDesc: "6 လုံးကုဒ်ကို {email} သို့ ပို့ထားပါသည်",
  resendIn: "{seconds} စက္ကန့်အတွင်း ကုဒ်ပြန်ပို့နိုင်သည်",
  resendNow: "ကုဒ် ပြန်ပို့ရန်",
  changeEmail: "အီးမေးလ် ပြောင်းရန်",
  invalidEmail: "မှန်ကန်သော အီးမေးလ် ဖြည့်ပါ",
  rateLimited: "ကုဒ်ပို့ရန် မကြာခဏလွန်းနေပါသည် ခဏစောင့်ပြီး ပြန်ကြိုးစားပါ",
  sendFailed: "ကုဒ်ပို့၍မရပါ ထပ်ကြိုးစားပါ",
  networkError: "ဆက်သွယ်မှု ပျက်ကွက်ပါသည် ထပ်ကြိုးစားပါ",
  otpInvalid: "အတည်ပြုကုဒ် မမှန်ပါ ထပ်ကြိုးစားပါ",
  otpExpired: "ကုဒ်သက်တမ်းကုန်ပါပြီ ကုဒ်အသစ် တောင်းပါ",
  otpTooMany: "မှားယွင်းမှု များလွန်းပါသည် ကုဒ်အသစ် တောင်းပါ",
  verifySuccess: "အောင်မြင်စွာ ဝင်ရောက်ပြီးပါပြီ",
  // ---- Google OAuth (primary login) ----
  welcome: "Velnox မှ ကြိုဆိုပါသည်",
  googleDesc: "သင့် Google အကောင့်ဖြင့် ဝင်ရောက်ပါ",
  googleContinue: "Google ဖြင့် ဆက်လုပ်ရန်",
  signingInGoogle: "Google သို့ ချိတ်ဆက်နေသည်...",
  googleError: "Google ဖြင့် ဝင်ရောက်၍မရပါ ထပ်ကြိုးစားပါ",
  googleCancelled: "ဝင်ရောက်မှုကို ပယ်ဖျက်လိုက်ပါသည်",
  noAccess: "ဤအကောင့်သည် ဤနေရာကို ဝင်ရောက်ခွင့်မရှိပါ",
  terms: "ဝင်ရောက်ခြင်းဖြင့် ဝန်ဆောင်မှုစည်းမျဉ်းနှင့် ကိုယ်ရေးအချက်အလက်မူဝါဒကို သဘောတူပါသည်",
  termsLink: "ဝန်ဆောင်မှုစည်းမျဉ်း",
  privacyLink: "ကိုယ်ရေးအချက်အလက်မူဝါဒ",
} satisfies Partial<Dict["auth"]>;

/**
 * Burmese strings added in the VelShop production e-commerce redesign.
 *
 * Same mechanism as `myAuthPatch`: my.ts is a large append-only table whose
 * tail sits beyond the safe edit window, so new keys are merged here instead.
 * This keeps the Burmese locale at exact key parity with Thai/English
 * (enforced by tests/locale-parity.test.ts). Merge these into my.ts whenever
 * that file can be rewritten wholesale.
 */
const myShopPatch = {
  header: {
    ariaWishlist: "အကြိုက်ဆုံးစာရင်း",
  } satisfies Partial<Dict["header"]>,
  footer: {
    colShop: "ဆိုင်",
    colHelp: "အကူအညီ",
    colLegal: "သတ်မှတ်ချက်များ",
    colVelnox: "Velnox",
    colSeller: "ရောင်းသူများ",
    allProducts: "ကုန်ပစ္စည်းအားလုံး",
    helpCenter: "အကူအညီစင်တာ",
    helpOrders: "မှာယူမှုများ",
    helpPayment: "ငွေပေးချေမှု",
    helpShipping: "ပို့ဆောင်မှု",
    helpReturns: "ငွေပြန်အမ်းခြင်း",
    contactUs: "ဆက်သွယ်ရန်",
    terms: "ဝန်ဆောင်မှုစည်းမျဉ်း",
    privacy: "ကိုယ်ရေးအချက်အလက်မူဝါဒ",
    cookies: "ကွတ်ကီးမူဝါဒ",
    refundPolicy: "ငွေပြန်အမ်းမူဝါဒ",
    aboutVelnox: "Velnox အကြောင်း",
    company: "ကုမ္ပဏီ",
    openShop: "Velnox ဖြင့် ဆိုင်ဖွင့်ရန်",
    sellerLogin: "ရောင်းသူ ဝင်ရောက်ရန်",
    secureNote: "လုံခြုံသောငွေပေးချေမှု · မှာယူမှု ခြေရာခံနိုင်သည်",
    colAccount: "အကောင့်",
    helpContact: "ဆက်သွယ်ရန်",
    helpFaq: "မေးလေ့ရှိသောမေးခွန်းများ",
    accountLogin: "ဝင်ရောက်ရန်",
    accountOrders: "မှာယူမှုများ",
    sellerJoin: "Velnox နှင့် ရောင်းချရန်",
    cookieSettings: "ကွတ်ကီး သတ်မှတ်ချက်များ",
  } satisfies Partial<Dict["footer"]>,
  addresses: {
    locationRequired: "လိပ်စာတိုင်းတွင် ကိုဩဒိနိတ်လိုအပ်သည် — မြေပုံပေါ်တွင် နေရာရွေးပြီး အတည်ပြုပါ",
    confirmLocation: "နေရာ အတည်ပြုရန်",
    locationConfirmed: "နေရာ အတည်ပြုပြီးပါပြီ",
    locationNotConfirmed: "နေရာ မအတည်ပြုရသေးပါ",
    confirmLocationRequired: "လိပ်စာ မသိမ်းမီ မြေပုံပေါ်တွင် နေရာရွေးပြီး အတည်ပြုပါ",
  } satisfies Partial<Dict["addresses"]>,
  mapPicker: {
    denied: "သင့်လက်ရှိတည်နေရာကို မရနိုင်ပါ — မြေပုံပေါ်တွင် သင့်နေရာ ရွေးပါ",
    confirm: "ဤနေရာကို အတည်ပြုရန်",
    confirmed: "နေရာ အတည်ပြုပြီးပါပြီ",
    notConfirmed: "နေရာ မအတည်ပြုရသေးပါ",
    searchPlaceholder: "နေရာ ရှာဖွေရန်...",
    noResults: "နေရာ မတွေ့ပါ",
    satellite: "ဂြိုဟ်တုဓာတ်ပုံ",
    map: "မြေပုံ",
    moveHint: "မြေပုံကို ရွှေ့၍ နေရာ ညှိပါ — ပင်ကိုသည် အမြဲတမ်း အလယ်တွင် ရှိမည်",
    satelliteUnavailable: "ဂြိုဟ်တုဓာတ်ပုံ ရယူ၍မရပါ — ပုံမှန်မြေပုံ သုံးနေသည်",
  } satisfies Partial<Dict["mapPicker"]>,
  cookies: {
    banner: "Velnox ကောင်းမွန်စွာအလုပ်လုပ်ရန်နှင့် သင့်ရွေးချယ်မှုများကို မှတ်သားရန် ကွတ်ကီးများကို အသုံးပြုပါသည်",
    acceptAll: "အားလုံး လက်ခံရန်",
    settings: "ကွတ်ကီး သတ်မှတ်ချက်များ",
    rejectNonEssential: "မလိုအပ်သောအရာများ ငြင်းပယ်ရန်",
    title: "ကွတ်ကီး သတ်မှတ်ချက်များ",
    desc: "ခွင့်ပြုလိုသော ကွတ်ကီးအမျိုးအစားများ ရွေးပါ — footer ရှိ “ကွတ်ကီး သတ်မှတ်ချက်များ” မှ အချိန်မရွေး ပြောင်းနိုင်သည်",
    necessary: "မရှိမဖြစ်",
    necessaryDesc: "ဝက်ဘ်ဆိုက် အခြေခံလုပ်ဆောင်ရန် လိုအပ်သည် — ဝင်ရောက်ခြင်း၊ ခြင်းတောင်းနှင့် လုံခြုံရေး",
    preferences: "ရွေးချယ်မှုများ",
    preferencesDesc: "သင့်ရွေးချယ်မှုများ (ဘာသာစကား၊ UI နှစ်သက်ချက်များ) ကို မှတ်သားပေးသည်",
    analytics: "ခွဲခြမ်းစိတ်ဖြာမှု",
    analyticsDesc: "ဝက်ဘ်ဆိုက်အသုံးပြုမှုကို နားလည်ပြီး ဝန်ဆောင်မှု တိုးတက်စေရန် ကူညီသည်",
    marketing: "စျေးကွက်ရှာဖွေမှု",
    marketingDesc: "စျေးကွက်ရှာဖွေခြင်းနှင့် ကြော်ငြာရည်ရွယ်ချက်များအတွက် အသုံးပြုသည်",
    alwaysActive: "အမြဲ ဖွင့်ထားသည်",
    save: "သတ်မှတ်ချက်များ သိမ်းရန်",
    saved: "ကွတ်ကီး သတ်မှတ်ချက်များ သိမ်းပြီးပါပြီ",
    pageTitle: "ကွတ်ကီးမူဝါဒ",
    pageDesc: "Velnox သည် ဝက်ဘ်ဆိုက်လည်ပတ်ရန်၊ သင့်ရွေးချယ်မှုများကို မှတ်သားရန်နှင့် အတွေ့အကြုံ တိုးတက်စေရန် ကွတ်ကီးနှင့် ဘရောက်ဆာ သိုလှောင်မှုကို အသုံးပြုသည်",
    what: "ကွတ်ကီးဆိုတာ ဘာလဲ",
    whatDesc: "ကွတ်ကီးများသည် ဝက်ဘ်ဆိုက်တစ်ခုက သင့်စက်ပစ္စည်းပေါ်တွင် သိမ်းဆည်းသည့် ဒေတာဖိုင်ငယ်များဖြစ်ပြီး လည်ပတ်မှုများကြား အချက်အလက်နှင့် အခြေအနေကို မှတ်သားရန် ဖြစ်သည်",
    how: "Velnox က ကွတ်ကီးကို မည်သို့အသုံးပြုသည်",
    howDesc: "ကျွန်ုပ်တို့သည် အခြေခံစနစ်များ (ဝင်ရောက်ခြင်း၊ ခြင်းတောင်း၊ လုံခြုံရေး) လည်ပတ်ရန် မရှိမဖြစ် ကွတ်ကီးများကို အသုံးပြုပြီး အခြားကွတ်ကီးအမျိုးအစားများ မဖွင့်မီ သင့်ခွင့်ပြုချက် တောင်းခံပါသည်",
    change: "ကွတ်ကီး သတ်မှတ်ချက်များ ပြောင်းနည်း",
    changeDesc: "အောက်ပါ “ကွတ်ကီး သတ်မှတ်ချက်များ” ခလုတ်ကို နှိပ်၍ အမျိုးအစားတစ်ခုစီ ဖွင့်/ပိတ်နိုင်သည် သို့မဟုတ် အားလုံးဖွင့်ရန် “အားလုံး လက်ခံရန်” ကို နှိပ်ပါ",
    retention: "ဒေတာ သိမ်းဆည်းချိန်",
    retentionDesc: "ကွတ်ကီးအများစုသည် ဘရောက်ဆာပိတ်သည့်အခါ ရှင်းလင်းပြီး ရွေးချယ်မှုကွတ်ကီးများသည် တစ်ခုချင်းစီ၏ သက်တမ်းအတိုင်း သိမ်းဆည်းသည် — ဘရောက်ဆာ သတ်မှတ်ချက်မှ အချိန်မရွေး ရှင်းနိုင်သည်",
    contact: "Velnox ကို ဆက်သွယ်ရန်",
    contactDesc: "ဤကွတ်ကီးမူဝါဒနှင့် ပတ်သက်၍ မေးခွန်းများရှိပါက သင့်ပရိုဖိုင်စာမျက်နှာမှ Velnox အဖွဲ့သို့ ဆက်သွယ်ပါ",
  } satisfies Partial<Dict["cookies"]>,
  product: {
    sold: "ရောင်းပြီး {count}",
    soldShort: "ရောင်းပြီး {count}",
    inStockShort: "ပစ္စည်းရှိသည်",
    ariaWishlist: "အကြိုက်ဆုံးစာရင်းထဲ ထည့်မည်",
  } satisfies Partial<Dict["product"]>,
  shopDetail: {
    title: "ဆိုင်",
  } satisfies Partial<Dict["shopDetail"]>,
  productDetail: {
    addToCart: "ခြင်းတောင်းထဲထည့်မည်",
    addToCartSm: "ခြင်းတောင်း",
    expandOptions: "ရွေးချယ်မှုများ ချဲ့ရန်",
    collapseOptions: "ရွေးချယ်မှုများ ချုံ့ရန်",
    name: "အမည်",
    category: "အမျိုးအစား",
    supplier: "ရောင်းချသူ",
  } satisfies Partial<Dict["productDetail"]>,
  cartPage: {
    selectAll: "အားလုံး ရွေးရန်",
    deselectAll: "အားလုံး ရွေးချယ်မှု ဖျက်ရန်",
    checkoutAll: "အားလုံး ပေးချေရန်",
  } satisfies Partial<Dict["cartPage"]>,
  velrepeat: {
    weekly: "အပတ်စဉ်",
    monthly: "လစဉ်",
    completedHint: "ပို့ဆောင်မှုအားလုံး ပြီးစီးပြီ",
    viewSchedule: "အချိန်ဇယား ကြည့်ရန်",
  } satisfies Partial<Dict["velrepeat"]>,
  home: {
    heroWelcomeShort: "ကြိုဆိုပါသည် {name}",
    heroTitle: "Velnox သည် သင်နှစ်သက်သောအရာကို မှတ်မိပြီး သင့်အတွက် သင့်တော်သောအရာကို ရွေးပေးသည်",
    heroDesc: "သင့်ထံမှ သင်ယူသည့် စမတ်ကျသောဈေးဝယ်မှု — ပုံမှန်ပစ္စည်းများ၊ တစ်ချက်နှိပ်ဖြင့် ပြန်မှာယူနိုင်ခြင်းနှင့် VelRepeat ဖြင့် နေ့စဉ်သုံးပစ္စည်းများ အလိုအလျောက်",
    shopNow: "စတင်ဈေးဝယ်ရန်",
    myOrders: "ကျွန်ုပ်၏ မှာယူမှုများ",
    categoriesTitle: "လူကြိုက်များသော ကဏ္ဍများ",
    categoriesDesc: "ဖောက်သည်များ လက်ရှိဈေးဝယ်နေသော ကဏ္ဍများ",
    viewAllCategories: "ကဏ္ဍအားလုံး ကြည့်ရန်",
    categoryCount: "{count} ပစ္စည်း",
    continueShoppingTitle: "ကြည့်ထားရာမှ ဆက်လုပ်ပါ",
    continueShoppingDesc: "သင်ပုံမှန်မှာယူသော ပစ္စည်းများ — တစ်ချက်နှိပ်ဖြင့် ပြန်မှာယူနိုင်သည်",
    trendingTitle: "လူကြိုက်များနေသော ပစ္စည်းများ",
    trendingDesc: "Velnox ပေါ်ရှိ အရောင်းရဆုံးအချက်အလက်အပေါ် အခြေခံသည်",
    badgeRecommended: "အကြံပြုသည်",
    velrepeatTitle: "နေ့စဉ်သုံးပစ္စည်းများကို Velnox က စီစဉ်ပေးသည်",
    velrepeatDesc: "သွားတိုက်ဆေး၊ ခေါင်းလျှော်ရည်၊ ဆန်၊ အိမ်သုံးပစ္စည်းများ — VelRepeat ကို တစ်ကြိမ်သတ်မှတ်ပါ၊ Velnox က သတ်မှတ်ထားသော အချိန်ဇယားအတိုင်း ပို့ပေးပါမည်",
    velrepeatHow1: "သင်ပုံမှန်သုံးသော ပစ္စည်းများ ရွေးပါ",
    velrepeatHow2: "အချိန်ဇယားသတ်မှတ်ပါ (အပတ်စဉ် / လစဉ်)",
    velrepeatHow3: "Velnox က အလိုအလျောက် မှာယူပို့ဆောင်ပေးသည်",
    velrepeatCta: "VelRepeat စတင်ရန်",
    velrepeatStep1: "ပစ္စည်းရွေးပါ",
    velrepeatStep1Desc: "သင်ပုံမှန်ဝယ်သော ပစ္စည်းများ၊ ဥပမာ အိမ်သုံးပစ္စည်းများ",
    velrepeatStep2: "အချိန်ဇယားသတ်မှတ်ပါ",
    velrepeatStep2Desc: "တစ်ကြိမ်လျှင် ကြားကာလနှင့် အရေအတွက် ရွေးပါ",
    velrepeatStep3: "အလိုအလျောက်ပို့ဆောင်",
    velrepeatStep3Desc: "Velnox က အချိန်ဇယားအတိုင်း မှာယူပို့ဆောင်သည် — အချိန်မရွေး ပြင်ဆင် သို့မဟုတ် ရပ်နားနိုင်သည်",
    trustTitle: "Velnox ဖြင့် ယုံကြည်စိတ်ချစွာ ဈေးဝယ်ပါ",
    trustSecureTitle: "လုံခြုံသောငွေပေးချေမှု",
    trustSecureDesc: "နည်းလမ်းမျိုးစုံ၊ အမှန်တကယ် စစ်ဆေးနိုင်သည်",
    trustTrackTitle: "ပစ္စည်းခြေရာခံခြင်း",
    trustTrackDesc: "မှာယူမှုနှင့် ပို့ဆောင်မှုအခြေအနေ ကြည့်နိုင်သည်",
    trustReturnTitle: "ငွေပြန်အမ်းခြင်း",
    trustReturnDesc: "မှာယူမှုစာမျက်နှာမှ ပြန်အမ်းရန် တင်သွင်းနိုင်သည်",
    trustSupportTitle: "ဖောက်သည်အကူအညီ",
    trustSupportDesc: "မည်သည့်စာမျက်နှာမှမဆို အဖွဲ့သို့ ဆက်သွယ်နိုင်သည်",
  } satisfies Partial<Dict["home"]>,
  products: {
    applyFilters: "စစ်ထုတ်မှု သုံးရန်",
    resetFilters: "အားလုံးရှင်းရန်",
  } satisfies Partial<Dict["products"]>,
  profile: {
    velrepeat: "VelRepeat",
    velrepeatDesc: "အသုံးပြုနေသော အလိုအလျောက်မှာယူမှုများ",
    account: "ကျွန်ုပ်၏အကောင့်",
    accountDesc: "အမည်၊ ဖုန်းနှင့် အကောင့်အချက်အလက် ပြင်ရန်",
    help: "အကူအညီ",
    helpDesc: "Velnox အဖွဲ့သို့ ဆက်သွယ်ရန်",
    statusActive: "တက်ကြွသောအဖွဲ့ဝင်",
    memberSince: "{date} မှ အဖွဲ့ဝင်",
    editProfile: "ပရိုဖိုင် ပြင်ရန်",
    accountNote: "သင့်အကောင့်သည် သင့် Google အီးမေးလ်နှင့် ချိတ်ဆက်ထားသည် — သင့်မှာယူမှုဒေတာကို လုံခြုံစွာ သိမ်းဆည်းထားသည်",
    changeAvatar: "ပရိုဖိုင်ဓာတ်ပုံ ပြောင်းရန်",
    changeCover: "ကာဗာဓာတ်ပုံ ပြောင်းရန်",
    uploadingImage: "ဓာတ်ပုံတင်နေသည်...",
    imageTypeError: "ပုံအမျိုးအစား မထောက်ပံ့ပါ — JPG၊ PNG သို့မဟုတ် WebP ရွေးပါ",
    imageSizeError: "ဖိုင်ကြီးလွန်းပါသည် — ပိုသေးသောပုံ ရွေးပါ (အများဆုံး 5 MB)",
    imageUploadFailed: "ဓာတ်ပုံတင်မရပါ ထပ်ကြိုးစားပါ",
    imageSaveFailed: "ဓာတ်ပုံ သိမ်း၍မရပါ ထပ်ကြိုးစားပါ",
    avatarAlt: "{name} ၏ ပရိုဖိုင်ဓာတ်ပုံ",
    coverAlt: "{name} ၏ ကာဗာဓာတ်ပုံ",
    session: "ဆက်ရှင်",
    signOutTitle: "ထွက်မည်လား?",
    signOutDesc: "Velnox မှ ထွက်ရန် သေချာပါသလား?",
    signOutConfirm: "ထွက်မည်",
  } satisfies Partial<Dict["profile"]>,
  account: {
    title: "ကျွန်ုပ်၏အကောင့်",
    desc: "သင့်ကိုယ်ရေးအချက်အလက် စီမံရန်",
    backToProfile: "ပရိုဖိုင်သို့ ပြန်ရန်",
    unnamed: "Velnox အဖွဲ့ဝင်",
    statusActive: "တက်ကြွသောအဖွဲ့ဝင်",
    memberSince: "{date} မှ အဖွဲ့ဝင်",
    editTitle: "ကိုယ်ရေးအချက်အလက်",
    name: "ပြသမည့်အမည်",
    namePlaceholder: "သင့်အမည်",
    nameError: "အမည်သည် ၂–၈၀ လုံး ရှိရမည်",
    phone: "ဖုန်းနံပါတ်",
    phonePlaceholder: "08X-XXX-XXXX",
    phoneHint: "မှာယူမှုနှင့် ပို့ဆောင်မှုအတွက် ဆက်သွယ်ရန် သုံးသည်",
    phoneError: "ဖုန်းနံပါတ် မမှန်ပါ",
    email: "အီးမေးလ်",
    emailLocked: "အီးမေးလ်သည် ဝင်ရောက်သည့် Google အကောင့်မှ လာသည် — Google တွင် ပြောင်းနိုင်သည်",
    save: "သိမ်းရန်",
    saving: "သိမ်းနေသည်...",
    saveSuccess: "သိမ်းပြီးပါပြီ",
    saveFailed: "သိမ်း၍မရပါ ထပ်ကြိုးစားပါ",
  } satisfies Partial<Dict["account"]>,
};

/**
 * Burmese payment-method labels. my.ts is a large append-only table whose
 * tail sits beyond the safe edit window, so new keys are merged here instead
 * (same mechanism as myAuthPatch/myShopPatch).
 */
const myOrderPatch = {
  paymentMethods: {
    online: "Online payment",
    cod: "Cash on delivery",
  } satisfies Partial<Dict["paymentMethods"]>,
} satisfies Partial<Dict>;

/**
 * Burmese comments/chat + reviews labels (Comments & Chat feature).
 */
const myChatPatch = {
  profile: {
    chat: "ချတ်",
    chatDesc: "ဆိုင်များနှင့် Velnox အဖွဲ့ စကားပြောရန်",
  } satisfies Partial<Dict["profile"]>,
  productDetail: {
    verifiedPurchase: "အမှန်တကယ်ဝယ်ယူပြီးပါပြီ ✓",
    yourReview: "သင့်သုံးသပ်ချက်",
    writeReview: "သုံးသပ်ချက်ရေးရန်",
    ratingLabel: "အဆင့်သတ်မှတ်ချက်",
    ariaStar: "{count} ကြယ်သတ်မှတ်ရန်",
    reviewCommentPlaceholder: "ဤပစ္စည်းနှင့်ပတ်သက်သော သင့်အတွေ့အကြုံကို မျှဝေပါ...",
    reviewCommentAria: "မှတ်ချက်",
    submitReview: "သုံးသပ်ချက်တင်ရန်",
    updateReview: "ပြောင်းလဲမှုများသိမ်းရန်",
    editReview: "ပြင်ရန်",
    cancelEdit: "မလုပ်တော့ပါ",
    deleteReview: "သုံးသပ်ချက်ဖျက်ရန်",
    confirmDeleteReview: "ဤသုံးသပ်ချက်ကို ဖျက်မှာလား?",
    reviewRequired: "အဆင့်သတ်မှတ်ချက်နှင့် မှတ်ချက် ထည့်ပေးပါ",
    reviewSubmitted: "သုံးသပ်ချက်တင်ပြီးပါပြီ — ကျေးဇူးတင်ပါသည်",
    reviewUpdated: "သုံးသပ်ချက် ပြင်ဆင်ပြီးပါပြီ",
    reviewDeleted: "သုံးသပ်ချက် ဖျက်ပြီးပါပြီ",
    reviewLoginTitle: "သုံးသပ်ချက်ရေးရန် ဝင်ရောက်ပါ",
    reviewLoginDesc: "သင့်ထင်မြင်ချက်မျှဝေရန် ဝင်ရောက်ထားရန် လိုအပ်ပါသည်",
    loadingReviews: "သုံးသပ်ချက်များ ဖွင့်နေသည်...",
    loadMoreReviews: "နောက်ထပ်သုံးသပ်ချက်များ",
    reviewsFailed: "သုံးသပ်ချက်များ ဖွင့်၍မရပါ",
    reviewsRetry: "ထပ်ကြိုးစားပါ",
  } satisfies Partial<Dict["productDetail"]>,
  chat: {
    title: "ချတ်",
    eyebrow: "velshop · စာတိုများ",
    conversations: "စကားပြောဆိုမှုများ",
    emptyTitle: "စာတိုမရှိသေးပါ",
    emptyDesc: "ပစ္စည်း သို့မဟုတ် ဆိုင်စာမျက်နှာမှ ဆိုင်နှင့် စတင်စကားပြောနိုင်သည်",
    inputPlaceholder: "စာတိုရိုက်ပါ...",
    send: "ပို့ရန်",
    read: "ဖတ်ပြီး",
    sent: "ပို့ပြီး",
    back: "နောက်သို့",
    chatWithShop: "ဆိုင်နှင့် စကားပြောရန်",
    productContext: "ဤပစ္စည်းအကြောင်း မေးမြန်းနေသည်",
    loadError: "စာတိုများ ဖွင့်၍မရပါ",
    retry: "ထပ်ကြိုးစားပါ",
    sendError: "စာတိုပို့၍မရပါ ထပ်ကြိုးစားပါ",
    loginToChat: "ဆိုင်နှင့်စကားပြောရန် ဝင်ရောက်ပါ",
    loginToChatDesc: "ဆိုင်နှင့် တိုက်ရိုက်မေးမြန်းရန် ဝင်ရောက်ပါ",
    noConversations: "စကားပြောဆိုမှု မရှိသေးပါ",
    today: "ယနေ့",
    yesterday: "မနေ့က",
    loadingMessages: "စာတိုများ ဖွင့်နေသည်...",
    loadOlder: "အဟောင်းစာတိုများ ဖွင့်ရန်",
    justNow: "ခုနက",
    typeMessageAria: "စာတိုရိုက်ပါ",
    sendAria: "စာတိုပို့ရန်",
    sellers: "ဆိုင်များ",
    supportTitle: "Velnox Support",
    supportDesc: "Velnox အဖွဲ့က ကူညီရန် အသင့်ရှိသည်",
    chatWithSupport: "Velnox အဖွဲ့နှင့် ချတ်လုပ်ရန်",
    supportBadge: "အကူအညီ",
    supportError: "အကူအညီချတ် ဖွင့်၍မရပါ ထပ်ကြိုးစားပါ",
  } satisfies Partial<Dict["chat"]>,
  sellerChat: {
    title: "ချတ်",
    desc: "ဆိုင်၏ ကုန်ပစ္စည်းများအကြောင်း မေးမြန်းသော ဖောက်သည်များကို ပြန်ဖြေပါ",
    eyebrow: "velseller · ဖောက်သည်များနှင့် စကားပြောရန်",
    conversations: "စကားပြောဆိုမှုများ",
    chooseConversation: "ပြန်ဖြေရန် စကားပြောဆိုမှုတစ်ခု ရွေးပါ",
    customerFallback: "ဖောက်သည်",
    aboutProduct: "ကုန်ပစ္စည်းအကြောင်း မေးမြန်းနေသည်",
    emptyDesc: "ဖောက်သည်က \"ဆိုင်နှင့် စကားပြောရန်\" နှိပ်သောအခါ ဤနေရာတွင် ပေါ်လာပါမည်",
  } satisfies Partial<Dict["sellerChat"]>,
};

/**
 * Burmese notification-bell labels (floating panel in the header).
 * Same merge mechanism as the other patches.
 */
const myNotifyPatch = {
  viewAll: "အားလုံးကြည့်ရန်",
  allCaughtUp: "အားလုံး ဖတ်ပြီးပါပြီ",
  ariaOpen: "အသိပေးချက်များ ဖွင့်ရန်",
  ariaOpenWithCount: "မဖတ်ရသေးသော အသိပေးချက် {count} ခု",
} satisfies Partial<Dict["notifications"]>;

/**
 * Seller application gate copy (TH / EN / MY).
 *
 * New gate keys for the multi-step seller application introduced by the
 * seller-application hardening work. Merged with the existing `gate` section
 * via the same spread-patch mechanism used elsewhere in this file.
 */
interface GateCopy {
  next: string;
  back: string;
  submitApplication: string;
  reviewHint: string;
  stepStore: string;
  stepApplicant: string;
  stepIdentity: string;
  stepReview: string;
  sellerApplyTitle: string;
  sellerApplyDesc: string;
  sellerCorrectionTitle: string;
  sellerCorrectionDesc: string;
  sellerActionRequired: string;
  sellerApplicantRequired: string;
  sellerIdentityRequired: string;
  sellerPendingTitle: string;
  sellerPendingDesc: string;
  sellerPendingStatus: string;
  sellerPendingEta: string;
  sellerUnderReviewTitle: string;
  sellerUnderReviewDesc: string;
  sellerUnderReviewStatus: string;
  sellerUnderReviewHint: string;
  sellerSubmittedTitle: string;
  sellerSubmittedDesc: string;
  sellerSubmittedHint: string;
  sellerBackToHome: string;
}

const thGateCopy: GateCopy = {
  next: "ถัดไป",
  back: "ย้อนกลับ",
  submitApplication: "ส่งใบสมัคร",
  reviewHint: "ตรวจสอบข้อมูลให้ถูกต้องก่อนกดส่งคำขอสมัคร",
  stepStore: "ข้อมูลร้าน",
  stepApplicant: "ข้อมูลผู้สมัคร",
  stepIdentity: "ยืนยันตัวตน",
  stepReview: "ตรวจสอบ",
  sellerApplyTitle: "สมัครเป็นพ่อค้า",
  sellerApplyDesc: "กรอกข้อมูลด้านล่างเพื่อสมัครเป็นพ่อค้าบน Velnox",
  sellerCorrectionTitle: "แก้ไขคำขอสมัคร",
  sellerCorrectionDesc: "คำขอสมัครของคุณต้องแก้ไขข้อมูลบางส่วน",
  sellerActionRequired: "ต้องแก้ไขข้อมูล",
  sellerApplicantRequired: "กรุณากรอกชื่อ นามสกุล และเบอร์โทรศัพท์",
  sellerIdentityRequired: "กรุณาอัปโหลดเอกสารยืนยันตัวตนให้ครบทั้ง 3 รูป",
  sellerPendingTitle: "สมัครร้านค้าแล้ว",
  sellerPendingDesc: "ระบบได้รับคำขอของคุณแล้ว รอการตรวจสอบจากทีมงาน Velnox",
  sellerPendingStatus: "สถานะ: รอการตรวจสอบ",
  sellerPendingEta: "ทีมงานจะตรวจสอบคำขอของคุณภายใน 1-3 วันทำการ",
  sellerUnderReviewTitle: "กำลังตรวจสอบคำขอ",
  sellerUnderReviewDesc: "ทีมงาน Velnox กำลังตรวจสอบคำขอเปิดร้านค้าของคุณ",
  sellerUnderReviewStatus: "สถานะ: อยู่ระหว่างการตรวจสอบ",
  sellerUnderReviewHint: "กรุณารอผลการตรวจสอบ คุณจะได้รับการแจ้งเตือนเมื่อมีผลลัพธ์",
  sellerSubmittedTitle: "สมัครร้านค้าสำเร็จ",
  sellerSubmittedDesc: "ระบบได้รับคำขอของคุณแล้ว ทีมงานจะตรวจสอบและอนุมัติภายใน 1-3 วันทำการ",
  sellerSubmittedHint: "คุณจะได้รับการแจ้งเตือนเมื่อบัญชีได้รับการอนุมัติ หรือมีการร้องขอให้แก้ไข",
  sellerBackToHome: "กลับไปหน้าหลัก",
};

const enGateCopy: GateCopy = {
  next: "Next",
  back: "Back",
  submitApplication: "Submit application",
  reviewHint: "Check your information before submitting the application",
  stepStore: "Store details",
  stepApplicant: "Applicant details",
  stepIdentity: "Identity verification",
  stepReview: "Review",
  sellerApplyTitle: "Become a seller",
  sellerApplyDesc: "Fill in the details below to apply to sell on Velnox",
  sellerCorrectionTitle: "Update your application",
  sellerCorrectionDesc: "Some parts of your application need correction",
  sellerActionRequired: "Action required",
  sellerApplicantRequired: "Please enter your first name, last name and phone number",
  sellerIdentityRequired: "Please upload all three identity documents",
  sellerPendingTitle: "Application submitted",
  sellerPendingDesc: "We have received your application and it is waiting for the Velnox team to review it",
  sellerPendingStatus: "Status: awaiting review",
  sellerPendingEta: "The team reviews applications within 1-3 business days",
  sellerUnderReviewTitle: "Application under review",
  sellerUnderReviewDesc: "The Velnox team is reviewing your seller application",
  sellerUnderReviewStatus: "Status: under review",
  sellerUnderReviewHint: "Please wait for the review result — you will be notified",
  sellerSubmittedTitle: "Application received",
  sellerSubmittedDesc: "We have received your application. The team reviews and approves within 1-3 business days",
  sellerSubmittedHint: "You will be notified when your account is approved or when a correction is requested",
  sellerBackToHome: "Back to home",
};

const myGateCopy: GateCopy = {
  next: "ဆက်လုပ်ရန်",
  back: "နောက်သို့",
  submitApplication: "လျှောက်လွှာ တင်သွင်းရန်",
  reviewHint: "လျှောက်လွှာ မတင်မီ အချက်အလက်များ စစ်ဆေးပါ",
  stepStore: "ဆိုင်အချက်အလက်",
  stepApplicant: "လျှောက်ထားသူအချက်အလက်",
  stepIdentity: "မူလအာခံ အတည်ပြုခြင်း",
  stepReview: "ပြန်လည်စစ်ဆေးခြင်း",
  sellerApplyTitle: "ရောင်းချသူ ဖြစ်လာရန်",
  sellerApplyDesc: "Velnox တွင် ရောင်းချရန် အောက်ပါအချက်အလက်များ ဖြည့်ပါ",
  sellerCorrectionTitle: "လျှောက်လွှာ ပြင်ဆင်ရန်",
  sellerCorrectionDesc: "သင့်လျှောက်လွှာ၏ အချို့အပိုင်းများ ပြင်ဆင်ရန် လိုအပ်သည်",
  sellerActionRequired: "လုပ်ဆောင်ရန် လိုအပ်သည်",
  sellerApplicantRequired: "အမည်၊ မျိုးရိုးအမည်နှင့် ဖုန်းနံပါတ် ဖြည့်ပါ",
  sellerIdentityRequired: "မူလအာခံစာရွက်စာတမ်း သုံးခုလုံး တင်ပါ",
  sellerPendingTitle: "လျှောက်လွှာ တင်ပြီးပါပြီ",
  sellerPendingDesc: "သင့်လျှောက်လွှာကို လက်ခံပြီးပါပြီ — Velnox အဖွဲ့ စစ်ဆေးရန် စောင့်ဆိုင်းနေသည်",
  sellerPendingStatus: "အခြေအနေ: စစ်ဆေးရန် စောင့်ဆိုင်းနေသည်",
  sellerPendingEta: "အဖွဲ့သည် လုပ်ငန်းရက် ၁–၃ ရက်အတွင်း စစ်ဆေးပါမည်",
  sellerUnderReviewTitle: "လျှောက်လွှာ စစ်ဆေးနေသည်",
  sellerUnderReviewDesc: "Velnox အဖွဲ့သည် သင့်ရောင်းချသူလျှောက်လွှာကို စစ်ဆေးနေသည်",
  sellerUnderReviewStatus: "အခြေအနေ: စစ်ဆေးနေသည်",
  sellerUnderReviewHint: "စစ်ဆေးမှုရလဒ်ကို စောင့်ဆိုင်းပါ — အသိပေးပါမည်",
  sellerSubmittedTitle: "လျှောက်လွှာ လက်ခံပြီးပါပြီ",
  sellerSubmittedDesc: "သင့်လျှောက်လွှာကို လက်ခံပြီးပါပြီ — လုပ်ငန်းရက် ၁–၃ ရက်အတွင်း အတည်ပြုပါမည်",
  sellerSubmittedHint: "အကောင့် အတည်ပြုခံရသည့်အခါ သို့မဟုတ် ပြင်ဆင်ရန် တောင်းဆိုသည့်အခါ အသိပေးပါမည်",
  sellerBackToHome: "ပင်မစာမျက်နှာသို့",
};

/**
 * Identity document uploader copy (TH / EN / MY).
 * Used by packages/shared/src/components/seller/IdentityDocumentUploader.tsx
 * and the seller application onboarding.
 */
interface IdentityDocCopy {
  sectionTitle: string;
  securityNote: string;
  idFront: string;
  idFrontHint: string;
  idBack: string;
  idBackHint: string;
  selfie: string;
  selfieHint: string;
  choose: string;
  formats: string;
  replace: string;
  remove: string;
  uploading: string;
  uploaded: string;
  failed: string;
  uploadFailed: string;
  invalidType: string;
  tooLarge: string;
  previewOnly: string;
  notUploaded: string;
}

const thIdentityDoc: IdentityDocCopy = {
  sectionTitle: "เอกสารยืนยันตัวตน",
  securityNote: "เอกสารของคุณถูกจัดเก็บแบบส่วนตัว เปิดดูได้เฉพาะทีมงานตรวจสอบของ Velnox",
  idFront: "บัตรประชาชนด้านหน้า",
  idFrontHint: "ถ่ายให้เห็นเลขบัตรและรูปชัดเจน",
  idBack: "บัตรประชาชนด้านหลัง",
  idBackHint: "ถ่ายให้เห็นข้อความด้านหลังครบถ้วน",
  selfie: "เซลฟี่คู่กับบัตรประชาชน",
  selfieHint: "ถือบัตรข้างใบหน้า ให้เห็นทั้งใบหน้าและบัตร",
  choose: "แตะเพื่อเลือกรูป",
  formats: "JPG · PNG · WebP (สูงสุด 10 MB)",
  replace: "เปลี่ยนรูป",
  remove: "ลบ",
  uploading: "กำลังอัปโหลด...",
  uploaded: "อัปโหลดแล้ว",
  failed: "อัปโหลดไม่สำเร็จ",
  uploadFailed: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่",
  invalidType: "ไฟล์ต้องเป็นรูปภาพ JPG, PNG หรือ WebP",
  tooLarge: "ไฟล์ใหญ่เกิน 10 MB",
  previewOnly: "ตัวอย่างรูปที่เลือก",
  notUploaded: "ยังไม่ได้อัปโหลด",
};

const enIdentityDoc: IdentityDocCopy = {
  sectionTitle: "Identity documents",
  securityNote: "Your documents are stored privately and are only visible to the Velnox review team",
  idFront: "ID card — front",
  idFrontHint: "Make sure the ID number and photo are clearly readable",
  idBack: "ID card — back",
  idBackHint: "Capture the full back of the card",
  selfie: "Selfie holding your ID card",
  selfieHint: "Hold the card next to your face so both are visible",
  choose: "Tap to choose a photo",
  formats: "JPG · PNG · WebP (up to 10 MB)",
  replace: "Replace",
  remove: "Remove",
  uploading: "Uploading...",
  uploaded: "Uploaded",
  failed: "Upload failed",
  uploadFailed: "Upload failed, please try again",
  invalidType: "The file must be a JPG, PNG or WebP image",
  tooLarge: "File is larger than 10 MB",
  previewOnly: "Selected image preview",
  notUploaded: "Not uploaded yet",
};

const myIdentityDoc: IdentityDocCopy = {
  sectionTitle: "မူလအာခံစာရွက်စာတမ်းများ",
  securityNote: "သင့်စာရွက်စာတမ်းများကို သီးသန့်သိမ်းဆည်းထားပြီး Velnox စစ်ဆေးရေးအဖွဲ့သာ ကြည့်နိုင်သည်",
  idFront: "မူလအာခံကတ် — အရှေ့",
  idFrontHint: "ကတ်နံပါတ်နှင့် ဓာတ်ပုံ ရှင်းလင်းစွာမြင်ရပါစေ",
  idBack: "မူလအာခံကတ် — အနောက်",
  idBackHint: "ကတ်၏ အနောက်ဘက်အပြည့် ရိုက်ပါ",
  selfie: "မူလအာခံကတ်နှင့်အတူ ဆယ်လ်ဖီ",
  selfieHint: "ကတ်ကို မျက်နှာဘေးတွင် ကိုင်ပြီး နှစ်ခုလုံးမြင်ရအောင် ရိုက်ပါ",
  choose: "ဓာတ်ပုံရွေးရန် နှိပ်ပါ",
  formats: "JPG · PNG · WebP (အများဆုံး 10 MB)",
  replace: "ပြောင်းရန်",
  remove: "ဖျက်ရန်",
  uploading: "တင်နေသည်...",
  uploaded: "တင်ပြီးပါပြီ",
  failed: "တင်မရပါ",
  uploadFailed: "တင်မရပါ ထပ်ကြိုးစားပါ",
  invalidType: "ဖိုင်သည် JPG၊ PNG သို့မဟုတ် WebP ဖြစ်ရမည်",
  tooLarge: "ဖိုင်သည် 10 MB ထက် ကြီးနေသည်",
  previewOnly: "ရွေးထားသောပုံ နမူနာ",
  notUploaded: "မတင်ရသေးပါ",
};

/**
 * Structured review-reason labels (TH / EN / MY).
 * Keys mirror packages/shared/src/lib/verification-reasons.ts exactly — the
 * backend validates the same code list.
 */
interface ReviewReasonCopy {
  id_card_unclear: string;
  id_card_incomplete: string;
  selfie_unclear: string;
  selfie_missing_id: string;
  document_expired: string;
  applicant_mismatch: string;
  store_incomplete: string;
  contact_incomplete: string;
  address_incomplete: string;
  duplicate_account: string;
  policy_violation: string;
  other: string;
}

const thReviewReason: ReviewReasonCopy = {
  id_card_unclear: "รูปบัตรประชาชนไม่ชัดเจน",
  id_card_incomplete: "รูปบัตรประชาชนไม่ครบถ้วน",
  selfie_unclear: "รูปเซลฟี่ไม่ชัดเจน",
  selfie_missing_id: "รูปเซลฟี่มองไม่เห็นบัตรประชาชน",
  document_expired: "เอกสารหมดอายุ",
  applicant_mismatch: "ข้อมูลผู้สมัครไม่ตรงกับเอกสาร",
  store_incomplete: "ข้อมูลร้านค้าไม่ครบถ้วน",
  contact_incomplete: "ข้อมูลติดต่อไม่ครบถ้วน",
  address_incomplete: "ข้อมูลที่อยู่ไม่ครบถ้วน",
  duplicate_account: "พบการสมัครซ้ำซ้อน",
  policy_violation: "ไม่เป็นไปตามเกณฑ์ของ Velnox",
  other: "อื่น ๆ",
};

const enReviewReason: ReviewReasonCopy = {
  id_card_unclear: "ID card image is unclear",
  id_card_incomplete: "ID card image is incomplete",
  selfie_unclear: "Selfie is unclear",
  selfie_missing_id: "Selfie does not clearly show the ID card",
  document_expired: "Document has expired",
  applicant_mismatch: "Applicant details do not match the documents",
  store_incomplete: "Store information is incomplete",
  contact_incomplete: "Contact information is incomplete",
  address_incomplete: "Address information is incomplete",
  duplicate_account: "Duplicate account detected",
  policy_violation: "Does not meet Velnox criteria",
  other: "Other",
};

const myReviewReason: ReviewReasonCopy = {
  id_card_unclear: "မူလအာခံကတ်ပုံ မရှင်းလင်းပါ",
  id_card_incomplete: "မူလအာခံကတ်ပုံ မပြည့်စုံပါ",
  selfie_unclear: "ဆယ်လ်ဖီပုံ မရှင်းလင်းပါ",
  selfie_missing_id: "ဆယ်လ်ဖီတွင် မူလအာခံကတ် မမြင်ရပါ",
  document_expired: "စာရွက်စာတမ်း သက်တမ်းကုန်နေသည်",
  applicant_mismatch: "လျှောက်ထားသူအချက်အလက် စာရွက်စာတမ်းနှင့် မကိုက်ညီပါ",
  store_incomplete: "ဆိုင်အချက်အလက် မပြည့်စုံပါ",
  contact_incomplete: "ဆက်သွယ်ရန်အချက်အလက် မပြည့်စုံပါ",
  address_incomplete: "လိပ်စာအချက်အလက် မပြည့်စုံပါ",
  duplicate_account: "အကောင့် ထပ်နေသည်",
  policy_violation: "Velnox စံနှုန်းနှင့် မကိုက်ညီပါ",
  other: "အခြား",
};

/**
 * VelCenter seller-application review copy (TH / EN / MY).
 * Structured reasons + checklist + review history for the review workspace.
 */
interface ReviewCopy {
  title: string;
  desc: string;
  applicantInfo: string;
  storeInfo: string;
  addressInfo: string;
  identityDocs: string;
  checklist: string;
  checklistIdentity: string;
  checklistApplication: string;
  idCardReadable: string;
  idCardComplete: string;
  applicantMatches: string;
  selfieShowsApplicant: string;
  selfieShowsIdCard: string;
  imageQuality: string;
  applicantComplete: string;
  storeComplete: string;
  contactComplete: string;
  addressComplete: string;
  decision: string;
  approve: string;
  reject: string;
  suspend: string;
  requestCorrection: string;
  confirmReject: string;
  confirmSuspend: string;
  confirmCorrection: string;
  reasonLabel: string;
  reasonPlaceholder: string;
  noteLabel: string;
  notePlaceholder: string;
  history: string;
  historyEmpty: string;
  loadingEvidence: string;
  evidenceFailed: string;
  evidenceEmpty: string;
  signedExpiry: string;
  searchPlaceholder: string;
  filterAll: string;
  filterPending: string;
  filterVerified: string;
  filterRejected: string;
  filterSuspended: string;
  noApplications: string;
  loading: string;
  loadFailed: string;
  retry: string;
  applicationDetail: string;
  close: string;
  actionSubmitted: string;
  actionResubmitted: string;
  actionUnderReview: string;
  actionNeedsCorrection: string;
  actionApproved: string;
  actionRejected: string;
  actionSuspended: string;
}

const thReview: ReviewCopy = {
  title: "ตรวจสอบการยืนยันร้านค้า",
  desc: "ตรวจสอบใบสมัครและหลักฐานยืนยันตัวตนของร้านค้า",
  applicantInfo: "ข้อมูลผู้สมัคร",
  storeInfo: "ข้อมูลร้านค้า",
  addressInfo: "ที่อยู่",
  identityDocs: "เอกสารยืนยันตัวตน",
  checklist: "รายการตรวจสอบ",
  checklistIdentity: "ตัวตน",
  checklistApplication: "ใบสมัคร",
  idCardReadable: "รูปบัตรประชาชนอ่านได้ชัดเจน",
  idCardComplete: "รูปบัตรประชาชนครบถ้วน",
  applicantMatches: "ข้อมูลผู้สมัครตรงกับเอกสาร",
  selfieShowsApplicant: "รูปเซลฟี่เห็นผู้สมัครชัดเจน",
  selfieShowsIdCard: "รูปเซลฟี่เห็นบัตรประชาชนชัดเจน",
  imageQuality: "คุณภาพรูปยอมรับได้",
  applicantComplete: "ข้อมูลผู้สมัครครบถ้วน",
  storeComplete: "ข้อมูลร้านค้าครบถ้วน",
  contactComplete: "ข้อมูลติดต่อครบถ้วน",
  addressComplete: "ข้อมูลที่อยู่ครบถ้วน",
  decision: "ผลการตรวจสอบ",
  approve: "อนุมัติ",
  reject: "ปฏิเสธ",
  suspend: "ระงับ",
  requestCorrection: "ขอให้แก้ไข",
  confirmReject: "ยืนยันปฏิเสธ",
  confirmSuspend: "ยืนยันระงับ",
  confirmCorrection: "ยืนยันขอให้แก้ไข",
  reasonLabel: "เหตุผล (จำเป็น)",
  reasonPlaceholder: "เลือกเหตุผลด้านบน แล้วเพิ่มรายละเอียดเพิ่มเติมได้",
  noteLabel: "หมายเหตุภายใน (ผู้สมัครไม่เห็น)",
  notePlaceholder: "บันทึกสำหรับทีมตรวจสอบเท่านั้น",
  history: "ประวัติการตรวจสอบ",
  historyEmpty: "ยังไม่มีประวัติการตรวจสอบ",
  loadingEvidence: "กำลังโหลดหลักฐานอย่างปลอดภัย...",
  evidenceFailed: "โหลดหลักฐานไม่สำเร็จ",
  evidenceEmpty: "ไม่มีหลักฐานที่แนบ",
  signedExpiry: "ลิงก์หลักฐานมีอายุ 5 นาที — ปิดแล้วเปิดใหม่เพื่อรับลิงก์ใหม่",
  searchPlaceholder: "ค้นหาชื่อร้าน ผู้สมัคร หรืออีเมล",
  filterAll: "ทั้งหมด",
  filterPending: "รอการยืนยัน",
  filterVerified: "ยืนยันแล้ว",
  filterRejected: "ถูกปฏิเสธ",
  filterSuspended: "ถูกระงับ",
  noApplications: "ไม่พบใบสมัคร",
  loading: "กำลังโหลด...",
  loadFailed: "โหลดไม่สำเร็จ",
  retry: "ลองใหม่",
  applicationDetail: "รายละเอียดใบสมัคร",
  close: "ปิด",
  actionSubmitted: "ส่งใบสมัคร",
  actionResubmitted: "ส่งใบสมัครใหม่",
  actionUnderReview: "เข้าสู่การตรวจสอบ",
  actionNeedsCorrection: "ขอให้แก้ไข",
  actionApproved: "อนุมัติ",
  actionRejected: "ปฏิเสธ",
  actionSuspended: "ระงับ",
};

const enReview: ReviewCopy = {
  title: "Seller verification review",
  desc: "Review the application and the submitted identity evidence",
  applicantInfo: "Applicant information",
  storeInfo: "Store information",
  addressInfo: "Address",
  identityDocs: "Identity documents",
  checklist: "Review checklist",
  checklistIdentity: "Identity",
  checklistApplication: "Application",
  idCardReadable: "ID card image is readable",
  idCardComplete: "ID card image is complete",
  applicantMatches: "Applicant details match the documents",
  selfieShowsApplicant: "Selfie clearly shows the applicant",
  selfieShowsIdCard: "Selfie clearly shows the ID card",
  imageQuality: "Image quality is acceptable",
  applicantComplete: "Applicant information is complete",
  storeComplete: "Store information is complete",
  contactComplete: "Contact information is complete",
  addressComplete: "Address information is complete",
  decision: "Decision",
  approve: "Approve",
  reject: "Reject",
  suspend: "Suspend",
  requestCorrection: "Request correction",
  confirmReject: "Confirm rejection",
  confirmSuspend: "Confirm suspension",
  confirmCorrection: "Confirm correction request",
  reasonLabel: "Reason (required)",
  reasonPlaceholder: "Pick a reason above, then add details if needed",
  noteLabel: "Internal note (not shown to the applicant)",
  notePlaceholder: "Visible to the review team only",
  history: "Review history",
  historyEmpty: "No review history yet",
  loadingEvidence: "Loading evidence securely...",
  evidenceFailed: "Failed to load evidence",
  evidenceEmpty: "No evidence attached",
  signedExpiry: "Evidence links expire after 5 minutes — reopen to refresh",
  searchPlaceholder: "Search store, applicant or email",
  filterAll: "All",
  filterPending: "Pending verification",
  filterVerified: "Verified",
  filterRejected: "Rejected",
  filterSuspended: "Suspended",
  noApplications: "No applications found",
  loading: "Loading...",
  loadFailed: "Failed to load",
  retry: "Retry",
  applicationDetail: "Application detail",
  close: "Close",
  actionSubmitted: "Application submitted",
  actionResubmitted: "Application resubmitted",
  actionUnderReview: "Moved to review",
  actionNeedsCorrection: "Correction requested",
  actionApproved: "Approved",
  actionRejected: "Rejected",
  actionSuspended: "Suspended",
};

const myReview: ReviewCopy = {
  title: "ဆိုင်အတည်ပြုမှု စစ်ဆေးခြင်း",
  desc: "လျှောက်လွှာနှင့် တင်သွင်းထားသော မူလအာခံအထောက်အထားများကို စစ်ဆေးပါ",
  applicantInfo: "လျှောက်ထားသူအချက်အလက်",
  storeInfo: "ဆိုင်အချက်အလက်",
  addressInfo: "လိပ်စာ",
  identityDocs: "မူလအာခံစာရွက်စာတမ်းများ",
  checklist: "စစ်ဆေးရန်စာရင်း",
  checklistIdentity: "မူလအာခံ",
  checklistApplication: "လျှောက်လွှာ",
  idCardReadable: "မူလအာခံကတ်ပုံ ဖတ်နိုင်သည်",
  idCardComplete: "မူလအာခံကတ်ပုံ ပြည့်စုံသည်",
  applicantMatches: "လျှောက်ထားသူအချက်အလက် စာရွက်စာတမ်းနှင့် ကိုက်ညီသည်",
  selfieShowsApplicant: "ဆယ်လ်ဖီတွင် လျှောက်ထားသူ ရှင်းလင်းစွာမြင်ရသည်",
  selfieShowsIdCard: "ဆယ်လ်ဖီတွင် မူလအာခံကတ် ရှင်းလင်းစွာမြင်ရသည်",
  imageQuality: "ပုံအရည်အသွေး လက်ခံနိုင်သည်",
  applicantComplete: "လျှောက်ထားသူအချက်အလက် ပြည့်စုံသည်",
  storeComplete: "ဆိုင်အချက်အလက် ပြည့်စုံသည်",
  contactComplete: "ဆက်သွယ်ရန်အချက်အလက် ပြည့်စုံသည်",
  addressComplete: "လိပ်စာအချက်အလက် ပြည့်စုံသည်",
  decision: "ဆုံးဖြတ်ချက်",
  approve: "အတည်ပြုရန်",
  reject: "ငြင်းပယ်ရန်",
  suspend: "ရပ်ဆိုင်းရန်",
  requestCorrection: "ပြင်ဆင်ရန် တောင်းဆိုရန်",
  confirmReject: "ငြင်းပယ်မှု အတည်ပြုရန်",
  confirmSuspend: "ရပ်ဆိုင်းမှု အတည်ပြုရန်",
  confirmCorrection: "ပြင်ဆင်ရန် တောင်းဆိုမှု အတည်ပြုရန်",
  reasonLabel: "အကြောင်းရင်း (လိုအပ်သည်)",
  reasonPlaceholder: "အပေါ်မှ အကြောင်းရင်းရွေးပြီး အသေးစိတ်ထည့်နိုင်သည်",
  noteLabel: "အတွင်းမှတ်စု (လျှောက်ထားသူ မမြင်ရ)",
  notePlaceholder: "စစ်ဆေးရေးအဖွဲ့သာ မြင်ရမည်",
  history: "စစ်ဆေးမှုမှတ်တမ်း",
  historyEmpty: "စစ်ဆေးမှုမှတ်တမ်း မရှိသေးပါ",
  loadingEvidence: "အထောက်အထားများကို လုံခြုံစွာ ဖွင့်နေသည်...",
  evidenceFailed: "အထောက်အထား ဖွင့်၍မရပါ",
  evidenceEmpty: "အထောက်အထား မပါရှိပါ",
  signedExpiry: "အထောက်အထားလင့်ခ်များ ၅ မိနစ်အကြာ သက်တမ်းကုန်သည် — ပြန်ဖွင့်ပါ",
  searchPlaceholder: "ဆိုင်၊ လျှောက်ထားသူ သို့မဟုတ် အီးမေးလ် ရှာရန်",
  filterAll: "အားလုံး",
  filterPending: "အတည်ပြုရန် စောင့်ဆိုင်းနေသည်",
  filterVerified: "အတည်ပြုပြီး",
  filterRejected: "ငြင်းပယ်ပြီး",
  filterSuspended: "ရပ်ဆိုင်းပြီး",
  noApplications: "လျှောက်လွှာ မတွေ့ပါ",
  loading: "ဖွင့်နေသည်...",
  loadFailed: "ဖွင့်၍မရပါ",
  retry: "ထပ်ကြိုးစားရန်",
  applicationDetail: "လျှောက်လွှာအသေးစိတ်",
  close: "ပိတ်ရန်",
  actionSubmitted: "လျှောက်လွှာတင်ပြီး",
  actionResubmitted: "လျှောက်လွှာ ပြန်တင်ပြီး",
  actionUnderReview: "စစ်ဆေးမှုသို့ ရောက်ပြီး",
  actionNeedsCorrection: "ပြင်ဆင်ရန် တောင်းဆိုပြီး",
  actionApproved: "အတည်ပြုပြီး",
  actionRejected: "ငြင်းပယ်ပြီး",
  actionSuspended: "ရပ်ဆိုင်းပြီး",
};

/**
 * All locale dictionaries keyed by language code. Adding a language means
 * adding a dictionary here (plus an entry in ../config).
 */
export const translations: Record<Language, Dict> = {
  th: {
    ...th,
    verification: { ...th.verification, ...thVerificationCopy },
    categories: { ...th.categories, ...thCategoriesCopy },
    categoryPicker: thCategoryPicker,
    gate: { ...th.gate, ...thGateCopy },
    identityDoc: thIdentityDoc,
    reviewReason: thReviewReason,
    review: thReview,
  } as Dict,
  en: {
    ...en,
    verification: { ...en.verification, ...enVerificationCopy },
    categories: { ...en.categories, ...enCategoriesCopy },
    categoryPicker: enCategoryPicker,
    gate: { ...en.gate, ...enGateCopy },
    identityDoc: enIdentityDoc,
    reviewReason: enReviewReason,
    review: enReview,
  } as Dict,
  my: {
    ...myBase,
    ...myOrderPatch,
    header: { ...myBase.header, ...myShopPatch.header },
    footer: { ...myBase.footer, ...myShopPatch.footer },
    product: { ...myBase.product, ...myShopPatch.product },
    home: { ...myBase.home, ...myShopPatch.home },
    products: { ...myBase.products, ...myShopPatch.products },
    profile: { ...myBase.profile, ...myShopPatch.profile, ...myChatPatch.profile },
    account: { ...((myBase as Partial<Dict>).account as Partial<Dict["account"]> | undefined), ...myShopPatch.account },
    addresses: { ...myBase.addresses, ...myShopPatch.addresses },
    mapPicker: { ...myBase.mapPicker, ...myShopPatch.mapPicker },
    shopDetail: { ...myBase.shopDetail, ...myShopPatch.shopDetail },
    productDetail: { ...myBase.productDetail, ...myShopPatch.productDetail, ...myChatPatch.productDetail },
    chat: { ...myChatPatch.chat },
    sellerChat: myChatPatch.sellerChat,
    notifications: { ...myBase.notifications, ...myNotifyPatch },
    cartPage: { ...myBase.cartPage, ...myShopPatch.cartPage },
    velrepeat: { ...myBase.velrepeat, ...myShopPatch.velrepeat },
    cookies: myShopPatch.cookies,
    auth: { ...myBase.auth, ...myAuthPatch },
    verification: { ...myBase.verification, ...myVerificationCopy },
    categories: { ...myBase.categories, ...myCategoriesCopy },
    categoryPicker: myCategoryPicker,
    gate: { ...myBase.gate, ...myGateCopy },
    identityDoc: myIdentityDoc,
    reviewReason: myReviewReason,
    review: myReview,
  } as Dict,
};
