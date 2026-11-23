import { Pool } from "@neondatabase/serverless";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const pool = new Pool({ connectionString: dbUrl });

async function seed() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. User
    const userRes = await client.query(`
      INSERT INTO users (id, email, name, role, status)
      VALUES ('00000000-0000-0000-0001-000000000001', 'official@velnox.live', 'Velnox Official Store', 'seller', 'active')
      ON CONFLICT (email) DO UPDATE SET role = 'seller'
      RETURNING id;
    `);
    const userId = userRes.rows[0].id;

    // 2. Seller
    const sellerRes = await client.query(`
      INSERT INTO sellers (id, user_id, business_name, business_type, verification_status)
      VALUES ('00000000-0000-0000-0002-000000000001', $1, 'Velnox Flagship Retail Co., Ltd.', 'juristic', 'verified')
      ON CONFLICT (id) DO NOTHING
      RETURNING id;
    `, [userId]);
    const sellerId = sellerRes.rows[0]?.id || "00000000-0000-0000-0002-000000000001";

    // 3. Shop
    const shopRes = await client.query(`
      INSERT INTO shops (id, seller_id, name, slug, description, logo_url, rating, status)
      VALUES (
        '00000000-0000-0000-0003-000000000001',
        $1,
        'Velnox Official Flagship Store',
        'velnox-official',
        'ร้านค้าทางการ Velnox Official สินค้าของแท้ 100% รับประกันศูนย์ไทย จัดส่งรวดเร็วทั่วประเทศ',
        'https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/brand/logo.png',
        4.95,
        'active'
      )
      ON CONFLICT (slug) DO UPDATE SET status = 'active'
      RETURNING id;
    `, [sellerId]);
    const shopId = shopRes.rows[0]?.id || "00000000-0000-0000-0003-000000000001";

    // 4. Products
    const products = [
      {
        id: "00000000-0000-0000-0004-000000000001",
        categoryId: "00000000-0000-0000-0000-000000000002", // Smartphones
        name: "Velnox Pro Max Smartphone 256GB (5G)",
        slug: "velnox-pro-max-smartphone-256gb",
        description: "สมาร์ทโฟนระดับเรือธง หน้าจอ Super AMOLED 120Hz ชิปประมวลผลทรงพลัง กล้องความละเอียดสูง 108MP พร้อมระบบชาร์จไว 67W",
        price: 2990000, // 29,900 THB
        originalPrice: 3290000,
        image: "https://images.unsplash.com/photo-1592750475338-74b7b21085ab?w=600&auto=format&fit=crop&q=80",
        rating: 4.9,
        reviewCount: 128
      },
      {
        id: "00000000-0000-0000-0004-000000000002",
        categoryId: "00000000-0000-0000-0000-000000000003", // Computers
        name: "Velnox UltraBook Air 15.6-inch M3",
        slug: "velnox-ultrabook-air-15-inch",
        description: "แล็ปท็อปบางเบา ประสิทธิภาพสูง หน้าจอคมชัดระดับ Retina แบตเตอรี่ใช้งานได้ยาวนาน 18 ชั่วโมง น้ำหนักเพียง 1.2 กก.",
        price: 3490000, // 34,900 THB
        originalPrice: 3890000,
        image: "https://images.unsplash.com/photo-1517336714731-489689fd1ca8?w=600&auto=format&fit=crop&q=80",
        rating: 4.8,
        reviewCount: 95
      },
      {
        id: "00000000-0000-0000-0004-000000000003",
        categoryId: "00000000-0000-0000-0000-000000000005", // Men Fashion
        name: "เสื้อยืดคอตตอนแท้ 100% Minimalist Premium Tee",
        slug: "minimalist-premium-cotton-tshirt",
        description: "เสื้อยืดคอตตอนแท้เกรดพรีเมียม ผ้านุ่ม ใส่สบาย ระบายอากาศได้ดี ไม่หด ไม่ย้วย เหมาะกับทุกโอกาส",
        price: 49000, // 490 THB
        originalPrice: 69000,
        image: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?w=600&auto=format&fit=crop&q=80",
        rating: 4.7,
        reviewCount: 230
      },
      {
        id: "00000000-0000-0000-0004-000000000004",
        categoryId: "00000000-0000-0000-0000-000000000007", // Home & Living
        name: "เก้าอี้เพื่อสุขภาพ Ergonomic Mesh Chair Pro",
        slug: "ergonomic-mesh-chair-pro",
        description: "เก้าอี้ทำงานเพื่อสุขภาพ ปรับระดับได้ทุกทิศทาง รองรับแผ่นหลังระบายอากาศ ลดอาการปวดเมื่อยจากการนั่งทำงานนานๆ",
        price: 459000, // 4,590 THB
        originalPrice: 599000,
        image: "https://images.unsplash.com/photo-1580481077195-c3a821a5060f?w=600&auto=format&fit=crop&q=80",
        rating: 4.9,
        reviewCount: 312
      },
      {
        id: "00000000-0000-0000-0004-000000000005",
        categoryId: "00000000-0000-0000-0000-000000000008", // Health & Beauty
        name: "เจลว่านหางจระเข้บริสุทธิ์ Organic Aloe Vera Soothing Gel 300ml",
        slug: "organic-aloe-vera-soothing-gel",
        description: "เจลบำรุงผิวว่านหางจระเข้ออร์แกนิก 100% เติมความชุ่มชื้น ลดรอยแดง ปลอบประโลมผิวหลังออกแดด อ่อนโยนต่อทุกสภาพผิว",
        price: 18900, // 189 THB
        originalPrice: 25000,
        image: "https://images.unsplash.com/photo-1556228720-195a672e8a03?w=600&auto=format&fit=crop&q=80",
        rating: 4.8,
        reviewCount: 420
      }
    ];

    for (const p of products) {
      const pRes = await client.query(`
        INSERT INTO products (
          id, shop_id, category_id, name, slug, description,
          price, original_price, currency, total_quantity, reserved_quantity,
          status, images, primary_image_url, rating, review_count
        )
        VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, 'THB', 100, 0,
          'published', $9::jsonb, $10, $11, $12
        )
        ON CONFLICT (slug) DO UPDATE SET
          price = EXCLUDED.price,
          status = 'published',
          primary_image_url = EXCLUDED.primary_image_url
        RETURNING id;
      `, [
        p.id, shopId, p.categoryId, p.name, p.slug, p.description,
        p.price, p.originalPrice, JSON.stringify([p.image]), p.image, p.rating, p.reviewCount
      ]);

      await client.query(`
        INSERT INTO product_variants (id, product_id, name, sku, price, stock)
        VALUES (gen_random_uuid(), $1, 'Default', $2, $3, 100)
        ON CONFLICT DO NOTHING;
      `, [pRes.rows[0].id, p.slug.slice(0, 10).toUpperCase(), p.price]);
    }

    await client.query("COMMIT");
    console.log("Successfully seeded 5 showcase products into Neon DB!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Seed error:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
