import { Logo } from "@velnox/shared/components/Logo";
// Mobile navigation removed — VelCenter uses top tab strip on all breakpoints
import { UserMenu } from "@velnox/shared/components/UserMenu";
import AuditLogTab from "../components/AuditLogTab";
import { emitCenterEvent, onCenterEvent } from "../lib/center-events";
// VerificationReviewDialog is now used inside SellerVerificationQueue component
import CategoriesManagement from "../components/CategoriesManagement";
import ProductModerationQueue from "../components/ProductModerationQueue";
import SellerVerificationQueue from "../components/SellerVerificationQueue";
import { VBadge, VerificationStatusLabel } from "@velnox/shared/components/VBadge";
import ChangePasswordScreen from "../components/ChangePasswordScreen";
import EmployeeManager from "../components/EmployeeManager";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@velnox/shared/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@velnox/shared/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@velnox/shared/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@velnox/shared/components/ui/table";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { api } from "@velnox/shared/lib/api-routes";
import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES } from "@velnox/shared/lib/i18n/config";
import { useLanguage } from "@velnox/shared/lib/i18n";
// Id type replaced with string
import { useAuth } from "@velnox/shared/hooks/use-auth";
import {
  resolveCategoryMeta,
  STATUS_META,
  DAY_MS,
  effectiveCycleDays,
  formatDays,
  formatNumber,
  formatThaiDate,
  reorderInfo,
  type Product,
} from "@velnox/shared/lib/reorder";
import {
  ORDER_STATUS_META,
  ROLE_META,
  formatBaht,
  shortOrderId,
  type CenterOrderStatus,
} from "@velnox/shared/lib/shop";
import { useAction, useMutation, useQuery } from "@velnox/shared/lib/api-routes";
import {
  AlertTriangle,
  BadgeCheck,
  Boxes,
  BrainCircuit,
  Coins,
  Crown,
  Globe,
  History,
  Image as ImageIcon,
  KeyRound,
  Loader2,
  Package,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Tag,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

type Tab = "overview" | "orders" | "intel" | "products" | "sellers" | "categories" | "staff" | "audit" | "settings";

const DEPARTMENTS: { id: string; label: string }[] = [
  { id: "general", label: "ทั่วไป" },
  { id: "marketing", label: "การตลาด" },
  { id: "sales", label: "ฝ่ายขาย" },
  { id: "operations", label: "ปฏิบัติการ" },
  { id: "finance", label: "การเงิน" },
];

const DEPARTMENT_LABEL: Record<string, string> = {
  general: "ทั่วไป",
  marketing: "การตลาด",
  sales: "ฝ่ายขาย",
  operations: "ปฏิบัติการ",
  finance: "การเงิน",
};

/**
 * Company / system settings sections. Each entry is backed by a REAL source:
 * `company` and `marketplace` write platform_settings; the rest display values
 * the backend owns (money policy, upload limits) read-only.
 */
const SETTINGS_SECTIONS = [
  { id: "company", label: "บริษัท / แพลตฟอร์ม", icon: Store },
  { id: "marketplace", label: "ตลาด & การอนุมัติ", icon: Package },
  { id: "commission", label: "ค่าธรรมเนียมผู้ขาย", icon: Coins },
  { id: "localization", label: "ภาษา & ท้องถิ่น", icon: Globe },
  { id: "media", label: "ไฟล์ & สื่อ", icon: ImageIcon },
  { id: "access", label: "สิทธิ์การเข้าถึง", icon: KeyRound },
] as const;

/**
 * velcenter permission model (company-only):
 * - owner:  everything, including managing employees
 * - admin:  business data + the customer directory, but NO employee management
 *           (department-scoped in production; e.g. marketing admin)
 * - staff:  view business numbers only (overview / orders / intel / products)
 *
 * These rules only decide which tabs are OFFERED. Every endpoint behind them
 * re-checks the role AND the permission server-side, so hiding a tab is UX,
 * never authorization.
 */
function canSeeTab(
  tab: Tab,
  role?: string | null,
  department?: string | null,
  permissions?: string[] | null,
): boolean {
  switch (tab) {
    case "overview":
    case "orders":
    case "intel":
    case "products":
    case "sellers":
      return true;

    case "categories":
      return role === "owner" || role === "admin";
    // Staff accounts are managed by the owner; the customer directory is
    // readable by owner and admin. Both endpoints re-check the role.
    case "staff":
      return role === "owner" || role === "admin";
    // owner/admin hold every permission code; a `staff` member needs
    // `audit.view` granted (the same code GET /api/admin/audit-logs checks).
    case "audit":
      return role === "owner" || role === "admin" || (permissions ?? []).includes("audit.view");
    case "settings":
      return role === "owner" || (role === "admin" && department === "general");
  }
}

interface MarketInsights {
  topSearches: { q: string; count: number }[];
  topCategories: { category: string; label: string; count: number }[];
  popularProducts: { product: { id: string; name: string; price: number; unit: string; primaryImage?: { displayUrl: string } | null }; views: number }[];
  eventCount: number;
  windowDays: number;
}

export default function Center() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { t } = useLanguage();
  const userRole = user?.role;
  const userDepartment = user?.department;

  const isOwner = userRole === "owner";
  const canManageOrders = userRole !== "staff";
  const userPermissions = user?.permissions;

  // Tab visibility, resolved from role + department + the permissions the
  // backend resolved for this session.
  const canSee = (target: Tab) => canSeeTab(target, userRole, userDepartment, userPermissions);

  // Tabs are URL-driven (?tab=orders) so the mobile bottom nav and the desktop
  // tab strip stay in sync, and every view is shareable/deep-linkable.
  const [searchParams, setSearchParams] = useSearchParams();
  const urlTab = (searchParams.get("tab") as Tab | null) ?? "overview";
  const tab: Tab = canSee(urlTab) ? urlTab : "overview";
  const setTab = (next: Tab) => {
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        params.set("tab", next);
        return params;
      },
      { replace: true },
    );
  };

