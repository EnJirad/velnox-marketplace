-- V0040: Scalable multilingual categories + dual verification systems
-- Phase 1: Enhanced categories
-- Phase 2: Seller verification tracking
-- Phase 3: Product verification tracking
-- Phase 4: Seed categories

-- ── Phase 1: Enhanced categories ────────────────────────────────────────────
-- Add multilingual names and metadata to categories
ALTER TABLE categories ADD COLUMN IF NOT EXISTS names JSONB DEFAULT '{}';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS description_names JSONB DEFAULT '{}';
ALTER TABLE categories ADD COLUMN IF NOT EXISTS image_url TEXT;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE categories ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- ── Phase 2: Seller verification tracking ───────────────────────────────────
-- Separate seller VERIFICATION from seller approval status
-- (sellers.status = approved means they can sell; verification is a trust badge)
CREATE TABLE IF NOT EXISTS seller_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','pending','verified','rejected','suspended')),
  verification_type TEXT NOT NULL DEFAULT 'identity',
  evidence_urls JSONB DEFAULT '[]',
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),
  rejection_reason TEXT,
  suspension_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seller_verifications_seller ON seller_verifications(seller_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_seller_verifications_pending
  ON seller_verifications(seller_id) WHERE status = 'pending';

-- Add verification fields to sellers table
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified','pending','verified','rejected','suspended'));
ALTER TABLE sellers ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ── Phase 3: Product verification tracking ──────────────────────────────────
CREATE TABLE IF NOT EXISTS product_verifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'unverified'
    CHECK (status IN ('unverified','pending','verified','rejected','suspended')),
  verification_type TEXT NOT NULL DEFAULT 'standard',
  evidence_urls JSONB DEFAULT '[]',
  evidence_notes TEXT,
  category_requirements JSONB DEFAULT '{}',
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES users(id),
  rejection_reason TEXT,
  suspension_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_verifications_product ON product_verifications(product_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_verifications_pending
  ON product_verifications(product_id) WHERE status = 'pending';

-- Add verification field to products table
ALTER TABLE products ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified'
  CHECK (verification_status IN ('unverified','pending','verified','rejected','suspended'));
ALTER TABLE products ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- ── Phase 4: Seed scalable categories ───────────────────────────────────────
-- Uses ON CONFLICT(slug) DO UPDATE for idempotent seeding

INSERT INTO categories (id, name, slug, icon, names, description, description_names, sort_order, is_active) VALUES

-- Level 0: Top-level categories
('a0000001-0000-0000-0000-000000000001', 'Food & Beverage', 'food-beverage', 'utensils-crossed',
  '{"th":"อาหารและเครื่องดื่ม","en":"Food & Beverage","my":"အစားအစာနှင့်ဖျော်ရည်"}',
  'Food, drinks, and culinary products',
  '{"th":"อาหาร เครื่องดื่ม และผลิตภัณฑ์อาหาร","en":"Food, drinks, and culinary products","my":"အစားအစာ၊ ဖျော်ရည်နှင့် အစားအစာထုတ်ကုန်များ"}',
  1, true),

('a0000001-0000-0000-0000-000000000002', 'Grocery & Household', 'grocery-household', 'shopping-basket',
  '{"th":"ของชำและของใช้ในครัวเรือน","en":"Grocery & Household","my":"အစားအစာနှင့်အိမ်သုံးပစ္စည်း"}',
  'Daily essentials, cleaning supplies, and household items',
  '{"th":"สิ่งจำเป็นประจำวัน ผลิตภัณฑ์ทำความสะอาด และของใช้ในบ้าน","en":"Daily essentials, cleaning supplies, and household items","my":"နေ့စဉ်လိုအပ်ချက်များ၊ သန့်ရှင်းရေးပစ္စည်းများနှင့် အိမ်သုံးပစ္စည်းများ"}',
  2, true),

('a0000001-0000-0000-0000-000000000003', 'Beauty & Personal Care', 'beauty-personal-care', 'sparkles',
  '{"th":"ความงามและการดูแลส่วนบุคคล","en":"Beauty & Personal Care","my":"အလှအပနှင့်ကိုယ်ရေးကိုယ်တာစောင့်ရှောက်မှု"}',
  'Skincare, makeup, haircare, and personal hygiene',
  '{"th":"ผลิตภัณฑ์ดูแลผิว แต่งหน้า ดูแลเส้นผม และสุขอนามัยส่วนบุคคล","en":"Skincare, makeup, haircare, and personal hygiene","my":"အသားအရေပြုစုခြင်း၊ မိတ်ကပ်၊ ဆံပင်ပြုစုခြင်းနှင့် ကိုယ်ရေးကိုယ်တာသန့်ရှင်းရေး"}',
  3, true),

('a0000001-0000-0000-0000-000000000004', 'Health & Wellness', 'health-wellness', 'heart-pulse',
  '{"th":"สุขภาพและความเป็นอยู่ที่ดี","en":"Health & Wellness","my":"ကျန်းမာရေးနှင့်ကောင်းကျိုး"}',
  'Supplements, vitamins, traditional remedies, and wellness products',
  '{"th":"อาหารเสริม วิตามิน สมุนไพร และผลิตภัณฑ์สุขภาพ","en":"Supplements, vitamins, traditional remedies, and wellness products","my":"ဖြည့်စွက်စားသောက်ကုန်၊ ဗိတာမင်၊ ရိုးရာဆေးနည်းများနှင့် ကျန်းမာရေးထုတ်ကုန်များ"}',
  4, true),

('a0000001-0000-0000-0000-000000000005', 'Fashion', 'fashion', 'shirt',
  '{"th":"แฟชั่น","en":"Fashion","my":"ဖက်ရှင်"}',
  'Clothing for men, women, and children',
  '{"th":"เสื้อผ้าสำหรับผู้ชาย ผู้หญิง และเด็ก","en":"Clothing for men, women, and children","my":"အမျိုးသား၊ အမျိုးသမီးနှင့် ကလေးများအတွက်အဝတ်အထည်"}',
  5, true),

('a0000001-0000-0000-0000-000000000006', 'Shoes & Bags', 'shoes-bags', 'footprints',
  '{"th":"รองเท้าและกระเป๋า","en":"Shoes & bags","my":"ဖိနပ်နှင့်အိတ်များ"}',
  'Footwear, handbags, backpacks, and travel bags',
  '{"th":"รองเท้า กระเป๋าถือ กระเป๋าเป้ และกระเป๋าเดินทาง","en":"Footwear, handbags, backpacks, and travel bags","my":"ဖိနပ်၊ လက်ကိုင်အိတ်၊ ပုခုံးကျောအိတ်နှင့် ခရီးဆောင်အိတ်များ"}',
  6, true),

('a0000001-0000-0000-0000-000000000007', 'Jewelry & Accessories', 'jewelry-accessories', 'gem',
  '{"th":"เครื่องประดับและแอคเซสเซอรี่","en":"Jewelry & accessories","my":"ရတနာနှင့်ဖက်ရှင်ပစ္စည်းများ"}',
  'Rings, necklaces, watches, and fashion accessories',
  '{"th":"แหวน สร้อยคอ นาฬิกา และเครื่องประดับแฟชั่น","en":"Rings, necklaces, watches, and fashion accessories","my":"လက်စွပ်၊ လည်ဆွဲ၊ နာရီနှင့် ဖက်ရှင်အဆင်တန်ဆာများ"}',
  7, true),

('a0000001-0000-0000-0000-000000000008', 'Electronics', 'electronics', 'cpu',
  '{"th":"อิเล็กทรอนิกส์","en":"Electronics","my":"အီလက်ထရွန်နစ်ပစ္စည်းများ"}',
  'Gadgets, audio, cameras, and electronic accessories',
  '{"th":" gadgets เสียง กล้อง และอุปกรณ์เสริมอิเล็กทรอนิกส์","en":"Gadgets, audio, cameras, and electronic accessories","my":"ဂက်ဂျက်၊ အသံ၊ ကင်မရာနှင့် အီလက်ထရွန်နစ်ဖြည့်စွက်ပစ္စည်းများ"}',
  8, true),

('a0000001-0000-0000-0000-000000000009', 'Phones & Accessories', 'phones-accessories', 'smartphone',
  '{"th":"โทรศัพท์มือถือและอุปกรณ์เสริม","en":"Phones & accessories","my":"ဖုန်းနှင့်ဖြည့်စွက်ပစ္စည်းများ"}',
  'Smartphones, cases, chargers, and phone accessories',
  '{"th":"สมาร์ทโฟน เคส ที่ชาร์จ และอุปกรณ์เสริมโทรศัพท์","en":"Smartphones, cases, chargers, and phone accessories","my":"စမတ်ဖုန်း၊ ဖုန်းအိတ်၊ အားသွင်းကိရိယာနှင့် ဖုန်းဖြည့်စွက်ပစ္စည်းများ"}',
  9, true),

('a0000001-0000-0000-0000-000000000010', 'Computers & Accessories', 'computers-accessories', 'monitor',
  '{"th":"คอมพิวเตอร์และอุปกรณ์เสริม","en":"Computers & accessories","my":"ကွန်ပျူတာနှင့်ဖြည့်စွက်ပစ္စည်းများ"}',
  'Laptops, desktops, peripherals, and computer accessories',
  '{"th":"แล็ปท็อป เดสก์ท็อป อุปกรณ์ต่อพ่วง และอุปกรณ์เสริมคอมพิวเตอร์","en":"Laptops, desktops, peripherals, and computer accessories","my":"လက်တော့ပ်၊ ဒက်စ်တော့၊ ပြင်ပကိရိယာများနှင့် ကွန်ပျူတာဖြည့်စွက်ပစ္စည်းများ"}',
  10, true),

('a0000001-0000-0000-0000-000000000011', 'Home Appliances', 'home-appliances', 'washing-machine',
  '{"th":"เครื่องใช้ไฟฟ้าภายในบ้าน","en":"Home appliances","my":"အိမ်သုံးလျှပ်စစ်ပစ္စည်းများ"}',
  'Kitchen appliances, washing machines, and home electronics',
  '{"th":"เครื่องใช้ไฟฟ้าในครัว เครื่องซักผ้า และอิเล็กทรอนิกส์ภายในบ้าน","en":"Kitchen appliances, washing machines, and home electronics","my":"မီးဖိုချောင်သုံးပစ္စည်း၊ အဝတ်လျှော်စက်နှင့် အိမ်သုံးအီလက်ထရွန်နစ်ပစ္စည်းများ"}',
  11, true),

('a0000001-0000-0000-0000-000000000012', 'Home & Living', 'home-living', 'home',
  '{"th":"บ้านและไลฟ์สไตล์","en":"Home & living","my":"အိမ်နှင့်နေထိုင်မှု"}',
  'Furnishings, decor, bedding, and home essentials',
  '{"th":"เครื่องเรือน การตกแต่ง ผ้าปูที่นอน และสิ่งจำเป็นในบ้าน","en":"Furnishings, decor, bedding, and home essentials","my":"အိမ်ဆောက်ပစ္စည်း၊ အလှဆင်ပစ္စည်း၊ အိပ်ရာခင်းနှင့် အိမ်လိုအပ်ချက်များ"}',
  12, true),

('a0000001-0000-0000-0000-000000000013', 'Furniture', 'furniture', 'armchair',
  '{"th":"เฟอร์นิเจอร์","en":"Furniture","my":"ဖာနီကျားပစ္စည်းများ"}',
  'Sofas, tables, chairs, beds, and storage furniture',
  '{"th":"โซฟา โต๊ะ เก้าอี้ เตียง และเฟอร์นิเจอร์จัดเก็บ","en":"Sofas, tables, chairs, beds, and storage furniture","my":"ဆိုဖာ၊ စားပွဲ၊ ကုလားထိုင်၊ အိပ်ရာနှင့် သိုလှောင်ဖာနီကျားပစ္စည်းများ"}',
  13, true),

('a0000001-0000-0000-0000-000000000014', 'Garden & Outdoor', 'garden-outdoor', 'flower-2',
  '{"th":"สวนและกลางแจ้ง","en":"Garden & outdoor","my":"ဥယျာဉ်နှင့်ပြင်ပ"}',
  'Gardening tools, outdoor furniture, and plants',
  '{"th":"เครื่องมือทำสวน เฟอร์นิเจอร์กลางแจ้ง และต้นไม้","en":"Gardening tools, outdoor furniture, and plants","my":"ဥယျာဉ်ကိရိယာများ၊ ပြင်ပဖာနီကျားပစ္စည်းများနှင့် အပင်များ"}',
  14, true),

('a0000001-0000-0000-0000-000000000015', 'Baby & Kids', 'baby-kids', 'baby',
  '{"th":"ทารกและเด็ก","en":"Baby & kids","my":"ကလေးနှင့်မွေးကင်းစပစ္စည်းများ"}',
  'Baby gear, children clothing, toys, and nursery essentials',
  '{"th":"อุปกรณ์ทารก เสื้อผ้าเด็ก ของเล่น และสิ่งจำเป็นสำหรับทารก","en":"Baby gear, children clothing, toys, and nursery essentials","my":"ကလေးသုံးပစ္စည်း၊ ကလေးအဝတ်အထည်၊ ကစားကွင်းနှင့် မွေးကင်းစလိုအပ်ချက်များ"}',
  15, true),

('a0000001-0000-0000-0000-000000000016', 'Toys & Games', 'toys-games', 'gamepad-2',
  '{"th":"ของเล่นและเกม","en":"Toys & games","my":"ကစားကွင်းနှင့်ဂိမ်းများ"}',
  'Board games, action figures, puzzles, and electronic games',
  '{"th":"เกมกระดาน ตัวละคร จิ๊กซอว์ และเกมอิเล็กทรอนิกส์","en":"Board games, action figures, puzzles, and electronic games","my":"ဘုတ်ဂိမ်း၊ ဇာတ်ကောင်ပုံများ၊ ဂျီဂျာဂိမ်းနှင့် အီလက်ထရွန်နစ်ဂိမ်းများ"}',
  16, true),

('a0000001-0000-0000-0000-000000000017', 'Pets', 'pets', 'paw-print',
  '{"th":"สัตว์เลี้ยง","en":"Pets","my":"အိမ်မွေးတိရစ္ဆာန်"}',
  'Pet food, accessories, grooming, and pet care',
  '{"th":"อาหารสัตว์เลี้ยง อุปกรณ์ ผลิตภัณฑ์ดูแลขน และการดูแลสัตว์เลี้ยง","en":"Pet food, accessories, grooming, and pet care","my":"အိမ်မွေးတိရစ္ဆာန်အစားအစာ၊ ဖြည့်စွက်ပစ္စည်းများ၊ ဆံပင်ပြုစုခြင်းနှင့် တိရစ္ဆာန်စောင့်ရှောက်မှု"}',
  17, true),

('a0000001-0000-0000-0000-000000000018', 'Sports & Outdoors', 'sports-outdoors', 'dumbbell',
  '{"th":"กีฬาและกลางแจ้ง","en":"Sports & outdoors","my":"အားကစားနှင့်ပြင်ပ"}',
  'Fitness equipment, outdoor gear, and sportswear',
  '{"th":"อุปกรณ์ออกกำลังกาย อุปกรณ์กลางแจ้ง และชุดกีฬา","en":"Fitness equipment, outdoor gear, and sportswear","my":"ကိရိယာများ၊ ပြင်ပပစ္စည်းများနှင့် အားကစားဝတ်စုံများ"}',
  18, true),

('a0000001-0000-0000-0000-000000000019', 'Automotive', 'automotive', 'car',
  '{"th":"ยานยนต์","en":"Automotive","my":"ကားနှင့်ဆက်စပ်ပစ္စည်းများ"}',
  'Car accessories, parts, and automotive supplies',
  '{"th":"อุปกรณ์เสริมรถยนต์ อะไหล่ และผลิตภัณฑ์ยานยนต์","en":"Car accessories, parts, and automotive supplies","my":"ကားဖြည့်စွက်ပစ္စည်းများ၊ အစိတ်အပိုင်းများနှင့် ကားဆက်စပ်ပစ္စည်းများ"}',
  19, true),

('a0000001-0000-0000-0000-000000000020', 'Tools & Hardware', 'tools-hardware', 'wrench',
  '{"th":"เครื่องมือและฮาร์ดแวร์","en":"Tools & hardware","my":"ကိရိယာများနှင့် hardware"}',
  'Power tools, hand tools, and building hardware',
  '{"th":"เครื่องมือไฟฟ้า เครื่องมือมือ และฮาร์ดแวร์ก่อสร้าง","en":"Power tools, hand tools, and building hardware","my":"လျှပ်စစ်ကိရိယာများ၊ လက်ကိရိယာများနှင့် ဆောက်လုပ်ရေး hardware"}',
  20, true),

('a0000001-0000-0000-0000-000000000021', 'Stationery & Office', 'stationery-office', 'pen-tool',
  '{"th":"เครื่องเขียนและสำนักงาน","en":"Stationery & office","my":"ရုံးသုံးပစ္စည်းများ"}',
  'Office supplies, notebooks, pens, and desk accessories',
  '{"th":"อุปกรณ์สำนักงาน สมุด ปากกา และอุปกรณ์บนโต๊ะทำงาน","en":"Office supplies, notebooks, pens, and desk accessories","my":"ရုံးသုံးပစ္စည်း၊ မှတ်စုစာအုပ်၊ ဘောပင်နှင့် စားပွဲပေါ်ဖြည့်စွက်ပစ္စည်းများ"}',
  21, true),

('a0000001-0000-0000-0000-000000000022', 'Business Equipment', 'business-equipment', 'briefcase',
  '{"th":"อุปกรณ์ธุรกิจ","en":"Business equipment","my":"စီးပွားရေးကိရိယာများ"}',
  'Printers, POS systems, and commercial equipment',
  '{"th":"เครื่องพิมพ์ ระบบ POS และอุปกรณ์เชิงพาณิชย์","en":"Printers, POS systems, and commercial equipment","my":"ပရင်တာ၊ POS စနစ်နှင့် ကုန်သွယ်ရေးကိရိယာများ"}',
  22, true),

('a0000001-0000-0000-0000-000000000023', 'Packaging', 'packaging', 'package',
  '{"th":"บรรจุภัณฑ์","en":"Packaging","my":"ထုပ်ပိုးပစ္စည်းများ"}',
  'Boxes, bags, wraps, and shipping supplies',
  '{"th":"กล่อง ถุง ห่อ และอุปกรณ์จัดส่ง","en":"Boxes, bags, wraps, and shipping supplies","my":"ဘူးအိတ်၊ အိတ်၊ ထုပ်ပိုးပစ္စည်းနှင့် ပို့ဆောင်ရေးပစ္စည်းများ"}',
  23, true),

('a0000001-0000-0000-0000-000000000024', 'Books & Media', 'books-media', 'book-open',
  '{"th":"หนังสือและสื่อ","en":"Books & media","my":"စာအုပ်နှင့်မီဒီယာ"}',
  'Books, magazines, music, movies, and digital media',
  '{"th":"หนังสือ นิตยสาร ดนตรี ภาพยนตร์ และสื่อดิจิทัล","en":"Books, magazines, music, movies, and digital media","my":"စာအုပ်၊ မဂ္ဂဇင်း၊ တေးဂီတ၊ ရုပ်ရှင်နှင့် ဒီဇိုင်းမီဒီယာ"}',
  24, true),

('a0000001-0000-0000-0000-000000000025', 'Hobbies & Collectibles', 'hobbies-collectibles', 'stamp',
  '{"th":"งานอดิเรกและของสะสม","en":"Hobbies & collectibles","my":"အပန်းဖြေနှင့်စုဆောင်းပစ္စည်းများ"}',
  'Collectibles, crafts,模型, and hobby supplies',
  '{"th":"ของสะสม งานฝีมือ โมเดล และอุปกรณ์งานอดิเรก","en":"Collectibles, crafts, models, and hobby supplies","my":"စုဆောင်းပစ္စည်း၊ လက်မှုပညာ၊ မော်ဒယ်နှင့် အပန်းဖြေပစ္စည်းများ"}',
  25, true),

('a0000001-0000-0000-0000-000000000026', 'Agriculture', 'agriculture', 'sprout',
  '{"th":"เกษตรกรรม","en":"Agriculture","my":"စိုက်ပျိုးရေး"}',
  'Seeds, fertilizers, farming tools, and agricultural products',
  '{"th":"เมล็ดพันธุ์ ปุ๋ย เครื่องมือทำไร่ และผลิตภัณฑ์เกษตร","en":"Seeds, fertilizers, farming tools, and agricultural products","my":"မျိုးစေ့၊ ဓာတ်မြေဩဇာ၊ စိုက်ပျိုးကိရိယာများနှင့် စိုက်ပျိုးထုတ်ကုန်များ"}',
  26, true),

('a0000001-0000-0000-0000-000000000027', 'Local Products', 'local-products', 'map-pin',
  '{"th":"สินค้าท้องถิ่น","en":"Local products","my":"ဒေသထုတ်ကုန်များ"}',
  'OTOP, local specialties, and regional products',
  '{"th":"สินค้า OTOP ของดีประจำถิ่น และสินค้าภูมิภาค","en":"OTOP, local specialties, and regional products","my":"OTOP၊ ဒေသထုတ်ကုန်နှင့် ဒေသအလိုက်ထုတ်ကုန်များ"}',
  27, true),

('a0000001-0000-0000-0000-000000000028', 'Services', 'services', 'headphones',
  '{"th":"บริการ","en":"Services","my":"ဝန်ဆောင်မှုများ"}',
  'Digital services, subscriptions, and professional services',
  '{"th":"บริการดิจิทัล การสมัครสมาชิก และบริการระดับมืออาชีพ","en":"Digital services, subscriptions, and professional services","my":"ဒီဂျစ်တယ်ဝန်ဆောင်မှု၊ အသင်းဝင်မှုနှင့် ပညာရှင်ဝန်ဆောင်မှုများ"}',
  28, true),

('a0000001-0000-0000-0000-000000000029', 'Other', 'other', 'package',
  '{"th":"อื่น ๆ","en":"Other","my":"အခြား"}',
  'Miscellaneous products that do not fit other categories',
  '{"th":"สินค้าอื่น ๆ ที่ไม่จัดอยู่ในหมวดหมู่อื่น","en":"Miscellaneous products that do not fit other categories","my":"အခြားအမျိုးအစားများတွင်မပါဝင်သော ထုတ်ကုန်များ"}',
  29, true)

ON CONFLICT (slug) DO UPDATE SET
  names = EXCLUDED.names,
  description = EXCLUDED.description,
  description_names = EXCLUDED.description_names,
  icon = EXCLUDED.icon,
  image_url = EXCLUDED.image_url,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();

-- ── Phase 4b: Seed subcategories ───────────────────────────────────────────

-- Food & Beverage subcategories
INSERT INTO categories (id, name, slug, parent_id, names, sort_order, is_active) VALUES
('b0000001-0001-0000-0000-000000000001', 'Coffee', 'coffee', 'a0000001-0000-0000-0000-000000000001',
  '{"th":"กาแฟ","en":"Coffee","my":"ကော်ဖီ"}', 1, true),
('b0000001-0001-0000-0000-000000000002', 'Tea', 'tea', 'a0000001-0000-0000-0000-000000000001',
  '{"th":"ชา","en":"Tea","my":"လက်ဖက်ရည်"}', 2, true),
('b0000001-0001-0000-0000-000000000003', 'Snacks', 'snacks', 'a0000001-0000-0000-0000-000000000001',
  '{"th":"ขนมขบเคี้ยว","en":"Snacks","my":"မုန့်စား"}', 3, true),
('b0000001-0001-0000-0000-000000000004', 'Beverages', 'beverages', 'a0000001-0000-0000-0000-000000000001',
  '{"th":"เครื่องดื่ม","en":"Beverages","my":"ဖျော်ရည်"}', 4, true),
('b0000001-0001-0000-0000-000000000005', 'Cooking Ingredients', 'cooking-ingredients', 'a0000001-0000-0000-0000-000000000001',
  '{"th":"วัตถุดิบปรุงอาหาร","en":"Cooking Ingredients","my":"ချက်ပြုတ်ပစ္စည်းများ"}', 5, true),

-- Beauty subcategories
('b0000001-0002-0000-0000-000000000001', 'Skincare', 'skincare', 'a0000001-0000-0000-0000-000000000003',
  '{"th":"ดูแลผิว","en":"Skincare","my":"အသားအရေပြုစုခြင်း"}', 1, true),
('b0000001-0002-0000-0000-000000000002', 'Makeup', 'makeup', 'a0000001-0000-0000-0000-000000000003',
  '{"th":"เครื่องสำอาง","en":"Makeup","my":"မိတ်ကပ်"}', 2, true),
('b0000001-0002-0000-0000-000000000003', 'Haircare', 'haircare', 'a0000001-0000-0000-0000-000000000003',
  '{"th":"ดูแลเส้นผม","en":"Haircare","my":"ဆံပင်ပြုစုခြင်း"}', 3, true),

-- Electronics subcategories
('b0000001-0008-0000-0000-000000000001', 'Audio', 'audio-electronics', 'a0000001-0000-0000-0000-000000000008',
  '{"th":"เสียง","en":"Audio","my":"အသံ"}', 1, true),
('b0000001-0008-0000-0000-000000000002', 'Cameras', 'cameras', 'a0000001-0000-0000-0000-000000000008',
  '{"th":"กล้อง","en":"Cameras","my":"ကင်မရာများ"}', 2, true),

-- Fashion subcategories
('b0000001-0005-0000-0000-000000000001', 'Men\'s Clothing', 'mens-clothing', 'a0000001-0000-0000-0000-000000000005',
  '{"th":"เสื้อผ้าผู้ชาย","en":"Men\'s clothing","my":"အမျိုးသားအဝတ်အထည်"}', 1, true),
('b0000001-0005-0000-0000-000000000002', 'Women\'s Clothing', 'womens-clothing', 'a0000001-0000-0000-0000-000000000005',
  '{"th":"เสื้อผ้าผู้หญิง","en":"Women\'s clothing","my":"အမျိုးသမီးအဝတ်အထည်"}', 2, true),
('b0000001-0005-0000-0000-000000000003', 'Children\'s Clothing', 'childrens-clothing', 'a0000001-0000-0000-0000-000000000005',
  '{"th":"เสื้อผ้าเด็ก","en":"Children\'s clothing","my":"ကလေးအဝတ်အထည်"}', 3, true),

-- Phones subcategories
('b0000001-0009-0000-0000-000000000001', 'Smartphones', 'smartphones', 'a0000001-0000-0000-0000-000000000009',
  '{"th":"สมาร์ทโฟน","en":"Smartphones","my":"စမတ်ဖုန်းများ"}', 1, true),
('b0000001-0009-0000-0000-000000000002', 'Cases & Covers', 'cases-covers', 'a0000001-0000-0000-0000-000000000009',
  '{"th":"เคสและฝาครอบ","en":"Cases & covers","my":"ဖုန်းအိတ်များ"}', 2, true),
('b0000001-0009-0000-0000-000000000003', 'Chargers & Cables', 'chargers-cables', 'a0000001-0000-0000-0000-000000000009',
  '{"th":"ที่ชาร์จและสายไฟ","en":"Chargers & cables","my":"အားသွင်းကိရိယာနှင့်ကြိုးများ"}', 3, true)

ON CONFLICT (slug) DO UPDATE SET
  names = EXCLUDED.names,
  parent_id = EXCLUDED.parent_id,
  is_active = EXCLUDED.is_active,
  sort_order = EXCLUDED.sort_order,
  updated_at = NOW();