// CPNS: aggregate marketplace interest (privacy-safe — no personal data).
  const marketInsightsAction = useAction(api.memory.marketInsights);
  const [market, setMarket] = useState<MarketInsights | null>(null);
  useEffect(() => {
    let alive = true;
    marketInsightsAction()
      .then((d) => alive && setMarket(d as unknown as MarketInsights))
      .catch(() => alive && setMarket(null));
    return () => {
      alive = false;
    };
  }, [marketInsightsAction]);

  // Goals + reorder intelligence + restocking
  // list, employees, store settings.
  const overview = useQuery(api.center.overview);
  const products = useQuery(api.products.listAll);

  // Seller applications + product moderation — the real Neon catalog
  // (spec §36–37). Approve/reject is server-checked + audit-logged.
  const sellerListAction = useAction(api.centerAdmin.sellerList);
  const setSellerStatusAction = useAction(api.centerAdmin.setSellerStatusAction);
  const productModerationAction = useAction(api.centerAdmin.productModerationList);
  const setModerationAction = useAction(api.centerAdmin.setProductModerationStatus);
  // ONE verification system: SELLER / SHOP identity verification.
  // Product verification was removed from the user workflow — there is no
  // product verification queue in VelCenter.
  const verificationsAction = useAction(api.admin.verifications);
  const [sellerRows, setSellerRows] = useState<SellerRow[] | null>(null);
  const [modProducts, setModProducts] = useState<ModProductRow[] | null>(null);
  const [rejectingSeller, setRejectingSeller] = useState<SellerRow | null>(null);
  const [rejectingProduct, setRejectingProduct] = useState<ModProductRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [modBusy, setModBusy] = useState(false);
  const [verificationRows, setVerificationRows] = useState<{ sellers: VerificationRow[]; products: VerificationRow[] } | null>(null);

  interface SellerRow {
    id: string;
    name: string;
    tax_id: string | null;
    status: string;
    business_type: string | null;
    approved_at: string | null;
    created_at: string;
    owner_id: string | null;
    owner_name: string | null;
    owner_email: string | null;
    shop_count: number;
    product_count: number;
  }
  interface ModProductRow {
    id: string;
    name: string;
    price: string;
    status: string;
    created_at: string;
    shop_name: string;
    seller_name: string;
  }
  /** Read-only platform facts returned alongside the persisted settings. */
  interface PlatformMeta {
    moderation?: { approvalMode?: string; productVerificationEnabled?: boolean };
    commission?: { sellerRate?: number; returnCoverage?: number; currency?: string; editable?: boolean };
    media?: { maxUploadBytes?: number; allowedTypes?: string[] };
    role?: string;
  }
  /** One row from GET /api/admin/users — `role` is the real DB role. */
  interface DirectoryUser {
    _id: string;
    id: string;
    email: string | null;
    name: string | null;
    role: string | null;
    department: string | null;
    status: string;
    isStaff: boolean;
    createdAt: number;
  }
  /** A seller_verifications row. Identity evidence is reviewer-only and is
   *  fetched separately as short-lived signed URLs. */
  interface VerificationRow {
    id: string;
    seller_id: string;
    status: string;
    verification_type: string | null;
    evidence_count?: number | null;
    submitted_at: string | null;
    reviewed_at: string | null;
    rejection_reason: string | null;
    suspension_reason: string | null;
    review_reason_code: string | null;
    review_note: string | null;
    shop_name: string | null;
    shop_slug: string | null;
    owner_name: string | null;
    owner_email: string | null;
    seller_status: string | null;
    verification_status: string | null;
    created_at: string | null;
    updated_at: string | null;
  }

  const reloadSellers = useCallback(async () => {
    try {
      setSellerRows(await sellerListAction());
    } catch (error) {
      console.error("Seller list error:", error);
      setSellerRows([]);
    }
  }, [sellerListAction]);
  const reloadProducts = useCallback(async () => {
    try {
      setModProducts(await productModerationAction({}));
    } catch (error) {
      console.error("Product moderation list error:", error);
      setModProducts([]);
    }
  }, [productModerationAction]);

  const reloadVerifications = useCallback(async () => {
    try {
      const [pending, verified, rejected, suspended] = await Promise.all([
        verificationsAction({ status: "pending" }),
        verificationsAction({ status: "verified" }),
        verificationsAction({ status: "rejected" }),
        verificationsAction({ status: "suspended" }),
      ]);
      // One persisted source — the same seller_verifications rows the seller wrote.
      setVerificationRows({
        sellers: [...(pending?.sellers ?? []), ...(verified?.sellers ?? []), ...(rejected?.sellers ?? []), ...(suspended?.sellers ?? [])],
        products: [],
      });
    } catch (error) {
      console.error("Verification list error:", error);
      setVerificationRows({ sellers: [], products: [] });
    }
  }, [verificationsAction]);

  useEffect(() => {
    reloadSellers();
    reloadProducts();
    reloadVerifications();
  }, [reloadSellers, reloadProducts, reloadVerifications]);

  // WebSocket realtime subscriptions for VelCenter queues
  useEffect(() => {
    const wsUrl = (import.meta.env.VITE_API_URL || "http://localhost:3001").replace(/^http/, "ws");
    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          ws?.send(JSON.stringify({ type: "subscribe", channel: "product:updated" }));
          ws?.send(JSON.stringify({ type: "subscribe", channel: "seller:updated" }));
          ws?.send(JSON.stringify({ type: "subscribe", channel: "notification:created" }));
          ws?.send(JSON.stringify({ type: "subscribe", channel: "order:updated" }));
          ws?.send(JSON.stringify({ type: "subscribe", channel: "audit:created" }));
        };
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "product:moderated" || msg.type === "product:updated") {
              void reloadProducts();
            }
            if (msg.type === "seller:status-changed" || msg.type === "verification:status-changed") {
              void reloadVerifications();
              void reloadSellers();
            }
            // Fan out to the tabs that own their own data (the product and
            // seller queues, orders, audit logs). They refetch from the API —
            // the event is only a signal that something changed.
            if (msg.type === "product:moderated" || msg.type === "product:updated") {
              emitCenterEvent("products");
            }
            if (
              msg.type === "seller:status-changed" ||
              msg.type === "verification:status-changed"
            ) {
              emitCenterEvent("sellers");
            }
            if (msg.type === "order:updated" || msg.type === "order:created") {
              emitCenterEvent("orders");
            }
            if (
              msg.type === "audit:created" ||
              msg.type === "product:moderated" ||
              msg.type === "product:updated" ||
              msg.type === "seller:status-changed" ||
              msg.type === "verification:status-changed" ||
              msg.type === "order:updated" ||
              msg.type === "order:created"
            ) {
              emitCenterEvent("audit");
            }
          } catch { /* ignore */ }
        };
        ws.onclose = () => {
          reconnectTimer = setTimeout(connect, 5000);
        };
        ws.onerror = () => { ws?.close(); };
      } catch { reconnectTimer = setTimeout(connect, 5000); }
    }

    connect();
    return () => {
      clearTimeout(reconnectTimer);
      ws?.close();
    };
  }, [reloadProducts, reloadVerifications, reloadSellers]);

  const pendingSellers = (sellerRows ?? []).filter((s) => s.status === "pending").length;
  const pendingProducts = (modProducts ?? []).filter((p) => p.status === "pending_review").length;
  const pendingVerifications =
    (verificationRows?.sellers ?? []).filter((v) => v.status === "pending").length;

  // Filter + search happen client-side over the persisted rows (a single fetch
  // per status, no N+1). The backend also supports server-side filtering.

  const handleSellerStatus = async (seller: SellerRow, status: string) => {
    // Frontend guard: cannot approve/reject own seller application
    if (seller.owner_id && seller.owner_id === user?._id && (status === "approved" || status === "rejected")) {
      toast.error("ไม่สามารถอนุมัติหรือปฏิเสธร้านของตัวเองได้");
      return;
    }
    setModBusy(true);
    try {
      await setSellerStatusAction({
        sellerId: seller.id,
        status,
        reason: rejectReason.trim() || undefined,
      });
      toast.success(status === "approved" ? "อนุมัติพ่อค้าแล้ว 🎉" : status === "rejected" ? "ปฏิเสธใบสมัครแล้ว" : "อัปเดตสถานะแล้ว");
      setRejectingSeller(null);
      setRejectReason("");
      await reloadSellers();
    } catch (error) {
      console.error("Seller status error:", error);
      toast.error(error instanceof Error ? error.message : "ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setModBusy(false);
    }
  };

  const handleProductModeration = async (product: ModProductRow, status: string) => {
    setModBusy(true);
    try {
      await setModerationAction({
        productId: product.id,
        status,
        reason: rejectReason.trim() || undefined,
      });
      toast.success(status === "published" ? "อนุมัติสินค้าแล้ว 🛍️" : "ปฏิเสธสินค้าแล้ว");
      setRejectingProduct(null);
      setRejectReason("");
      await reloadProducts();
    } catch (error) {
      console.error("Product moderation error:", error);
      toast.error(error instanceof Error ? error.message : "ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setModBusy(false);
    }
  };

  // ── People directory (spec §9–§11) ───────────────────────────────────────
  // Staff and customers are SEPARATE lists, filtered server-side by the real
  // `users.role` values — never by fuzzy matching in the browser. Role / dept
  // changes are owner-only and audit-logged server-side.
  const listUsersAction = useAction(api.users.listUsers);
  const setUserAccess = useMutation(api.users.setUserAccess);
  const [staffUsers, setStaffUsers] = useState<DirectoryUser[] | null>(null);
  const [customerUsers, setCustomerUsers] = useState<DirectoryUser[] | null>(null);
  const [peopleCounts, setPeopleCounts] = useState<{ staff: number; customer: number; seller: number }>({ staff: 0, customer: 0, seller: 0 });
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [peopleSegment, setPeopleSegment] = useState<"staff" | "customer">("staff");
  const [customerSearch, setCustomerSearch] = useState("");

  const loadPeople = useCallback(async () => {
    setPeopleError(null);
    try {
      const [staffRes, customerRes] = await Promise.all([
        listUsersAction({ segment: "staff" }),
        listUsersAction({ segment: "customer" }),
      ]);
      setStaffUsers((staffRes?.users ?? []) as DirectoryUser[]);
      setCustomerUsers((customerRes?.users ?? []) as DirectoryUser[]);
      const counts = customerRes?.counts ?? staffRes?.counts;
      if (counts) setPeopleCounts({ staff: counts.staff ?? 0, customer: counts.customer ?? 0, seller: counts.seller ?? 0 });
    } catch (error) {
      console.error("Users list error:", error);
      setPeopleError(error instanceof Error ? error.message : "โหลดรายชื่อผู้ใช้ไม่สำเร็จ");
      setStaffUsers([]);
      setCustomerUsers([]);
    }
  }, [listUsersAction]);

  useEffect(() => {
    void loadPeople();
  }, [loadPeople]);

  // Storefront settings now live in Neon platform_settings (spec §15–16) —
  // read/write through the center actions (owner/admin, audit-logged).
  // Company / system settings live in Neon `platform_settings`. The endpoint
  // returns the persisted rows PLUS backend-owned read-only meta (commission
  // policy, upload limits) so nothing here is invented client-side.
  const getPlatformSettingsAction = useAction(api.centerAdmin.getPlatformSettings);
  const updatePlatformSettingAction = useAction(api.centerAdmin.updatePlatformSettingAction);
  const permissionCatalogAction = useAction(api.centerAdmin.permissionCatalog);
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [settingsMeta, setSettingsMeta] = useState<PlatformMeta | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSection, setSettingsSection] = useState<
    "company" | "marketplace" | "commission" | "localization" | "media" | "access"
  >("company");
  const [permissionCatalog, setPermissionCatalog] = useState<{ code: string; label: string; description: string }[]>([]);

  const loadSettings = useCallback(async () => {
    try {
      const res = await getPlatformSettingsAction();
      const map: Record<string, string> = {};
      for (const s of res?.settings ?? []) map[s.key] = String(s.value ?? "");
      setSettings(map);
      setSettingsMeta((res?.meta ?? null) as PlatformMeta | null);
      setSettingsError(null);
    } catch (error) {
      console.error("Platform settings error:", error);
      setSettings(null);
      setSettingsMeta(null);
      setSettingsError(error instanceof Error ? error.message : "โหลดการตั้งค่าไม่สำเร็จ");
    }
  }, [getPlatformSettingsAction]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (!isOwner) return;
    void permissionCatalogAction()
      .then((c) => setPermissionCatalog(Array.isArray(c) ? c : []))
      .catch(() => setPermissionCatalog([]));
  }, [isOwner, permissionCatalogAction]);

  // Marketplace KPIs + orders come from the Neon commerce core (velcenter used
  // to read tables that checkout never writes → 0/wrong numbers).
  const marketOverviewAction = useAction(api.centerAdmin.marketOverviewAction);
  const ordersListAction = useAction(api.centerAdmin.ordersListAction);
  const updateOrderStatusAction = useAction(api.centerAdmin.updateOrderStatusAction);

  interface MarketOverview {
    revenue: number;
    orderCount: number;
    pendingOrders: number;
    completedOrders: number;
    productCount: number;
    publishedCount: number;
    customerCount: number;
    sellerCount: number;
  }
  interface CenterOrderItem {
    id: string;
    productName: string;
    unit: string;
    quantity: number;
    subtotal: number;
  }
  interface CenterOrderRow {
    id: string;
    orderNumber: string;
    status: string;
    createdAt: number; // epoch ms
    total: number;
    customerName: string;
    customerPhone: string;
    itemCount: number;
    shopName: string | null;
    items: CenterOrderItem[];
  }

  const [marketKpi, setMarketKpi] = useState<MarketOverview | null>(null);
  const [ordersData, setOrdersData] = useState<CenterOrderRow[] | null>(null);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [ordersError, setOrdersError] = useState<string | null>(null);

  // VelRepeat V2 monitoring (recurring commerce)
  const velRepeatOverviewAction = useAction(api.centerAdmin.velRepeatOverview);
  interface VelRepeatOverview {
    plansByStatus: Record<string, number>;
    successRuns: number;
    failedRuns: number;
    outOfStockRuns: number;
    recurringRevenue: number;
  }
  const [velRepeatKpi, setVelRepeatKpi] = useState<VelRepeatOverview | null>(null);

  const loadVelRepeat = useCallback(async () => {
    try {
      setVelRepeatKpi(await velRepeatOverviewAction());
    } catch {
      setVelRepeatKpi(null);
    }
  }, [velRepeatOverviewAction]);

  const loadMarket = useCallback(async () => {
    try {
      setMarketKpi(await marketOverviewAction());
    } catch {
      setMarketKpi(null);
    }
  }, [marketOverviewAction]);

  const loadOrders = useCallback(async () => {
    setOrdersLoading(true);
    setOrdersError(null);
    try {
      setOrdersData(await ordersListAction({ limit: 100 }));
    } catch (err) {
      // A failed request must never render as “no orders”.
      console.error("Orders list error:", err);
      setOrdersError(err instanceof Error ? err.message : "ไม่สามารถโหลดออเดอร์ได้");
      setOrdersData(null);
    } finally {
      setOrdersLoading(false);
    }
  }, [ordersListAction]);

  useEffect(() => {
    void loadMarket();
    void loadVelRepeat();
  }, [loadMarket, loadVelRepeat]);

  useEffect(() => {
    if (tab === "orders") void loadOrders();
  }, [tab, loadOrders]);

  // Realtime order changes (from any VelCenter tab) refetch the list.
  useEffect(() => onCenterEvent("orders", () => { void loadOrders(); }), [loadOrders]);

  // ---- Intelligence rows (computed from learned cycles) ----
  const intelRows = useMemo(() => {
    const list = products ?? [];
    const rows = list.map((p: any) => {
      const info = reorderInfo(p);
      const cycle = effectiveCycleDays(p);
      const predictedAt =
        p.lastOrderedAt !== undefined && cycle !== undefined
          ? p.lastOrderedAt + cycle * DAY_MS
          : undefined;
      const daysLeft =
        predictedAt !== undefined ? (predictedAt - Date.now()) / DAY_MS : undefined;
      return { product: p, info, cycle, predictedAt, daysLeft };
    });
    const rank: Record<string, number> = { due: 0, upcoming: 1, unlearned: 2, ok: 3 };
    return rows.sort((a: any, b: any) => rank[a.info.status] - rank[b.info.status]);
  }, [products]);

  const dueCount = intelRows.filter((r: any) => r.info.status === "due").length;
  const pendingOrders = (ordersData ?? []).filter((o) => o.status === "pending").length;

  // Next valid statuses per the Neon state machine (mirrors backend
  // ORDER_STATUS_TRANSITIONS) — center can only move an order forward.
  const NEXT_STATUS: Record<string, string[]> = {
    pending: ["confirmed", "cancelled"],
    confirmed: ["shipped", "cancelled"],
    shipped: ["delivered"],
    delivered: ["completed"],
    completed: [],
    cancelled: [],
  };
  const statusOptions = (current: string): string[] => [
    current,
    ...(NEXT_STATUS[current] ?? []),
  ];

  const handleOrderStatus = async (orderId: string, status: string) => {
    if (!canManageOrders) return;
    try {
      await updateOrderStatusAction({ orderId, status });
      toast.success("อัปเดตสถานะออเดอร์แล้ว");
      void loadOrders();
    } catch (error) {
      console.error("Update order status error:", error);
      toast.error(
        error instanceof Error ? error.message : "อัปเดตไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    }
  };

  const handleSetUserAccess = async (
    userId: string,
    role: "customer" | "seller" | "admin" | "owner" | "staff",
    department?: string,
  ) => {
    try {
      await setUserAccess({
        targetUserId: userId,
        role,
        department: department as
          | "general"
          | "marketing"
          | "sales"
          | "operations"
          | "finance"
          | undefined,
      });
      toast.success("อัปเดตสิทธิ์แล้ว");
      // Role changes move an account between the staff and customer lists.
      void loadPeople();
    } catch (error) {
      console.error("Set access error:", error);
      toast.error(error instanceof Error ? error.message : "อัปเดตไม่สำเร็จ");
    }
  };

  // ---- Settings form ----
  const [form, setForm] = useState({
    shopName: "",
    tagline: "",
    phone: "",
    address: "",
    announcement: "",
  });
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [approvalMode, setApprovalMode] = useState<string>("manual");
  const [savingApproval, setSavingApproval] = useState(false);

  useEffect(() => {
    if (settings && !settingsLoaded) {
      setForm({
        shopName: settings["store_shop_name"] ?? "",
        tagline: settings["store_tagline"] ?? "",
        phone: settings["store_phone"] ?? "",
        address: settings["store_address"] ?? "",
        announcement: settings["store_announcement"] ?? "",
      });
      if (settings["product_approval_mode"]) {
        setApprovalMode(settings["product_approval_mode"]);
      }
      setSettingsLoaded(true);
    }
  }, [settings, settingsLoaded]);

  const handleApprovalModeChange = async (mode: string) => {
    setSavingApproval(true);
    try {
      await updatePlatformSettingAction({ key: "product_approval_mode", value: mode });
      setApprovalMode(mode);
      toast.success(mode === "auto" ? "เปิดระบบอนุมัติอัตโนมัติแล้ว" : "ปิดระบบอนุมัติอัตโนมัติแล้ว");
    } catch (error) {
      console.error("Update approval mode error:", error);
      toast.error("ไม่สามารถเปลี่ยนโหมดอนุมัติได้");
    } finally {
      setSavingApproval(false);
    }
  };

  const handleSaveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingSettings(true);
    try {
      const entries: [string, string][] = [
        ["store_shop_name", form.shopName],
        ["store_tagline", form.tagline],
        ["store_phone", form.phone],
        ["store_address", form.address],
        ["store_announcement", form.announcement],
      ];
      // Only send what actually changed — one audited write per real change,
      // no audit noise from re-saving untouched fields.
      const changed = entries.filter(([key, value]) => (settings?.[key] ?? "") !== value.trim());
      if (changed.length === 0) {
        toast.info("ไม่มีการเปลี่ยนแปลง");
        return;
      }
      await Promise.all(changed.map(([key, value]) => updatePlatformSettingAction({ key, value: value.trim() })));
      toast.success("บันทึกการตั้งค่าระบบแล้ว");
      await loadSettings();
    } catch (error) {
      console.error("Update settings error:", error);
      toast.error(error instanceof Error ? error.message : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setSavingSettings(false);
    }
  };

  const stats = useMemo(() => {
    const o = overview; // goals + reorder intelligence
    const m = marketKpi; // marketplace KPIs (Neon commerce core — real data)
    return [
      { icon: TrendingUp, label: "ยอดขายรวม", value: m ? formatBaht(m.revenue) : "—", sub: "ออเดอร์ที่เสร็จสิ้น", accent: "text-emerald-600" },
      { icon: ShoppingBag, label: "ออเดอร์ทั้งหมด", value: m ? String(m.orderCount) : "—", sub: `${m?.pendingOrders ?? 0} รอจัดการ`, accent: "text-sky-600" },
      { icon: Target, label: "เป้าหมายสำเร็จ", value: o ? `${o.goalsAchieved}/${o.goalsTotal}` : "—", sub: "จากทั้งหมด", accent: "text-slate-700" },
      { icon: Users, label: "ลูกค้า", value: m ? String(m.customerCount) : "—", sub: "บัญชีลูกค้า", accent: "text-amber-600" },
      { icon: Store, label: "ร้านค้าอนุมัติ", value: m ? String(m.sellerCount) : "—", sub: "seller ที่ผ่านอนุมัติ", accent: "text-slate-700" },
      { icon: Package, label: "สินค้าทั้งหมด", value: m ? String(m.productCount) : "—", sub: `${m?.publishedCount ?? 0} รายการประกาศขาย`, accent: "text-slate-700" },
      { icon: Boxes, label: "สต็อกต่ำ", value: o ? String(o.lowStockCount) : "—", sub: "ถึงจุดสั่งซื้อซ้ำ", accent: "text-rose-600" },
      { icon: AlertTriangle, label: "ต้องสั่งด่วน", value: o ? String(o.dueReorderCount) : "—", sub: "เลยรอบการสั่ง", accent: "text-rose-600" },
    ];
  }, [overview, marketKpi]);

  // Customer search is local to the already-fetched customer segment.
  const filteredCustomers = useMemo(() => {
    const q = customerSearch.trim().toLowerCase();
    const list = customerUsers ?? [];
    if (!q) return list;
    return list.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q),
    );
  }, [customerUsers, customerSearch]);

  // Spec §10: an employee who was just created / reset must pick a new
  // password before the company dashboard is usable. `users.currentUser` is
  // reactive, so the gate unmounts itself once mustChangePassword flips false.
  if (user?.mustChangePassword === true) {
    return <ChangePasswordScreen />;
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2 sm:gap-5">
            <button type="button" onClick={() => navigate("/")} aria-label="velcenter">
              <Logo />
            </button>
          </div>
          <UserMenu />
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <ShieldCheck className="size-4 text-[#10B981]" />
            velcenter · ศูนย์กลางบริษัท
            {userRole && (
              <Badge className="ml-1 gap-1 rounded-full bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/15">
                {userRole === "owner" ? (
                  <>
                    <Crown className="size-3" />
                    เจ้าของบริษัท
                  </>
                ) : (
                  ROLE_META[userRole as keyof typeof ROLE_META]?.label ?? userRole
                )}
                {userDepartment && ` · ${DEPARTMENT_LABEL[userDepartment] ?? userDepartment}`}
              </Badge>
            )}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            ศูนย์ควบคุม Velnox
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            ภาพรวมทั้งบริษัท ออเดอร์ ระบบอัจฉริยะ และสิทธิ์การเข้าถึงตามยศ
          </p>
        </div>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="mt-7">
          <TabsList className="w-full justify-start overflow-x-auto rounded-[12px] border border-slate-200 bg-white p-1 sm:w-auto">
            <TabsTrigger value="overview" className="gap-1.5 rounded-[10px]">
              <TrendingUp className="size-4" /> ภาพรวม
            </TabsTrigger>
            <TabsTrigger value="orders" className="gap-1.5 rounded-[10px]">
              <ShoppingBag className="size-4" /> ออเดอร์
              {pendingOrders > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                  {pendingOrders}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="intel" className="gap-1.5 rounded-[10px]">
              <BrainCircuit className="size-4" /> Intelligence
              {dueCount > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                  {dueCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="products" className="gap-1.5 rounded-[10px]">
              <Package className="size-4" /> สินค้า
              {pendingProducts > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                  {pendingProducts}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="sellers" className="gap-1.5 rounded-[10px]">
              <Store className="size-4" /> พ่อค้า
              {pendingSellers > 0 && (
                <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">
                  {pendingSellers}
                </span>
              )}
            </TabsTrigger>
            {canSee("categories") && (
              <TabsTrigger value="categories" className="gap-1.5 rounded-[10px]">
                <Tag className="size-4" /> หมวดหมู่
              </TabsTrigger>
            )}

            {canSee("staff") && (
              <TabsTrigger value="staff" className="gap-1.5 rounded-[10px]">
                <Users className="size-4" /> ผู้ใช้ & ลูกค้า
              </TabsTrigger>
            )}
            {canSee("audit") && (
              <TabsTrigger value="audit" className="gap-1.5 rounded-[10px]">
                <History className="size-4" /> Audit Logs
              </TabsTrigger>
            )}
            {canSee("settings") && (
              <TabsTrigger value="settings" className="gap-1.5 rounded-[10px]">
                <Settings className="size-4" /> ตั้งค่าระบบ
              </TabsTrigger>
            )}
          </TabsList>

          {/* ============ Overview ============ */}
          <TabsContent value="overview" className="mt-6">
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {stats.map((s) => (
                <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                  <div className="flex items-center gap-2">
                    <s.icon className={`size-4 ${s.accent}`} />
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                      {s.label}
                    </p>
                  </div>
                  <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                    {s.value}
                  </p>
                  <p className="mt-1 text-xs text-slate-400">{s.sub}</p>
                </div>
              ))}
            </div>

            {/* Action Required */}
            {(pendingProducts > 0 || pendingSellers > 0 || pendingVerifications > 0) && (
              <Card className="mt-6 border-amber-200 bg-amber-50/50 shadow-none">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <AlertTriangle className="size-4 text-amber-500" />
                    ต้องดำเนินการ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {pendingProducts > 0 && (
                      <button type="button" onClick={() => setTab("products")} className="flex w-full items-center justify-between rounded-xl bg-white p-3 text-left transition-colors hover:border-amber-300 border border-amber-200">
                        <span className="text-sm text-slate-700">สินค้ารอตรวจสอบ</span>
                        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{pendingProducts}</span>
                      </button>
                    )}
                    {pendingSellers > 0 && (
                      <button type="button" onClick={() => setTab("sellers")} className="flex w-full items-center justify-between rounded-xl bg-white p-3 text-left transition-colors hover:border-amber-300 border border-amber-200">
                        <span className="text-sm text-slate-700">ใบสมัครพ่อค้ารอตรวจสอบ</span>
                        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{pendingSellers}</span>
                      </button>
                    )}
                    {pendingVerifications > 0 && (
                      <button type="button" onClick={() => setTab("products")} className="flex w-full items-center justify-between rounded-xl bg-white p-3 text-left transition-colors hover:border-amber-300 border border-amber-200">
                        <span className="text-sm text-slate-700">การยืนยันรอตรวจสอบ</span>
                        <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">{pendingVerifications}</span>
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="mt-6 border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="size-4 text-[#10B981]" />
                  Velnox Intelligence สรุป
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-rose-50 p-4">
                    <p className="text-xs font-medium text-rose-600">ถึงเวลาสั่งซื้อซ้ำ</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-rose-700">
                      {dueCount} รายการ
                    </p>
                  </div>
                  <div className="rounded-xl bg-emerald-50 p-4">
                    <p className="text-xs font-medium text-emerald-600">ยอดขายจาก velshop</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                      {marketKpi ? formatBaht(marketKpi.revenue) : "—"}
                    </p>
                    <p className="mt-0.5 text-xs text-emerald-600/70">
                      จากออเดอร์ที่เสร็จสิ้น {marketKpi?.completedOrders ?? 0} ออเดอร์
                    </p>
                  </div>
                  <div className="rounded-xl bg-sky-50 p-4">
                    <p className="text-xs font-medium text-sky-600">ออเดอร์รอจัดการ</p>
                    <p className="mt-1 text-2xl font-bold tabular-nums text-sky-700">
                      {marketKpi?.pendingOrders ?? 0} ออเดอร์
                    </p>
                    <p className="mt-0.5 text-xs text-sky-600/70">จัดการได้ที่แท็บ ออเดอร์</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* VelRepeat V2 — recurring commerce monitoring */}
            <Card className="mt-6 border-slate-200 shadow-none">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <RefreshCw className="size-4 text-[#10B981]" />
                  VelRepeat — การสั่งซื้ออัตโนมัติ
                </CardTitle>
              </CardHeader>
              <CardContent>
                {velRepeatKpi === null ? (
                  <p className="text-sm text-slate-400">กำลังโหลด...</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl bg-emerald-50 p-4">
                      <p className="text-xs font-medium text-emerald-600">แผนที่ใช้งานอยู่</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                        {velRepeatKpi.plansByStatus?.active ?? 0} แผน
                      </p>
                      <p className="mt-0.5 text-xs text-emerald-600/70">สำเร็จ {velRepeatKpi.successRuns ?? 0} รอบ</p>
                    </div>
                    <div className="rounded-xl bg-rose-50 p-4">
                      <p className="text-xs font-medium text-rose-600">รอบที่ล้มเหลว</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-rose-700">
                        {velRepeatKpi.failedRuns ?? 0} รอบ
                      </p>
                      <p className="mt-0.5 text-xs text-rose-600/70">สินค้าหมด {velRepeatKpi.outOfStockRuns ?? 0} รอบ</p>
                    </div>
                    <div className="rounded-xl bg-sky-50 p-4">
                      <p className="text-xs font-medium text-sky-600">ยอด recurring</p>
                      <p className="mt-1 text-2xl font-bold tabular-nums text-sky-700">
                        {formatBaht(velRepeatKpi.recurringRevenue ?? 0)}
                      </p>
                      <p className="mt-0.5 text-xs text-sky-600/70">จากออเดอร์ VelRepeat ทั้งหมด</p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ============ Orders ============ */}
          <TabsContent value="orders" className="mt-6">
            {ordersError ? (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-rose-200 bg-rose-50/60 px-6 py-12 text-center">
                <AlertTriangle className="size-6 text-rose-400" />
                <p className="text-sm text-rose-600">{ordersError}</p>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void loadOrders()}>
                  <Loader2 className="size-3.5" /> ลองใหม่
                </Button>
              </div>
            ) : ordersLoading || ordersData === null ? (
              <div className="space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white"
                  />
                ))}
              </div>
            ) : ordersData.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
                  <ShoppingBag className="size-7 text-[#10B981]" />
                </span>
                <h2 className="mt-5 text-lg font-semibold text-slate-900">ยังไม่มีออเดอร์</h2>
                <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
                  เมื่อลูกค้าสั่งซื้อจาก velshop ออเดอร์ทั้งหมดจะถูกรวมอยู่ที่นี่
                </p>
              </div>
            ) : (
              <>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                <Table className="min-w-[760px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-slate-400">ออเดอร์ / ลูกค้า</TableHead>
                      <TableHead className="text-slate-400">วันที่</TableHead>
                      <TableHead className="text-slate-400">รายการ</TableHead>
                      <TableHead className="text-right text-slate-400">ยอดรวม</TableHead>
                      <TableHead className="pr-5 text-right text-slate-400">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ordersData.map((order) => {
                      const meta =
                        ORDER_STATUS_META[order.status as CenterOrderStatus] ?? {
                          label: order.status,
                          badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
                          dot: "bg-slate-400",
                        };
                      return (
                        <TableRow key={order.id} className="hover:bg-slate-50/60">
                          <TableCell className="pl-5">
                            <p className="font-medium text-slate-900">
                              {order.orderNumber ?? shortOrderId(order.id)}
                            </p>
                            <p className="text-xs text-slate-400">
                              {order.shopName && <span className="font-medium text-slate-500">{order.shopName} · </span>}
                              {order.customerName} · {order.customerPhone}
                            </p>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm text-slate-600">{formatThaiDate(order.createdAt)}</p>
                            <p className="text-xs text-slate-400">{order.itemCount} ชิ้น</p>
                          </TableCell>
                          <TableCell>
                            <div className="max-w-56 space-y-0.5">
                              {order.items.slice(0, 2).map((item) => (
                                <p key={item.id} className="truncate text-sm text-slate-600">
                                  {item.productName} × {item.quantity} {item.unit}
                                </p>
                              ))}
                              {order.items.length > 2 && (
                                <p className="text-xs text-slate-400">+{order.items.length - 2} รายการ</p>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <p className="font-semibold tabular-nums text-slate-900">
                              {formatBaht(order.total)}
                            </p>
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            {canManageOrders ? (
                              <Select
                                value={order.status}
                                onValueChange={(v) => handleOrderStatus(order.id, v)}
                              >
                                <SelectTrigger className="ml-auto h-9 w-36 rounded-[10px] border-slate-200 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {statusOptions(order.status).map((s) => (
                                    <SelectItem key={s} value={s}>
                                      {(ORDER_STATUS_META[s as CenterOrderStatus] ?? { label: s }).label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Badge className={`gap-1.5 rounded-full ring-1 ring-inset ${meta.badge}`}>
                                <span className={`size-1.5 rounded-full ${meta.dot}`} />
                                {meta.label}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: app-like order cards */}
              <div className="space-y-3 md:hidden">
                {ordersData.map((order) => {
                  const meta =
                    ORDER_STATUS_META[order.status as CenterOrderStatus] ?? {
                      label: order.status,
                      badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
                      dot: "bg-slate-400",
                    };
                  return (
                    <div
                      key={order.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 active:scale-[0.99]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">
                            {order.orderNumber ?? shortOrderId(order.id)}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">
                            {order.shopName && <span className="font-medium text-slate-500">{order.shopName} · </span>}
                            {order.customerName} · {order.customerPhone}
                          </p>
                        </div>
                        {canManageOrders ? (
                          <Select
                            value={order.status}
                            onValueChange={(v) => handleOrderStatus(order.id, v)}
                          >
                            <SelectTrigger className="h-8 w-32 shrink-0 rounded-[10px] border-slate-200 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {statusOptions(order.status).map((s) => (
                                <SelectItem key={s} value={s}>
                                  {(ORDER_STATUS_META[s as CenterOrderStatus] ?? { label: s }).label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <Badge className={`shrink-0 gap-1.5 rounded-full ring-1 ring-inset ${meta.badge}`}>
                            <span className={`size-1.5 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-3 rounded-[10px] bg-slate-50 px-3 py-2.5">
                        {order.items.slice(0, 2).map((item) => (
                          <p key={item.id} className="truncate text-sm text-slate-600">
                            {item.productName}{" "}
                            <span className="text-slate-400">× {item.quantity} {item.unit}</span>
                          </p>
                        ))}
                        {order.items.length > 2 && (
                          <p className="text-xs text-slate-400">+{order.items.length - 2} รายการ</p>
                        )}
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-xs text-slate-400">
                          {formatThaiDate(order.createdAt)} · {order.itemCount} ชิ้น
                        </p>
                        <p className="font-bold tabular-nums text-slate-900">{formatBaht(order.total)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            )}
            {!canManageOrders && (
              <p className="mt-4 text-xs text-slate-400">
                โหมดพนักงาน: ดูข้อมูลได้ แต่เปลี่ยนสถานะออเดอร์ได้เฉพาะผู้ดูแลและเจ้าของบริษัท
              </p>
            )}
          </TabsContent>

          {/* ============ Intelligence ============ */}
          <TabsContent value="intel" className="mt-6">
            {intelRows.length === 0 ? (
              <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
                  <BrainCircuit className="size-7 text-[#10B981]" />
                </span>
                <h2 className="mt-5 text-lg font-semibold text-slate-900">ยังไม่มีข้อมูลให้วิเคราะห์</h2>
                <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
                  เพิ่มสินค้าและสั่งซื้อสัก 2-3 รอบ Velnox จะเริ่มคาดการณ์รอบถัดไปให้
                </p>
              </div>
            ) : (
              <>
              {/* Desktop: table */}
              <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                <Table className="min-w-[820px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-slate-400">สินค้า</TableHead>
                      <TableHead className="text-slate-400">รอบการซื้อ</TableHead>
                      <TableHead className="text-slate-400">สั่งล่าสุด</TableHead>
                      <TableHead className="text-slate-400">คาดสั่งครั้งหน้า</TableHead>
                      <TableHead className="text-slate-400">เหลืออีก</TableHead>
                      <TableHead className="pr-5 text-right text-slate-400">สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {intelRows.map(({ product, info, cycle, predictedAt, daysLeft }: any) => {
                      const meta = resolveCategoryMeta(product.category);
                      const statusMeta = STATUS_META[info.status as keyof typeof STATUS_META];
                      const Icon = meta.icon;
                      return (
                        <TableRow key={product._id} className="hover:bg-slate-50/60">
                          <TableCell className="pl-5">
                            <div className="flex items-center gap-3">
                              <span className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] ring-1 ring-inset ${meta.chip}`}>
                                <Icon className={`size-4 ${meta.iconClass}`} />
                              </span>
                              <div>
                                <p className="font-medium text-slate-900">{product.name}</p>
                                <p className="text-xs text-slate-400">
                                  สต็อก {formatNumber(product.currentStock ?? 0)} {product.unit}
                                </p>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {cycle !== undefined ? (
                              <p className="font-medium tabular-nums text-slate-900">{formatDays(cycle)}</p>
                            ) : (
                              <p className="text-slate-400">—</p>
                            )}
                            <p className="text-xs text-slate-400">
                              {product.lastOrderedAt !== undefined
                                ? "เรียนรู้จากรอบการสั่งจริง"
                                : "คาดการณ์จากที่ตั้งไว้"}
                            </p>
                          </TableCell>
                          <TableCell>
                            {product.lastOrderedAt !== undefined ? (
                              <p className="text-sm text-slate-600">{formatThaiDate(product.lastOrderedAt)}</p>
                            ) : (
                              <p className="text-slate-400">—</p>
                            )}
                          </TableCell>
                          <TableCell>
                            {predictedAt !== undefined ? (
                              <p className="text-sm text-slate-600">{formatThaiDate(predictedAt)}</p>
                            ) : (
                              <p className="text-slate-400">—</p>
                            )}
                          </TableCell>
                          <TableCell>
                            {daysLeft !== undefined ? (
                              daysLeft > 0 ? (
                                <p className="font-medium tabular-nums text-slate-900">
                                  {formatDays(daysLeft)}
                                </p>
                              ) : (
                                <p className="font-medium text-rose-600">เลยกำหนด</p>
                              )
                            ) : (
                              <p className="text-slate-400">—</p>
                            )}
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            <Badge className={`gap-1 rounded-full ring-1 ring-inset ${statusMeta.badge}`}>
                              <span className={`size-1.5 rounded-full ${statusMeta.dot}`} />
                              {statusMeta.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: app-like intelligence cards */}
              <div className="space-y-3 md:hidden">
                {intelRows.map(({ product, info, cycle, predictedAt, daysLeft }: any) => {
                  const meta = resolveCategoryMeta(product.category);
                  const statusMeta = STATUS_META[info.status as keyof typeof STATUS_META];
                  const Icon = meta.icon;
                  return (
                    <div
                      key={product._id}
                      className="rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 active:scale-[0.99]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ring-1 ring-inset ${meta.chip}`}>
                            <Icon className={`size-4 ${meta.iconClass}`} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                            <p className="text-xs text-slate-400">{meta.label}</p>
                          </div>
                        </div>
                        <Badge className={`shrink-0 gap-1 rounded-full ring-1 ring-inset ${statusMeta.badge}`}>
                          <span className={`size-1.5 rounded-full ${statusMeta.dot}`} />
                          {statusMeta.label}
                        </Badge>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 rounded-[10px] bg-slate-50 p-3 text-xs">
                        <div>
                          <p className="text-slate-400">สต็อกปัจจุบัน</p>
                          <p className="mt-0.5 font-semibold tabular-nums text-slate-900">
                            {formatNumber(product.currentStock ?? 0)} {product.unit}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400">รอบการซื้อ</p>
                          <p className="mt-0.5 font-semibold tabular-nums text-slate-900">
                            {cycle !== undefined ? formatDays(cycle) : "—"}
                            {product.lastOrderedAt !== undefined && (
                              <span className="ml-1 font-normal text-slate-400">(เรียนรู้แล้ว)</span>
                            )}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400">สั่งล่าสุด</p>
                          <p className="mt-0.5 font-medium text-slate-700">
                            {product.lastOrderedAt !== undefined ? formatThaiDate(product.lastOrderedAt) : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-slate-400">คาดสั่งครั้งหน้า</p>
                          <p className="mt-0.5 font-medium text-slate-700">
                            {predictedAt !== undefined ? formatThaiDate(predictedAt) : "—"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-xs text-slate-400">เหลืออีก</p>
                        {daysLeft !== undefined ? (
                          daysLeft > 0 ? (
                            <p className="text-sm font-bold tabular-nums text-slate-900">{formatDays(daysLeft)}</p>
                          ) : (
                            <p className="text-sm font-bold text-rose-600">เลยกำหนด</p>
                          )
                        ) : (
                          <p className="text-sm text-slate-400">—</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              </>
            )}
            <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
              <BrainCircuit className="size-3.5 text-[#10B981]" />
              Velnox คำนวณจากรอบการสั่งจริงที่ระบบเรียนรู้ — ยิ่งสั่งมาก ยิ่งแม่นยำ
            </p>

            {/* CPNS: what customers are interested in right now (aggregates only) */}
            {market &&
              (market.topSearches.length > 0 ||
                market.topCategories.length > 0 ||
                market.popularProducts.length > 0) && (
                <Card className="mt-6 border-slate-200 shadow-none">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <TrendingUp className="size-4 text-[#10B981]" />
                      ลูกค้ากำลังสนใจอะไร · 30 วัน
                    </CardTitle>
                    <p className="text-xs text-slate-400">
                      สรุปจากพฤติกรรมการใช้งานจริงของลูกค้าทั่วตลาด (รวมกัน ไม่ระบุตัวตน) ·{" "}
                      {formatNumber(market.eventCount)} เหตุการณ์
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-6 lg:grid-cols-3">
                      {/* Top searches */}
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          <Search className="size-3.5" />
                          คำค้นหายอดนิยม
                        </p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {market.topSearches.slice(0, 6).map((s) => (
                            <span
                              key={s.q}
                              className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700"
                            >
                              “{s.q}”{" "}
                              <span className="ml-0.5 text-slate-400">×{s.count}</span>
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Top categories */}
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          <Boxes className="size-3.5" />
                          หมวดที่ถูกเข้าดูบ่อย
                        </p>
                        <div className="mt-3 space-y-2">
                          {market.topCategories.slice(0, 6).map((c) => {
                            const max = Math.max(1, market.topCategories[0]?.count ?? 1);
                            return (
                              <div key={c.category} className="flex items-center gap-2">
                                <span className="w-28 shrink-0 truncate text-xs text-slate-600">{c.label}</span>
                                <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                                  <div
                                    className="h-full rounded-full bg-[#10B981]"
                                    style={{ width: `${Math.round((c.count / max) * 100)}%` }}
                                  />
                                </div>
                                <span className="w-8 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-900">
                                  {c.count}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Popular products */}
                      <div>
                        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
                          <Sparkles className="size-3.5" />
                          สินค้าที่ถูกมองบ่อย
                        </p>
                        <div className="mt-3 space-y-2">
                          {market.popularProducts.slice(0, 6).map(({ product, views }) => (
                            <div key={product.id} className="flex items-center gap-3">
                              <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-slate-100">
                                {product.primaryImage ? (
                                  <img src={product.primaryImage.displayUrl} alt="" className="size-full object-cover" />
                                ) : (
                                  <Package className="size-3.5 text-slate-400" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-medium text-slate-900">{product.name}</span>
                                <span className="text-[11px] text-slate-400">
                                  {formatBaht(product.price)}/{product.unit}
                                </span>
                              </span>
                              <span className="shrink-0 text-xs font-semibold tabular-nums text-slate-500">
                                {formatNumber(views)} ครั้ง
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
          </TabsContent>

          {/* Reject dialogs (reason is required before rejecting — spec §36–37) */}
          <Dialog open={rejectingSeller !== null} onOpenChange={(open) => !open && setRejectingSeller(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>ปฏิเสธใบสมัครพ่อค้า</DialogTitle>
                <DialogDescription>
                  ระบุเหตุผล — พ่อค้าจะเห็นเหตุผลนี้ และสามารถส่งใบสมัครใหม่ได้
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="เช่น เอกสารไม่ครบ หรือข้อมูลร้านไม่ตรงตามข้อกำหนด"
                rows={3}
              />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setRejectingSeller(null)} disabled={modBusy}>
                  ยกเลิก
                </Button>
                <Button
                  className="bg-rose-600 text-white hover:bg-rose-700"
                  onClick={() => rejectingSeller && handleSellerStatus(rejectingSeller, "rejected")}
                  disabled={modBusy || !rejectReason.trim()}
                >
                  {modBusy && <Loader2 className="size-4 animate-spin" />}
                  ยืนยันการปฏิเสธ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={rejectingProduct !== null} onOpenChange={(open) => !open && setRejectingProduct(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>ปฏิเสธ / ระงับสินค้า</DialogTitle>
                <DialogDescription>
                  ระบุเหตุผล — พ่อค้าจะเห็นเหตุผลนี้ และสามารถแก้ไขแล้วส่งตรวจสอบใหม่ได้
                </DialogDescription>
              </DialogHeader>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="เช่น รูปไม่ชัดเจน หรือข้อมูลสินค้าไม่ตรงตามข้อกำหนด"
                rows={3}
              />
              <DialogFooter>
                <Button variant="ghost" onClick={() => setRejectingProduct(null)} disabled={modBusy}>
                  ยกเลิก
                </Button>
                <Button
                  className="bg-rose-600 text-white hover:bg-rose-700"
                  onClick={() =>
                    rejectingProduct &&
                    handleProductModeration(
                      rejectingProduct,
                      rejectingProduct.status === "published" ? "suspended" : "rejected",
                    )
                  }
                  disabled={modBusy || !rejectReason.trim()}
                >
                  {modBusy && <Loader2 className="size-4 animate-spin" />}
                  ยืนยัน
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Seller verification review workspace — the reviewer sees the exact
          {/* ============ Products — moderation queue (Neon, spec §37) ============ */}
          <TabsContent value="products" className="mt-6">
            <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
              <Package className="size-4 text-[#10B981]" />
              ตรวจสอบสินค้าที่พ่อค้าส่งมา — อนุมัติแล้วจะแสดงที่หน้าร้าน velshop
            </div>
            <ProductModerationQueue />
          </TabsContent>

          {/* ============ Sellers — application review (Neon, spec §36) ============ */}
          <TabsContent value="sellers" className="mt-6">
            <div className="mb-4 flex items-center gap-2 text-sm text-slate-500">
              <Store className="size-4 text-[#10B981]" />
              ตรวจสอบใบสมัครและการยืนยันร้านค้า
            </div>
            <SellerVerificationQueue />
          </TabsContent>

          {/* ============ Categories (admin/owner) ============ */}
          {canSee("categories") && (
            <TabsContent value="categories" className="mt-6">
              <CategoriesManagement />
            </TabsContent>
          )}
          {/* ============ People (spec 9-11, 42) ==========================
              Staff and customers are TWO separate lists, filtered server-side
              by the real users.role values (GET /api/admin/users?segment=...).
              Employee management stays owner-only — the API enforces it; this
              UI only reflects it. */}
          {canSee("staff") && (
            <TabsContent value="staff" className="mt-6">
              {peopleError && (
                <div className="mb-4 flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2 text-sm text-red-700">
                    <AlertTriangle className="size-4 shrink-0" />
                    โหลดรายชื่อผู้ใช้ไม่สำเร็จ: {peopleError}
                  </p>
                  <Button variant="outline" size="sm" className="shrink-0 rounded-[10px]" onClick={() => void loadPeople()}>
                    ลองใหม่
                  </Button>
                </div>
              )}

              <Tabs value={peopleSegment} onValueChange={(v) => setPeopleSegment(v as "staff" | "customer")}>
                <TabsList className="w-full justify-start overflow-x-auto rounded-[12px] border border-slate-200 bg-white p-1 sm:w-auto">
                  <TabsTrigger value="staff" className="gap-1.5 rounded-[10px]">
                    <ShieldCheck className="size-4" /> พนักงาน
                    <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">{peopleCounts.staff}</span>
                  </TabsTrigger>
                  <TabsTrigger value="customer" className="gap-1.5 rounded-[10px]">
                    <ShoppingBag className="size-4" /> ลูกค้า
                    <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">{peopleCounts.customer}</span>
                  </TabsTrigger>
                </TabsList>

                {/* ---------- Staff accounts (owner only) ---------- */}
                <TabsContent value="staff" className="mt-4">
                  {isOwner ? (
                    <>
              <Card className="mb-4 max-w-2xl border-slate-200 shadow-none">
                <CardContent className="pt-5">
                  <p className="flex items-center gap-2 text-sm text-slate-600">
                    <Crown className="size-4 text-amber-500" />
                    เฉพาะเจ้าของบริษัทเท่านั้นที่จัดการสิทธิ์พนักงาน — admin/พนักงานดูข้อมูลได้แต่แตะตรงนี้ไม่ได้
                  </p>
                </CardContent>
              </Card>

              {/* Employee accounts: create / reset password / permissions (spec §9–§11, §42) */}
              <EmployeeManager />

              <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                <Table className="min-w-[560px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-slate-400">พนักงาน</TableHead>
                      <TableHead className="text-slate-400">บทบาท</TableHead>
                      <TableHead className="text-slate-400">ฝ่าย</TableHead>
                      <TableHead className="pr-5 text-right text-slate-400">สิทธิ์</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(staffUsers ?? []).map((u: any) => {
                      const role = u.role ?? "customer";
                      const meta =
                        ROLE_META[role as keyof typeof ROLE_META] ?? ROLE_META.customer;
                      const isSelf = u._id === user?._id;
                      return (
                        <TableRow key={u._id} className="hover:bg-slate-50/60">
                          <TableCell className="pl-5">
                            <p className="font-medium text-slate-900">
                              {u.name || "ผู้ใช้ที่ยังไม่ตั้งชื่อ"}
                              {isSelf && <span className="ml-1.5 text-xs text-slate-400">(คุณ)</span>}
                            </p>
                            <p className="text-xs text-slate-400">{u.email ?? "บัญชีผู้เยี่ยมชม"}</p>
                          </TableCell>
                          <TableCell>
                            {isSelf ? (
                              <Badge className={`gap-1 rounded-full ring-1 ring-inset ${meta.badge}`}>
                                {role === "owner" && <Crown className="size-3" />}
                                {role === "admin" && <BadgeCheck className="size-3" />}
                                {meta.label}
                              </Badge>
                            ) : (
                              <Select
                                value={role}
                                onValueChange={(v) =>
                                  handleSetUserAccess(
                                    u._id,
                                    v as "customer" | "seller" | "admin" | "owner" | "staff",
                                    u.department,
                                  )
                                }
                              >
                                <SelectTrigger className="h-9 w-40 rounded-[10px] border-slate-200 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="customer">ลูกค้า</SelectItem>
                                  <SelectItem value="seller">พ่อค้า / ร้านค้า</SelectItem>
                                  <SelectItem value="staff">พนักงาน (ดูข้อมูล)</SelectItem>
                                  <SelectItem value="admin">ผู้ดูแลฝ่าย</SelectItem>
                                  <SelectItem value="owner">เจ้าของบริษัท</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell>
                            {isSelf ? (
                              <span className="text-sm text-slate-400">
                                {u.department
                                  ? DEPARTMENT_LABEL[u.department] ?? u.department
                                  : "—"}
                              </span>
                            ) : (
                              <Select
                                value={u.department ?? "general"}
                                onValueChange={(v) =>
                                  handleSetUserAccess(u._id, role, v)
                                }
                              >
                                <SelectTrigger className="h-9 w-40 rounded-[10px] border-slate-200 text-sm">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {DEPARTMENTS.map((d) => (
                                    <SelectItem key={d.id} value={d.id}>
                                      {d.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            <Badge
                              className={`gap-1 rounded-full ring-1 ring-inset ${meta.badge}`}
                            >
                              {meta.label}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: app-like staff cards */}
              <div className="space-y-3 md:hidden">
                {(staffUsers ?? []).map((u: any) => {
                  const role = u.role ?? "customer";
                  const meta =
                    ROLE_META[role as keyof typeof ROLE_META] ?? ROLE_META.customer;
                  const isSelf = u._id === user?._id;
                  return (
                    <div
                      key={u._id}
                      className="rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 active:scale-[0.99]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {u.name || "ผู้ใช้ที่ยังไม่ตั้งชื่อ"}
                            {isSelf && <span className="ml-1.5 text-xs text-slate-400">(คุณ)</span>}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">{u.email ?? "บัญชีผู้เยี่ยมชม"}</p>
                        </div>
                        <Badge className={`shrink-0 gap-1 rounded-full ring-1 ring-inset ${meta.badge}`}>
                          {role === "owner" && <Crown className="size-3" />}
                          {role === "admin" && <BadgeCheck className="size-3" />}
                          {meta.label}
                        </Badge>
                      </div>
                      {!isSelf && (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <Select
                            value={role}
                            onValueChange={(v) =>
                              handleSetUserAccess(
                                u._id,
                                v as "customer" | "seller" | "admin" | "owner" | "staff",
                                u.department,
                              )
                            }
                          >
                            <SelectTrigger className="h-10 w-full rounded-[10px] border-slate-200 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="customer">ลูกค้า</SelectItem>
                              <SelectItem value="seller">พ่อค้า / ร้านค้า</SelectItem>
                              <SelectItem value="staff">พนักงาน (ดูข้อมูล)</SelectItem>
                              <SelectItem value="admin">ผู้ดูแลฝ่าย</SelectItem>
                              <SelectItem value="owner">เจ้าของบริษัท</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select
                            value={u.department ?? "general"}
                            onValueChange={(v) => handleSetUserAccess(u._id, role, v)}
                          >
                            <SelectTrigger className="h-10 w-full rounded-[10px] border-slate-200 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {DEPARTMENTS.map((d) => (
                                <SelectItem key={d.id} value={d.id}>
                                  {d.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
                      <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
                        <Users className="size-3.5 shrink-0 text-[#10B981]" />
                        พนักงาน (staff) ดูตัวเลขธุรกิจได้แต่แตะข้อมูลไม่ได้ · ผู้ดูแลฝ่าย (admin) จัดการข้อมูลได้แต่จัดการพนักงานไม่ได้
                      </p>
                    </>
                  ) : (
                    <Card className="border-slate-200 shadow-none">
                      <CardContent className="pt-5">
                        <p className="flex items-center gap-2 text-sm text-slate-600">
                          <Crown className="size-4 shrink-0 text-amber-500" />
                          การจัดการบัญชีและสิทธิ์พนักงานเป็นสิทธิ์ของเจ้าของบริษัทเท่านั้น
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>

                {/* ---------- Customers ---------- */}
                <TabsContent value="customer" className="mt-4">
                  <Card className="gap-0 border-slate-200 shadow-none">
                    <CardHeader className="flex-col items-start gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ShoppingBag className="size-4 text-[#10B981]" />
                          บัญชีลูกค้า
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          ลูกค้า {peopleCounts.customer} บัญชี · ผู้ขาย {peopleCounts.seller} บัญชี — แยกตามบทบาทจริงในฐานข้อมูล
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1.5 rounded-[10px] border-slate-200 text-slate-600"
                        onClick={() => void loadPeople()}
                      >
                        <RefreshCw className={`size-3.5 ${customerUsers === null ? "animate-spin" : ""}`} />
                        รีเฟรช
                      </Button>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                        <Input
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          placeholder="ค้นหาชื่อหรืออีเมลลูกค้า..."
                          className="rounded-[10px] pl-9"
                        />
                      </div>

                      {customerUsers === null ? (
                        <div className="space-y-2">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-14 animate-pulse rounded-xl border border-slate-200 bg-white" />
                          ))}
                        </div>
                      ) : filteredCustomers.length === 0 ? (
                        <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                          <span className="flex size-12 items-center justify-center rounded-2xl bg-[#ECFDF5]">
                            <ShoppingBag className="size-6 text-[#10B981]" />
                          </span>
                          <p className="mt-4 text-sm font-semibold text-slate-900">
                            {customerSearch ? "ไม่พบลูกค้าที่ค้นหา" : "ยังไม่มีบัญชีลูกค้า"}
                          </p>
                          <p className="mt-1 text-xs text-slate-500">
                            {customerSearch ? "ลองใช้คำค้นอื่น" : "บัญชีลูกค้าจะปรากฏที่นี่เมื่อมีผู้สมัครใช้งาน velshop"}
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                            <Table className="min-w-[620px]">
                              <TableHeader>
                                <TableRow className="hover:bg-transparent">
                                  <TableHead className="pl-4 text-slate-400">ลูกค้า</TableHead>
                                  <TableHead className="text-slate-400">อีเมล</TableHead>
                                  <TableHead className="text-slate-400">สมัครเมื่อ</TableHead>
                                  <TableHead className="pr-4 text-right text-slate-400">สถานะ</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredCustomers.map((c) => (
                                  <TableRow key={c._id} className="hover:bg-slate-50/60">
                                    <TableCell className="pl-4">
                                      <p className="font-medium text-slate-900">{c.name || "ลูกค้าที่ยังไม่ตั้งชื่อ"}</p>
                                      <p className="text-xs text-slate-400">#{c._id.slice(0, 8)}</p>
                                    </TableCell>
                                    <TableCell className="text-sm text-slate-600">{c.email ?? "—"}</TableCell>
                                    <TableCell className="text-sm text-slate-600">{formatThaiDate(c.createdAt)}</TableCell>
                                    <TableCell className="pr-4 text-right">
                                      <Badge className={c.status === "active" ? "rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15" : "rounded-full bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15"}>
                                        {c.status === "active" ? "ใช้งาน" : c.status}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>

                          <div className="space-y-2 md:hidden">
                            {filteredCustomers.map((c) => (
                              <div key={c._id} className="rounded-xl border border-slate-200 bg-white p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-sm font-semibold text-slate-900">{c.name || "ลูกค้าที่ยังไม่ตั้งชื่อ"}</p>
                                    <p className="mt-0.5 truncate text-xs text-slate-400">{c.email ?? "—"}</p>
                                  </div>
                                  <Badge className={c.status === "active" ? "shrink-0 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15" : "shrink-0 rounded-full bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15"}>
                                    {c.status === "active" ? "ใช้งาน" : c.status}
                                  </Badge>
                                </div>
                                <p className="mt-2 text-[11px] text-slate-400">สมัครเมื่อ {formatThaiDate(c.createdAt)}</p>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </TabsContent>
          )}

          {/* ============ Audit Logs (spec §44) ============ */}
          <AuditLogTab />

          {/* ============ Company / System Settings =========================
              VelCenter is the company control plane, so this screen configures
              the platform/company — not one shop. Editable values persist to
              Neon `platform_settings` and every change is audit-logged
              server-side. Read-only values come from the backend component that
              actually owns them (payout policy, upload limits) so there is
              never a second source of truth for money or media. */}
          {canSee("settings") && (
            <TabsContent value="settings" className="mt-6">
              {settingsError && (
                <div className="mb-4 flex flex-col items-start gap-2 rounded-xl border border-red-200 bg-red-50/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-center gap-2 text-sm text-red-700">
                    <AlertTriangle className="size-4 shrink-0" />
                    โหลดการตั้งค่าไม่สำเร็จ: {settingsError}
                  </p>
                  <Button variant="outline" size="sm" className="shrink-0 rounded-[10px]" onClick={() => void loadSettings()}>
                    ลองใหม่
                  </Button>
                </div>
              )}

              <div className="grid gap-5 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
                {/* Section nav — scrollable strip on mobile, sidebar on desktop */}
                <nav aria-label="หมวดการตั้งค่า" className="lg:sticky lg:top-24 lg:self-start">
                  <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-1 lg:overflow-visible lg:pb-0">
                    {SETTINGS_SECTIONS.map((section) => {
                      const Icon = section.icon;
                      const active = settingsSection === section.id;
                      return (
                        <button
                          key={section.id}
                          type="button"
                          onClick={() => setSettingsSection(section.id)}
                          aria-current={active ? "page" : undefined}
                          className={`flex shrink-0 items-center gap-2 rounded-[10px] px-3 py-2 text-left text-sm font-medium transition-colors lg:w-full ${
                            active ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                          }`}
                        >
                          <Icon className="size-4 shrink-0" />
                          <span className="whitespace-nowrap">{section.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </nav>

                <div className="min-w-0 space-y-5">
                  {/* ---------- Company / platform identity ---------- */}
                  {settingsSection === "company" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Store className="size-4 text-[#10B981]" />
                          ข้อมูลบริษัท / แพลตฟอร์ม
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          Identity ของ Velnox Marketplace ที่แสดงบน velshop — บันทึกแล้วมีผลทันที
                          และทุกการเปลี่ยนแปลงถูกบันทึกใน Audit Logs
                        </p>
                      </CardHeader>
                      <CardContent>
                        <form onSubmit={handleSaveSettings} className="grid gap-4">
                          <div className="grid gap-2">
                            <Label htmlFor="settings-name">ชื่อแพลตฟอร์ม / ร้านค้า</Label>
                            <Input
                              id="settings-name"
                              value={form.shopName}
                              onChange={(e) => setForm((f) => ({ ...f, shopName: e.target.value }))}
                              placeholder="เช่น Velnox Marketplace"
                            />
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="settings-tagline">คำโปรย / tagline</Label>
                            <Input
                              id="settings-tagline"
                              value={form.tagline}
                              onChange={(e) => setForm((f) => ({ ...f, tagline: e.target.value }))}
                              placeholder="Commerce that remembers you · จำแทนคุณ"
                            />
                          </div>
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="grid gap-2">
                              <Label htmlFor="settings-phone">เบอร์โทรติดต่อ</Label>
                              <Input
                                id="settings-phone"
                                value={form.phone}
                                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                                placeholder="081-234-5678"
                              />
                            </div>
                            <div className="grid gap-2">
                              <Label htmlFor="settings-announcement">ประกาศ / แบนเนอร์</Label>
                              <Input
                                id="settings-announcement"
                                value={form.announcement}
                                onChange={(e) => setForm((f) => ({ ...f, announcement: e.target.value }))}
                                placeholder="เช่น สินค้าใหม่เข้าคลังแล้ว!"
                              />
                            </div>
                          </div>
                          <div className="grid gap-2">
                            <Label htmlFor="settings-address">ที่อยู่บริษัท / ที่อยู่ร้าน</Label>
                            <Textarea
                              id="settings-address"
                              value={form.address}
                              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                              placeholder="ที่อยู่สำหรับรับสินค้า / นัดรับ"
                              rows={2}
                            />
                          </div>
                          <Button
                            type="submit"
                            className="w-fit gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                            disabled={savingSettings || settings === null}
                          >
                            {savingSettings ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                            บันทึกการตั้งค่า
                          </Button>
                        </form>
                      </CardContent>
                    </Card>
                  )}

                  {/* ---------- Marketplace behaviour ---------- */}
                  {settingsSection === "marketplace" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Package className="size-4 text-[#10B981]" />
                          ตลาด & การอนุมัติสินค้า
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          ควบคุมว่าสินค้าที่ผู้ขายส่งเข้าตลาดต้องผ่านการอนุมัติหรือไม่
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-3">
                          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-emerald-300">
                            <input type="radio" name="approval-mode" value="manual" checked={approvalMode === "manual"} onChange={() => handleApprovalModeChange("manual")} disabled={savingApproval} className="mt-0.5" />
                            <div>
                              <span className="text-sm font-medium text-slate-900">อนุมัติด้วยมือ</span>
                              <p className="text-xs text-slate-500">สินค้าทุกชิ้นต้องได้รับการตรวจสอบและอนุมัติจากผู้ดูแลก่อนแสดงบน VelShop</p>
                            </div>
                          </label>
                          <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 bg-white p-3 transition-colors hover:border-emerald-300">
                            <input type="radio" name="approval-mode" value="auto" checked={approvalMode === "auto"} onChange={() => handleApprovalModeChange("auto")} disabled={savingApproval} className="mt-0.5" />
                            <div>
                              <span className="text-sm font-medium text-slate-900">อนุมัติอัตโนมัติ</span>
                              <p className="text-xs text-slate-500">สินค้าจะได้รับการอนุมัติและแสดงบน VelShop ทันทีหลังผ่านการตรวจสอบข้อมูล</p>
                            </div>
                          </label>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                          ระบบยืนยันตัวตนของ Velnox เป็นแบบเดียว: การยืนยันตัวตนของผู้ขาย/ร้านค้า
                          {settingsMeta?.moderation?.productVerificationEnabled === false
                            ? " — ไม่มีระบบยืนยันสินค้าแยกรายชิ้น ป้าย V จึงมาจากสถานะการยืนยันของผู้ขายเท่านั้น"
                            : ""}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* ---------- Seller commission (read-only, real policy) ---------- */}
                  {settingsSection === "commission" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Coins className="size-4 text-[#10B981]" />
                          ค่าธรรมเนียมผู้ขาย (Seller & Commission)
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          นโยบายการเงินที่ engine คำนวณรายได้ของผู้ขายใช้จริง — แสดงแบบอ่านอย่างเดียว
                          เพื่อไม่ให้มีแหล่งความจริงซ้อนกัน
                        </p>
                      </CardHeader>
                      <CardContent>
                        {settingsMeta?.commission ? (
                          <>
                            <div className="grid gap-3 sm:grid-cols-3">
                              <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <p className="text-xs text-slate-400">ค่าธรรมเนียมผู้ขาย</p>
                                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                                  {((settingsMeta.commission.sellerRate ?? 0) * 100).toFixed(1)}%
                                </p>
                                <p className="mt-0.5 text-[11px] text-slate-400">หักจากยอดขายแต่ละรายการ</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <p className="text-xs text-slate-400">ความคุ้มครองการคืนสินค้า</p>
                                <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                                  {((settingsMeta.commission.returnCoverage ?? 0) * 100).toFixed(0)}%
                                </p>
                                <p className="mt-0.5 text-[11px] text-slate-400">ของยอดขาย ครอบคลุมด้วยค่าธรรมเนียม</p>
                              </div>
                              <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <p className="text-xs text-slate-400">สกุลเงิน</p>
                                <p className="mt-1 text-2xl font-bold text-slate-900">{settingsMeta.commission.currency ?? "THB"}</p>
                                <p className="mt-0.5 text-[11px] text-slate-400">สกุลเงินที่ระบบใช้คำนวณ</p>
                              </div>
                            </div>
                            <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-700">
                              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                              ค่าธรรมเนียมถูกกำหนดในระดับแพลตฟอร์ม (โค้ด/คอนฟิกของผู้ให้บริการ)
                              จึงแก้จากหน้านี้ไม่ได้ — ป้องกันไม่ให้ยอดเงินของผู้ขายผิดพลาดจากการตั้งค่าโดยไม่ตั้งใจ
                            </p>
                          </>
                        ) : (
                          <p className="text-sm text-slate-400">กำลังโหลดนโยบายค่าธรรมเนียม...</p>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* ---------- Localization ---------- */}
                  {settingsSection === "localization" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <Globe className="size-4 text-[#10B981]" />
                          ภาษา & ท้องถิ่น
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          ภาษาที่แพลตฟอร์มรองรับ (แหล่งความจริงเดียว: shared i18n config)
                        </p>
                      </CardHeader>
                      <CardContent>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {SUPPORTED_LANGUAGES.map((lang) => (
                            <div key={lang.code} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-slate-900">{lang.label}</p>
                                <p className="font-mono text-xs uppercase text-slate-400">{lang.code}</p>
                              </div>
                              {lang.code === DEFAULT_LANGUAGE && (
                                <Badge className="shrink-0 gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15">
                                  <BadgeCheck className="size-3" />
                                  ค่าเริ่มต้น
                                </Badge>
                              )}
                            </div>
                          ))}
                        </div>
                        <p className="mt-4 text-xs leading-5 text-slate-400">
                          ภาษาถูกเก็บเป็นคีย์ในฐานข้อมูล (categories.names, platform_settings) — เพิ่มภาษาใหม่ต้องมี locale file ใน shared i18n
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {/* ---------- Media ---------- */}
                  {settingsSection === "media" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ImageIcon className="size-4 text-[#10B981]" />
                          ไฟล์ & สื่อ (Media)
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          ข้อจำกัดการอัปโหลดที่ backend บังคับใช้จริง (Cloudflare R2)
                        </p>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-xs text-slate-400">ขนาดไฟล์สูงสุด</p>
                            <p className="mt-1 text-2xl font-bold tabular-nums text-slate-900">
                              {settingsMeta?.media?.maxUploadBytes
                                ? `${Math.round(settingsMeta.media.maxUploadBytes / (1024 * 1024))} MB`
                                : "—"}
                            </p>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-white p-4">
                            <p className="text-xs text-slate-400">ประเภทไฟล์ที่อนุญาต</p>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {(settingsMeta?.media?.allowedTypes ?? []).map((type) => (
                                <Badge key={type} className="rounded-full bg-slate-100 text-[10px] text-slate-600 ring-1 ring-inset ring-slate-600/10">
                                  {type.replace("image/", "")}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>
                        <p className="text-xs leading-5 text-slate-400">
                          ไฟล์ถูกเก็บแบบ private บน R2 — หลักฐานการยืนยันตัวตนเข้าถึงได้เฉพาะผู้ตรวจสอบผ่าน signed URL อายุสั้น
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {/* ---------- Access / permissions ---------- */}
                  {settingsSection === "access" && (
                    <Card className="border-slate-200 shadow-none">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <KeyRound className="size-4 text-[#10B981]" />
                          สิทธิ์การเข้าถึง (Permissions)
                        </CardTitle>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          แคตตาล็อกสิทธิ์ที่ระบบรู้จัก — การมอบสิทธิ์ทำได้ที่แท็บ “ผู้ใช้ & ลูกค้า” (เจ้าของบริษัทเท่านั้น)
                        </p>
                      </CardHeader>
                      <CardContent>
                        {isOwner ? (
                          permissionCatalog.length === 0 ? (
                            <p className="text-sm text-slate-400">กำลังโหลดรายการสิทธิ์...</p>
                          ) : (
                            <ul className="grid gap-2 sm:grid-cols-2">
                              {permissionCatalog.map((perm) => (
                                <li key={perm.code} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                                  <p className="text-sm font-medium text-slate-900">{perm.label}</p>
                                  <p className="mt-0.5 text-xs text-slate-400">{perm.description}</p>
                                  <p className="mt-1 font-mono text-[10px] text-slate-300">{perm.code}</p>
                                </li>
                              ))}
                            </ul>
                          )
                        ) : (
                          <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                            การจัดการสิทธิ์พนักงานเป็นสิทธิ์ของเจ้าของบริษัทเท่านั้น
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            </TabsContent>
          )}
        </Tabs>
      </main>

{/* Mobile bottom nav removed — VelCenter uses top tab strip */}
    </div>
  );
}
